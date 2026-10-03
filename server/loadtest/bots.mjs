#!/usr/bin/env node
/**
 * Uji beban: N bot WebSocket (default 50) dalam satu room, gerak acak 15 Hz di dalam peta,
 * ping tiap detik, dan chat sesekali. Di akhir mencetak CPU/RAM server, bandwidth, latensi
 * p50/p95/p99, dan jumlah pesan ditolak.
 *
 * Memakai encoder/decoder server (dist/protocol.js), jadi jalankan `npm run build` dulu.
 *
 * Contoh:
 *   node loadtest/bots.mjs --bots 50 --duration 60 --url http://127.0.0.1:8787 --container mp-server-mp-server-1
 *
 * Argumen:
 *   --bots N         jumlah bot (default 50)
 *   --duration S     durasi pengukuran dalam detik (default 60)
 *   --url URL        base URL HTTP server (default http://127.0.0.1:8787); WebSocket memakai /ws
 *   --container NAME nama container Docker; kalau diisi, CPU/RAM/jaringan juga diambil dari `docker stats`
 *   --chat-every S   rata-rata jeda chat per bot dalam detik (default 15)
 *   --json FILE      simpan hasil sebagai JSON
 */
import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import WebSocket from 'ws';
import { DEFAULT_APPEARANCE } from '../dist/appearance.js';
import { decodeMessage, encodeMessage, HALF_WORLD } from '../dist/protocol.js';

const run = promisify(execFile);

function parseArgs(argv) {
  const args = { bots: 50, duration: 60, url: 'http://127.0.0.1:8787', container: '', chatEvery: 15, json: '' };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--bots') args.bots = Number(value);
    else if (key === '--duration') args.duration = Number(value);
    else if (key === '--url') args.url = value;
    else if (key === '--container') args.container = value;
    else if (key === '--chat-every') args.chatEvery = Number(value);
    else if (key === '--json') args.json = value;
    else continue;
    i++;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const wsBase = args.url.replace(/^http/, 'ws');
const BOUND = HALF_WORLD - 6;
const SPEED = 6; // m/s, di bawah batas anti-teleport (25,2 m/s)
const TICK_MS = 1000 / 15;

const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : NaN);
const fmtBytes = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)} MB` : `${(n / 1e3).toFixed(1)} kB`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function health() {
  const res = await fetch(`${args.url}/health`);
  if (res.status !== 200) throw new Error(`/health ${res.status}`);
  return res.json();
}

/** Satu sampel `docker stats`; null kalau container tidak diisi atau docker gagal. */
async function dockerSample() {
  if (!args.container) return null;
  try {
    const { stdout } = await run('docker', ['stats', '--no-stream', '--format', '{{json .}}', args.container]);
    return JSON.parse(stdout.trim());
  } catch {
    return null;
  }
}

const parseSize = (text) => {
  const match = /([\d.]+)\s*([kKMG]?i?B)/.exec(text ?? '');
  if (!match) return NaN;
  const unit = match[2].toLowerCase();
  const mult = { b: 1, kb: 1e3, kib: 1024, mb: 1e6, mib: 1024 ** 2, gb: 1e9, gib: 1024 ** 3 }[unit] ?? 1;
  return Number(match[1]) * mult;
};

/** Network I/O kumulatif container: "1.2MB / 3.4MB" → [rx, tx]. */
const parseNet = (sample) => (sample?.NetIO ?? '').split('/').map((s) => parseSize(s.trim()));

class Bot {
  constructor(index, code, token) {
    this.index = index;
    this.code = code;
    this.token = token;
    this.x = (Math.random() * 2 - 1) * BOUND * 0.9;
    this.z = (Math.random() * 2 - 1) * BOUND * 0.9;
    // Sebagian bot berkumpul di tengah supaya AOI dekat dan chat "nearby" ikut teruji.
    if (index % 3 === 0) {
      this.x = (Math.random() * 2 - 1) * 40;
      this.z = (Math.random() * 2 - 1) * 40;
    }
    this.heading = Math.random() * Math.PI * 2;
    this.pings = new Map();
    this.rtts = [];
    this.bytesIn = 0;
    this.bytesOut = 0;
    this.msgsIn = 0;
    this.msgsOut = 0;
    this.statesIn = 0;
    this.chatsIn = 0;
    this.nonce = 1;
    this.closedCode = null;
    this.measuring = false;
    this.playerId = null;
  }

  send(message) {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    const data = encodeMessage(message);
    this.ws.send(data);
    if (this.measuring) {
      this.bytesOut += data.length;
      this.msgsOut++;
    }
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${wsBase}/ws?room=${this.code}&token=${this.token}`, { perMessageDeflate: false });
      this.ws.binaryType = 'nodebuffer';
      const timer = setTimeout(() => reject(new Error(`bot ${this.index}: welcome timeout`)), 10_000);
      this.ws.on('open', () => this.send({ type: 'hello', username: `Bot ${this.index}`, appearance: DEFAULT_APPEARANCE }));
      this.ws.on('message', (raw) => {
        const now = performance.now();
        const bytes = new Uint8Array(raw);
        if (this.measuring) {
          this.bytesIn += bytes.length;
          this.msgsIn++;
        }
        const decoded = decodeMessage(bytes);
        if (!decoded.ok) return;
        const message = decoded.message;
        if (message.type === 'welcome') {
          this.playerId = message.playerId;
          clearTimeout(timer);
          resolve();
        } else if (message.type === 'pong') {
          const sent = this.pings.get(message.nonce);
          if (sent !== undefined) {
            this.pings.delete(message.nonce);
            if (this.measuring) this.rtts.push(now - sent);
          }
        } else if (message.type === 'state' && this.measuring) this.statesIn++;
        else if (message.type === 'chat' && this.measuring) this.chatsIn++;
      });
      this.ws.on('close', (code) => {
        this.closedCode = code;
        clearTimeout(timer);
        reject(new Error(`bot ${this.index}: closed ${code}`));
      });
      this.ws.on('error', () => {});
    });
  }

  step(dtSec) {
    // Jalan acak: belok sedikit tiap tick, memantul di tepi peta.
    this.heading += (Math.random() - 0.5) * 0.4;
    let nx = this.x + Math.sin(this.heading) * SPEED * dtSec;
    let nz = this.z + Math.cos(this.heading) * SPEED * dtSec;
    if (Math.abs(nx) > BOUND || Math.abs(nz) > BOUND) {
      this.heading += Math.PI;
      nx = Math.max(-BOUND, Math.min(BOUND, nx));
      nz = Math.max(-BOUND, Math.min(BOUND, nz));
    }
    this.x = nx;
    this.z = nz;
    this.send({
      type: 'state',
      timeMs: Date.now() >>> 0,
      players: [{ id: 0, x: this.x, y: 0, z: this.z, heading: ((this.heading % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), mode: 'walk', anim: 'walk', jumping: false }],
    });
  }

  ping() {
    const nonce = this.nonce++ >>> 0;
    this.pings.set(nonce, performance.now());
    // Ping yang tidak dibalas > 10 detik dibuang supaya map tidak tumbuh.
    if (this.pings.size > 10) this.pings.delete(this.pings.keys().next().value);
    this.send({ type: 'ping', nonce });
  }

  chat() {
    const channel = Math.random() < 0.5 ? 'session' : 'nearby';
    this.send({ type: 'chat', channel, fromId: 0, msgId: 0, timeMs: 0, text: `uji beban bot ${this.index} #${Math.floor(Math.random() * 1e6)}` });
  }
}

async function main() {
  console.log(`Uji beban: ${args.bots} bot, ${args.duration} detik, server ${args.url}${args.container ? `, container ${args.container}` : ''}`);
  const before = await health();

  // Bot pertama membuat room, sisanya bergabung lewat kode room.
  const createRes = await fetch(`${args.url}/rooms`, { method: 'POST' });
  if (createRes.status !== 201) throw new Error(`POST /rooms ${createRes.status}`);
  const created = await createRes.json();
  const code = created.code;
  const tokens = [created.token];
  for (let i = 1; i < args.bots; i++) {
    const res = await fetch(`${args.url}/rooms/${code}/join`, { method: 'POST' });
    if (res.status !== 200) throw new Error(`join ${i}: ${res.status}`);
    tokens.push((await res.json()).token);
  }
  const bots = tokens.map((token, i) => new Bot(i, code, token));
  const connectStart = performance.now();
  await Promise.all(bots.map((bot) => bot.connect()));
  console.log(`Room ${code}: ${bots.length} bot tersambung dalam ${(performance.now() - connectStart).toFixed(0)} ms`);

  // Pemanasan 3 detik supaya posisi awal tersebar sebelum diukur.
  let last = performance.now();
  const stepAll = () => {
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    for (const bot of bots) bot.step(dt);
  };
  const tickTimer = setInterval(stepAll, TICK_MS);
  await sleep(3000);

  const h0 = await health();
  const d0 = await dockerSample();
  const t0 = performance.now();
  for (const bot of bots) bot.measuring = true;

  const pingTimer = setInterval(() => {
    for (const bot of bots) bot.ping();
  }, 1000);
  const chatTimer = setInterval(() => {
    // Tiap 100 ms, peluang chat per bot = 0,1 / chatEvery → rata-rata 1 chat per `chatEvery` detik.
    for (const bot of bots) if (Math.random() < 0.1 / args.chatEvery) bot.chat();
  }, 100);

  // Sampel docker stats berkala selama pengukuran (CPU % sesaat dan RAM).
  const dockerSamples = [];
  const healthSamples = [];
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      const [d, h] = await Promise.all([dockerSample(), health().catch(() => null)]);
      if (d) dockerSamples.push(d);
      if (h) healthSamples.push(h);
      await sleep(2000);
    }
  })();

  const progressTimer = setInterval(() => {
    const elapsed = (performance.now() - t0) / 1000;
    const rtts = bots.flatMap((b) => b.rtts).sort((a, b) => a - b);
    process.stdout.write(`  t=${elapsed.toFixed(0)}s  ping p95=${percentile(rtts, 95)?.toFixed(1)} ms  sampel=${rtts.length}\n`);
  }, 10_000);

  await sleep(args.duration * 1000);
  for (const bot of bots) bot.measuring = false;
  const elapsedSec = (performance.now() - t0) / 1000;
  sampling = false;
  clearInterval(progressTimer);
  clearInterval(pingTimer);
  clearInterval(chatTimer);
  clearInterval(tickTimer);
  await sampler;

  const h1 = await health();
  const d1 = await dockerSample();

  // CPU dari process.cpuUsage() server: (Δuser + Δsystem) / Δwaktu. 100 % = satu core penuh.
  const cpuMicros = h1.process.cpuUserMicros + h1.process.cpuSystemMicros - (h0.process.cpuUserMicros + h0.process.cpuSystemMicros);
  const serverUptimeDelta = elapsedSec;
  const cpuPctProcess = (cpuMicros / 1e6 / serverUptimeDelta) * 100;
  const rssValues = healthSamples.map((h) => h.process.rssBytes);
  const dockerCpu = dockerSamples.map((s) => Number.parseFloat(s.CPUPerc)).filter(Number.isFinite);
  const dockerMem = dockerSamples.map((s) => parseSize((s.MemUsage ?? '').split('/')[0])).filter(Number.isFinite);
  const [rx0, tx0] = parseNet(d0);
  const [rx1, tx1] = parseNet(d1);

  const rtts = bots.flatMap((b) => b.rtts).sort((a, b) => a - b);
  const sum = (f) => bots.reduce((acc, b) => acc + f(b), 0);
  const bytesIn = sum((b) => b.bytesIn);
  const bytesOut = sum((b) => b.bytesOut);
  const rejectedDelta = {};
  for (const [reason, count] of Object.entries(h1.rejected ?? {})) {
    const diff = count - (h0.rejected?.[reason] ?? 0);
    if (diff > 0) rejectedDelta[reason] = diff;
  }
  const rejectedTotal = Object.values(rejectedDelta).reduce((a, b) => a + b, 0);
  const disconnected = bots.filter((b) => b.closedCode !== null).length;

  const result = {
    bots: args.bots,
    durationSec: Number(elapsedSec.toFixed(1)),
    room: code,
    latencyMs: {
      samples: rtts.length,
      p50: Number(percentile(rtts, 50).toFixed(2)),
      p95: Number(percentile(rtts, 95).toFixed(2)),
      p99: Number(percentile(rtts, 99).toFixed(2)),
      max: Number((rtts[rtts.length - 1] ?? NaN).toFixed(2)),
    },
    serverCpu: {
      processAvgPctOfOneCore: Number(cpuPctProcess.toFixed(2)),
      dockerAvgPct: dockerCpu.length ? Number((dockerCpu.reduce((a, b) => a + b, 0) / dockerCpu.length).toFixed(2)) : null,
      dockerMaxPct: dockerCpu.length ? Math.max(...dockerCpu) : null,
      dockerSamples: dockerCpu.length,
    },
    serverMemory: {
      rssStartMB: Number((h0.process.rssBytes / 1e6).toFixed(1)),
      rssEndMB: Number((h1.process.rssBytes / 1e6).toFixed(1)),
      rssMaxMB: rssValues.length ? Number((Math.max(...rssValues) / 1e6).toFixed(1)) : null,
      dockerMaxMB: dockerMem.length ? Number((Math.max(...dockerMem) / 1e6).toFixed(1)) : null,
    },
    bandwidth: {
      // Payload WebSocket yang diukur di bot (tanpa header frame/TCP).
      serverToClientsPayloadKBps: Number((bytesIn / elapsedSec / 1e3).toFixed(1)),
      clientsToServerPayloadKBps: Number((bytesOut / elapsedSec / 1e3).toFixed(1)),
      perBotDownKBps: Number((bytesIn / elapsedSec / 1e3 / args.bots).toFixed(2)),
      perBotUpKBps: Number((bytesOut / elapsedSec / 1e3 / args.bots).toFixed(2)),
      // Jaringan container dari docker stats (termasuk header WS/TCP/IP).
      dockerRxKBps: Number.isFinite(rx1 - rx0) ? Number(((rx1 - rx0) / elapsedSec / 1e3).toFixed(1)) : null,
      dockerTxKBps: Number.isFinite(tx1 - tx0) ? Number(((tx1 - tx0) / elapsedSec / 1e3).toFixed(1)) : null,
      serverUploadMbps: Number.isFinite(tx1 - tx0) ? Number((((tx1 - tx0) * 8) / elapsedSec / 1e6).toFixed(2)) : null,
    },
    messages: {
      sentByBots: sum((b) => b.msgsOut),
      receivedByBots: sum((b) => b.msgsIn),
      stateMessagesReceived: sum((b) => b.statesIn),
      chatMessagesReceived: sum((b) => b.chatsIn),
    },
    rejected: { total: rejectedTotal, byReason: rejectedDelta },
    disconnectedBots: disconnected,
    gate: {
      p95Under150ms: percentile(rtts, 95) < 150,
      cpuUnder60pct: (dockerCpu.length ? Math.max(...dockerCpu) : cpuPctProcess) < 60,
    },
  };

  for (const bot of bots) bot.ws.close();
  await sleep(300);

  console.log('\n=== HASIL UJI BEBAN ===');
  console.log(`Bot: ${result.bots}, durasi ukur: ${result.durationSec} s, room ${result.room}, bot terputus: ${disconnected}`);
  console.log(`Latensi ping (RTT, ${result.latencyMs.samples} sampel): p50 ${result.latencyMs.p50} ms, p95 ${result.latencyMs.p95} ms, p99 ${result.latencyMs.p99} ms, max ${result.latencyMs.max} ms`);
  console.log(`CPU server: rata-rata proses ${result.serverCpu.processAvgPctOfOneCore}% (1 core)` + (result.serverCpu.dockerAvgPct !== null ? `, docker stats rata-rata ${result.serverCpu.dockerAvgPct}% / maks ${result.serverCpu.dockerMaxPct}% (${result.serverCpu.dockerSamples} sampel)` : ''));
  console.log(`RAM server: RSS ${result.serverMemory.rssStartMB} → ${result.serverMemory.rssEndMB} MB (maks ${result.serverMemory.rssMaxMB} MB)` + (result.serverMemory.dockerMaxMB !== null ? `, docker maks ${result.serverMemory.dockerMaxMB} MB` : ''));
  console.log(`Bandwidth payload: server→bot ${result.bandwidth.serverToClientsPayloadKBps} kB/s (${result.bandwidth.perBotDownKBps} kB/s per bot), bot→server ${result.bandwidth.clientsToServerPayloadKBps} kB/s (${result.bandwidth.perBotUpKBps} kB/s per bot)`);
  if (result.bandwidth.dockerTxKBps !== null) console.log(`Bandwidth container (docker): rx ${result.bandwidth.dockerRxKBps} kB/s, tx ${result.bandwidth.dockerTxKBps} kB/s (= ${result.bandwidth.serverUploadMbps} Mbit/s upload)`);
  console.log(`Pesan: dikirim bot ${result.messages.sentByBots}, diterima bot ${result.messages.receivedByBots} (state ${result.messages.stateMessagesReceived}, chat ${result.messages.chatMessagesReceived})`);
  console.log(`Pesan ditolak server: ${result.rejected.total} ${JSON.stringify(result.rejected.byReason)}`);
  console.log(`Gerbang M3: p95 < 150 ms = ${result.gate.p95Under150ms ? 'LULUS' : 'GAGAL'}, CPU < 60% = ${result.gate.cpuUnder60pct ? 'LULUS' : 'GAGAL'}`);
  if (args.json) writeFileSync(args.json, JSON.stringify(result, null, 2));
  void before;
}

main().catch((error) => {
  console.error('Uji beban gagal:', error.message);
  process.exit(1);
});

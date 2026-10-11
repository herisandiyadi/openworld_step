import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { DEFAULT_APPEARANCE } from '../src/appearance.js';
import { setLogSilent } from '../src/log.js';
import { decodeMessage, encodeMessage, type NetMessage } from '../src/protocol.js';
import { CLOSE, startServer, type RunningServer } from '../src/server.js';

let server: RunningServer;
let base = '';

beforeAll(async () => {
  setLogSilent(true);
  server = await startServer({ port: 0, host: '127.0.0.1' });
  base = `127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await server.stop();
});

interface Client {
  ws: WebSocket;
  messages: NetMessage[];
  closed: Promise<number>;
  waitFor<T extends NetMessage['type']>(type: T, predicate?: (m: Extract<NetMessage, { type: T }>) => boolean): Promise<Extract<NetMessage, { type: T }>>;
}

async function connect(code: string, token: string): Promise<Client> {
  const ws = new WebSocket(`ws://${base}/ws?room=${code}&token=${token}`);
  ws.binaryType = 'nodebuffer';
  const messages: NetMessage[] = [];
  const waiters: (() => void)[] = [];
  ws.on('message', (data: Buffer) => {
    const decoded = decodeMessage(new Uint8Array(data));
    if (decoded.ok) messages.push(decoded.message);
    for (const w of waiters.splice(0)) w();
  });
  const closed = new Promise<number>((resolve) => ws.on('close', (c) => resolve(c)));
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('close', () => resolve());
    ws.once('error', reject);
  });
  const waitFor: Client['waitFor'] = (type, predicate) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout menunggu ${type}`)), 3000);
      const check = () => {
        const found = messages.find((m) => m.type === type && (!predicate || predicate(m as never)));
        if (found) {
          clearTimeout(timer);
          resolve(found as never);
        } else waiters.push(check);
      };
      check();
    });
  return { ws, messages, closed, waitFor };
}

const WORLD_VERSION = '3.0.0-u4-fishing';

const post = async (path: string, worldVersion: string | null = WORLD_VERSION) => {
  const res = await fetch(`http://${base}${path}`, {
    method: 'POST',
    headers: worldVersion === null ? {} : { 'x-world-version': worldVersion },
  });
  return { status: res.status, body: (await res.json()) as { code: string; token: string; error?: string; message?: string } };
};

describe('server WebSocket end-to-end', () => {
  it('/health 200 + JSON', async () => {
    const res = await fetch(`http://${base}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: 'ok' });
    expect(typeof body.rooms).toBe('number');
    expect(typeof body.players).toBe('number');
    expect(typeof body.uptimeSec).toBe('number');
  });

  it('buat room, hello/welcome, playerJoin, ping/pong, chat, playerLeave', async () => {
    const created = await post('/rooms');
    expect(created.status).toBe(201);
    expect(created.body.code).toMatch(/^[A-Z2-9]{6}$/);
    const a = await connect(created.body.code, created.body.token);
    a.ws.send(encodeMessage({ type: 'hello', username: 'Budi', appearance: DEFAULT_APPEARANCE }));
    const welcome = await a.waitFor('welcome');
    expect(welcome.players).toHaveLength(1);

    const joined = await post(`/rooms/${created.body.code.toLowerCase()}/join`);
    expect(joined.status).toBe(200);
    const b = await connect(created.body.code, joined.body.token);
    b.ws.send(encodeMessage({ type: 'hello', username: 'Sari', appearance: DEFAULT_APPEARANCE }));
    await b.waitFor('welcome');
    const join = await a.waitFor('playerJoin');
    expect(join.player.username).toBe('Sari');

    a.ws.send(encodeMessage({ type: 'ping', nonce: 77 }));
    expect((await a.waitFor('pong')).nonce).toBe(77);

    const st = (x: number) => encodeMessage({ type: 'state', timeMs: 0, players: [{ id: 0, x, y: 0, z: 0, heading: 0, mode: 'walk', anim: 'walk', jumping: false }] });
    a.ws.send(st(0));
    b.ws.send(st(5));
    const snap = await b.waitFor('state', (m) => m.players.some((p) => p.id === welcome.playerId));
    expect(snap.players[0]?.x).toBeCloseTo(0, 1);

    a.ws.send(encodeMessage({ type: 'chat', channel: 'session', fromId: 0, msgId: 0, timeMs: 0, text: 'halo' }));
    const chat = await b.waitFor('chat');
    expect(chat).toMatchObject({ text: 'halo', fromId: welcome.playerId, channel: 'session' });

    a.ws.close();
    expect((await b.waitFor('playerLeave')).playerId).toBe(welcome.playerId);
    b.ws.close();
  });

  it('menolak create/join tanpa worldVersion atau dengan versi berbeda secara jelas', async () => {
    const missing = await post('/rooms', null);
    expect(missing).toMatchObject({
      status: 400,
      body: { error: 'world-version-required', message: 'Perbarui konten dulu: worldVersion wajib dikirim.' },
    });

    const created = await post('/rooms');
    expect(created.status).toBe(201);
    const mismatch = await post(`/rooms/${created.body.code}/join`, '2.0.0-old-world');
    expect(mismatch).toMatchObject({
      status: 409,
      body: { error: 'world-version', message: `Perbarui konten dulu: room memakai worldVersion ${WORLD_VERSION}.` },
    });
    const compatible = await post(`/rooms/${created.body.code}/join`);
    expect(compatible.status).toBe(200);
  });

  it('room/token salah ditutup dengan kode aplikasi', async () => {
    const bad = await connect('ZZZZZZ', 'x');
    expect(await bad.closed).toBe(CLOSE.badRoom);
    const created = await post('/rooms');
    const badToken = await connect(created.body.code, 'palsu');
    expect(await badToken.closed).toBe(CLOSE.badToken);
  });

  it('sampah biner dan pesan besar tidak mematikan server', async () => {
    const created = await post('/rooms');
    const c = await connect(created.body.code, created.body.token);
    c.ws.send(encodeMessage({ type: 'hello', username: 'Penguji', appearance: DEFAULT_APPEARANCE }));
    await c.waitFor('welcome');
    for (let i = 0; i < 50; i++) c.ws.send(Buffer.from([1, 3, 0xff, i]));
    c.ws.send('teks bukan biner');
    c.ws.send(Buffer.alloc(4096));
    // Pesan > maxPayload memutus koneksi (1009); server tetap sehat.
    expect(await c.closed).toBe(1009);
    const res = await fetch(`http://${base}/health`);
    expect(res.status).toBe(200);
    // 50 frame state terpotong → length, 1 frame teks → text-frame.
    expect(server.stats.rejected.length ?? 0).toBeGreaterThanOrEqual(50);
    expect(server.stats.rejected['text-frame'] ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('banjir pesan diputus karena rate limit', async () => {
    const created = await post('/rooms');
    const c = await connect(created.body.code, created.body.token);
    c.ws.send(encodeMessage({ type: 'hello', username: 'Spammer', appearance: DEFAULT_APPEARANCE }));
    await c.waitFor('welcome');
    const ping = encodeMessage({ type: 'ping', nonce: 1 });
    for (let i = 0; i < 400; i++) c.ws.send(ping);
    expect(await c.closed).toBe(CLOSE.policy);
    expect(server.stats.rejected['msg-rate'] ?? 0).toBeGreaterThan(0);
  });
});

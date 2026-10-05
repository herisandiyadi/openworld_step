import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { log } from './log.js';
import { type PlayerId } from './protocol.js';
import { isRoomCode, RoomManager, type Room, type RoomPlayer } from './room.js';
import {
  addStrike,
  MAX_MESSAGE_BYTES,
  MSG_BURST,
  MSG_RATE_PER_SEC,
  newRateBucket,
  takeToken,
  validateIncoming,
  type RateBucket,
  type RejectReason,
  type StrikeCounter,
} from './validate.js';

/* ------------------------------------------------------------------------------------------------
 * Alur koneksi (protokol biner di wire TIDAK diubah, lihat NET_PROTOCOL.md):
 *   1. POST /rooms                 → 201 {"code":"ABC234","token":"..."}   (buat room baru)
 *      POST /rooms/ABC234/join     → 200 {"code":"ABC234","token":"..."}   (gabung room yang ada)
 *   2. WebSocket  /ws?room=ABC234&token=...   (frame biner saja)
 *   3. Klien mengirim `hello`, server membalas `welcome` (atau menutup koneksi kalau ditolak).
 * Token sesi anonim mengikat koneksi ke room dan bisa dipakai lagi untuk reconnect.
 * ---------------------------------------------------------------------------------------------- */

export const TICK_HZ = 15;
/** Klien harus mengirim `hello` dalam waktu ini setelah tersambung. */
export const HELLO_TIMEOUT_MS = 10_000;
/** Koneksi tanpa pesan apa pun selama ini dianggap mati (ping protokol klien ~1-2 detik). */
export const IDLE_TIMEOUT_MS = 30_000;
/** Batas pembuatan room per IP (token bucket): 1 per 5 detik, burst 5. */
const ROOM_CREATE_RATE_PER_SEC = 0.2;
const ROOM_CREATE_BURST = 5;
/** Batas koneksi WebSocket per IP (mencegah satu host menghabiskan slot). */
export const MAX_CONNECTIONS_PER_IP = 60;

/** Kode close WebSocket yang dipakai server (4000-4999 = khusus aplikasi). */
export const CLOSE = {
  badRoom: 4004,
  badToken: 4001,
  roomFull: 4003,
  username: 4002,
  helloTimeout: 4008,
  policy: 1008,
  idle: 4010,
  shutdown: 1001,
} as const;

export interface ServerOptions {
  port: number;
  host?: string;
  maxRooms?: number;
  maxPlayersPerRoom?: number;
  emptyRoomTtlMs?: number;
  /** Batas koneksi per IP; default MAX_CONNECTIONS_PER_IP. Uji beban dari satu mesin bisa menaikkannya. */
  maxConnectionsPerIp?: number;
  /** Percaya header X-Forwarded-For (hanya kalau di belakang reverse proxy sendiri, mis. Caddy). */
  trustProxy?: boolean;
}

interface ConnState {
  id: number;
  ip: string;
  room: Room;
  token: string;
  player: RoomPlayer | null;
  bucket: RateBucket;
  strikes: StrikeCounter;
  lastSeenMs: number;
  helloTimer: NodeJS.Timeout | null;
}

export interface ServerStats {
  connectionsOpened: number;
  connections: number;
  bytesIn: number;
  messagesIn: number;
  rejected: Partial<Record<RejectReason, number>>;
}

export interface RunningServer {
  readonly port: number;
  readonly rooms: RoomManager;
  readonly stats: ServerStats;
  stop(): Promise<void>;
}

const json = (res: ServerResponse, status: number, body: unknown): void => {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store',
    // Klien game berjalan dari WebView/origin lain; endpoint ini tidak memakai cookie.
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(data);
};

const toUint8 = (data: RawData): Uint8Array => {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
};

export function startServer(options: ServerOptions): Promise<RunningServer> {
  const startedAt = Date.now();
  const trustProxy = options.trustProxy ?? false;
  const maxPerIp = options.maxConnectionsPerIp ?? MAX_CONNECTIONS_PER_IP;
  const stats: ServerStats = { connectionsOpened: 0, connections: 0, bytesIn: 0, messagesIn: 0, rejected: {} };
  const rooms = new RoomManager({
    maxRooms: options.maxRooms ?? 100,
    maxPlayers: options.maxPlayersPerRoom ?? 50,
    emptyTtlMs: options.emptyRoomTtlMs,
    onReject: (code, playerId, reason) => countReject(reason, code, playerId),
  });
  const createBuckets = new Map<string, RateBucket>();
  const perIp = new Map<string, number>();
  const sockets = new Set<WebSocket>();
  /** Status heartbeat per socket (ping/pong bawaan ws, terpisah dari ping protokol game). */
  const alive = new WeakMap<WebSocket, boolean>();
  let nextConnId = 1;

  function countReject(reason: RejectReason, room: string | null, playerId: PlayerId | null): void {
    stats.rejected[reason] = (stats.rejected[reason] ?? 0) + 1;
    // Penolakan bisa ribuan per detik dari klien jahat: log hanya sampel (tiap ke-1, 10, 100, ...).
    const count = stats.rejected[reason] as number;
    if (count === 1 || Math.log10(count) % 1 === 0) log('warn', 'reject', { reason, room, playerId, total: count });
  }

  function clientIp(req: IncomingMessage): string {
    if (trustProxy) {
      const forwarded = req.headers['x-forwarded-for'];
      const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
      if (first) return first;
    }
    return req.socket.remoteAddress ?? 'unknown';
  }

  function health(): Record<string, unknown> {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    let bytesOut = 0;
    let droppedUnreliable = 0;
    for (const room of rooms.rooms.values()) {
      bytesOut += room.stats.bytesOut;
      droppedUnreliable += room.stats.droppedUnreliable;
    }
    return {
      status: 'ok',
      rooms: rooms.rooms.size,
      players: rooms.playerCount,
      connections: stats.connections,
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      // Angka mentah untuk uji beban (loadtest/bots.mjs menghitung CPU % dari selisihnya).
      process: { rssBytes: mem.rss, heapUsedBytes: mem.heapUsed, cpuUserMicros: cpu.user, cpuSystemMicros: cpu.system },
      traffic: { bytesIn: stats.bytesIn, messagesIn: stats.messagesIn, bytesOutRoomPayload: bytesOut, droppedUnreliable },
      rejected: stats.rejected,
    };
  }

  function handleHttp(req: IncomingMessage, res: ServerResponse): void {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'OPTIONS') {
        json(res, 204, {});
        return;
      }
      if (req.method === 'GET' && url.pathname === '/health') {
        json(res, 200, health());
        return;
      }
      if (req.method === 'POST' && url.pathname === '/rooms') {
        const ip = clientIp(req);
        const now = Date.now();
        const bucket = createBuckets.get(ip) ?? newRateBucket(now, ROOM_CREATE_BURST);
        createBuckets.set(ip, bucket);
        if (!takeToken(bucket, now, ROOM_CREATE_RATE_PER_SEC, ROOM_CREATE_BURST)) {
          json(res, 429, { error: 'rate-limit' });
          return;
        }
        const room = rooms.create();
        if (!room) {
          json(res, 503, { error: 'server-full' });
          return;
        }
        log('info', 'room-create', { room: room.code });
        json(res, 201, { code: room.code, token: room.issueToken() });
        return;
      }
      const joinMatch = /^\/rooms\/([A-Za-z0-9]{6})\/join$/.exec(url.pathname);
      if (req.method === 'POST' && joinMatch) {
        const code = (joinMatch[1] as string).toUpperCase();
        const room = isRoomCode(code) ? rooms.get(code) : undefined;
        if (!room) {
          json(res, 404, { error: 'room-not-found' });
          return;
        }
        if (room.isFull) {
          json(res, 409, { error: 'room-full' });
          return;
        }
        json(res, 200, { code: room.code, token: room.issueToken() });
        return;
      }
      json(res, 404, { error: 'not-found' });
    } catch (error) {
      log('error', 'http-error', { message: error instanceof Error ? error.message : String(error) });
      if (!res.headersSent) json(res, 500, { error: 'internal' });
    }
  }

  const http: HttpServer = createHttpServer(handleHttp);
  const wss = new WebSocketServer({
    noServer: true,
    // Frame di atas batas ditutup oleh `ws` dengan kode 1009 sebelum masuk ke handler.
    maxPayload: MAX_MESSAGE_BYTES,
    // Kompresi dimatikan: pesan kecil dan biner, deflate hanya menambah CPU.
    perMessageDeflate: false,
  });

  http.on('upgrade', (req, socket, head) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const ip = clientIp(req);
      if (url.pathname !== '/ws') {
        socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
        return;
      }
      if ((perIp.get(ip) ?? 0) >= maxPerIp) {
        socket.end('HTTP/1.1 429 Too Many Requests\r\n\r\n');
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, url, ip));
    } catch (error) {
      log('error', 'upgrade-error', { message: error instanceof Error ? error.message : String(error) });
      socket.destroy();
    }
  });

  function onConnection(ws: WebSocket, url: URL, ip: string): void {
    const connId = nextConnId++;
    const code = (url.searchParams.get('room') ?? '').toUpperCase();
    const token = url.searchParams.get('token') ?? '';
    const room = isRoomCode(code) ? rooms.get(code) : undefined;
    if (!room) {
      ws.close(CLOSE.badRoom, 'room-not-found');
      return;
    }
    if (!room.canUseToken(token)) {
      ws.close(CLOSE.badToken, 'bad-token');
      return;
    }
    sockets.add(ws);
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    stats.connectionsOpened++;
    stats.connections++;
    const now = Date.now();
    const conn: ConnState = {
      id: connId,
      ip,
      room,
      token,
      player: null,
      bucket: newRateBucket(now, MSG_BURST),
      strikes: { strikes: 0, updatedMs: now },
      lastSeenMs: now,
      helloTimer: setTimeout(() => {
        if (!conn.player) ws.close(CLOSE.helloTimeout, 'hello-timeout');
      }, HELLO_TIMEOUT_MS),
    };
    log('info', 'connect', { conn: connId, room: room.code, ip });

    const connection = {
      send: (data: Uint8Array) => {
        if (ws.readyState === ws.OPEN) ws.send(data, { binary: true });
      },
      get bufferedAmount() {
        return ws.bufferedAmount;
      },
    };

    const strike = (reason: RejectReason): void => {
      countReject(reason, room.code, conn.player?.info.id ?? null);
      if (addStrike(conn.strikes, Date.now())) {
        log('warn', 'kick', { conn: connId, room: room.code, playerId: conn.player?.info.id ?? null, reason: 'too-many-rejects' });
        ws.close(CLOSE.policy, 'too-many-rejects');
      }
    };

    ws.on('message', (raw, isBinary) => {
      try {
        const nowMs = Date.now();
        conn.lastSeenMs = nowMs;
        const data = toUint8(raw);
        stats.bytesIn += data.length;
        stats.messagesIn++;
        if (!isBinary) {
          strike('text-frame');
          return;
        }
        // Rate limit umum per koneksi (semua jenis pesan).
        if (!takeToken(conn.bucket, nowMs, MSG_RATE_PER_SEC, MSG_BURST)) {
          strike('msg-rate');
          return;
        }
        const result = validateIncoming(data);
        if (!result.ok) {
          strike(result.reason);
          return;
        }
        const message = result.message;
        if (!conn.player) {
          if (message.type !== 'hello') {
            strike('not-joined');
            return;
          }
          const joined = room.join(token, connection, message.username, message.appearance);
          if (!joined.ok) {
            const closeCode = joined.reason === 'room-full' ? CLOSE.roomFull : joined.reason === 'username' ? CLOSE.username : CLOSE.badToken;
            ws.close(closeCode, joined.reason);
            return;
          }
          conn.player = joined.player;
          if (conn.helloTimer) clearTimeout(conn.helloTimer);
          conn.helloTimer = null;
          log('info', 'join', { conn: connId, room: room.code, playerId: joined.player.info.id, players: room.size });
          return;
        }
        room.handle(conn.player, message);
      } catch (error) {
        // Satu pesan tidak boleh mematikan server.
        log('error', 'message-error', { conn: connId, room: room.code, message: error instanceof Error ? error.message : String(error) });
      }
    });

    ws.on('error', (error) => {
      log('warn', 'socket-error', { conn: connId, room: room.code, message: error.message });
    });

    ws.on('close', (closeCode) => {
      sockets.delete(ws);
      stats.connections--;
      const left = (perIp.get(ip) ?? 1) - 1;
      if (left <= 0) perIp.delete(ip);
      else perIp.set(ip, left);
      if (conn.helloTimer) clearTimeout(conn.helloTimer);
      const playerId = conn.player?.info.id ?? null;
      if (conn.player) room.leave(conn.player);
      conn.player = null;
      log('info', 'disconnect', { conn: connId, room: room.code, playerId, code: closeCode, players: room.size });
    });
  }

  // Loop simulasi: 15 Hz untuk AOI/snapshot, plus pembersihan berkala.
  const tickTimer = setInterval(() => {
    try {
      rooms.tickAll();
    } catch (error) {
      log('error', 'tick-error', { message: error instanceof Error ? error.message : String(error) });
    }
  }, 1000 / TICK_HZ);
  const sweepTimer = setInterval(() => {
    for (const code of rooms.sweep()) log('info', 'room-expire', { room: code });
    const now = Date.now();
    // Bucket pembuatan room untuk IP yang sudah lama tidak muncul dibuang supaya map tidak tumbuh.
    for (const [ip, bucket] of createBuckets) {
      if (now - bucket.updatedMs > 60_000) createBuckets.delete(ip);
    }
  }, 5_000);

  // Deteksi koneksi mati di tingkat WebSocket (ping/pong bawaan ws), terpisah dari ping protokol game.
  const heartbeatTimer = setInterval(() => {
    for (const ws of sockets) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    }
  }, IDLE_TIMEOUT_MS / 2);

  return new Promise((resolve, reject) => {
    http.once('error', reject);
    http.listen(options.port, options.host ?? '0.0.0.0', () => {
      http.off('error', reject);
      const address = http.address();
      const port = typeof address === 'object' && address ? address.port : options.port;
      log('info', 'listen', { port });
      resolve({
        port,
        rooms,
        stats,
        stop: () =>
          new Promise<void>((done) => {
            clearInterval(tickTimer);
            clearInterval(sweepTimer);
            clearInterval(heartbeatTimer);
            for (const ws of sockets) ws.close(CLOSE.shutdown, 'server-shutdown');
            // Beri waktu frame close terkirim, lalu paksa.
            setTimeout(() => {
              for (const ws of sockets) ws.terminate();
              wss.close();
              http.close(() => done());
              http.closeAllConnections();
            }, 200).unref();
          }),
      });
    });
  });
}

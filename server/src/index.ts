import { log } from './log.js';
import { startServer, type RunningServer } from './server.js';

/**
 * Entry point. Konfigurasi lewat environment variable (lihat README.md).
 * Graceful shutdown pada SIGTERM/SIGINT: koneksi ditutup dengan kode 1001, lalu proses keluar.
 */

const intEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const port = intEnv('PORT', 8787);

const server: RunningServer = await startServer({
  port,
  host: process.env.HOST ?? '0.0.0.0',
  maxRooms: intEnv('MAX_ROOMS', 100),
  maxPlayersPerRoom: intEnv('MAX_PLAYERS', 50),
  emptyRoomTtlMs: intEnv('ROOM_EMPTY_TTL_MS', 60_000),
  maxConnectionsPerIp: intEnv('MAX_CONNECTIONS_PER_IP', 60),
  trustProxy: process.env.TRUST_PROXY === '1',
});

log('info', 'ready', { port: server.port, pid: process.pid, node: process.version });

let shuttingDown = false;
const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  log('info', 'shutdown', { signal, rooms: server.rooms.rooms.size, players: server.rooms.playerCount });
  await server.stop();
  log('info', 'stopped', {});
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
// Error tak tertangkap dicatat; server tetap hidup supaya satu bug tidak memutus seluruh room.
process.on('uncaughtException', (error) => log('error', 'uncaught', { message: error.message, stack: error.stack ?? null }));
process.on('unhandledRejection', (reason) => log('error', 'unhandled-rejection', { message: String(reason) }));

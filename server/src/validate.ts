import {
  CHAT_TEXT_MAX,
  decodeMessage,
  inWorldBounds,
  USERNAME_BYTES_MAX,
  HEADER_BYTES,
  type DecodeError,
  type NetMessage,
} from './protocol.js';

/* ------------------------------------------------------------------------------------------------
 * Konstanta validasi. Angka gameplay SAMA dengan web/src/net/session.ts supaya server berperilaku
 * identik dengan host lokal (MULTIPLAYER.md 5.1, 6; NET_PROTOCOL.md 5).
 * ---------------------------------------------------------------------------------------------- */

/** Kecepatan maksimum (m/s): mobil 18 m/s + toleransi 40 % = 25,2 m/s. */
export const MAX_PLAYER_SPEED = 18 * 1.4;
/** Slack jarak tetap supaya paket yang menumpuk tidak salah ditolak. */
export const SPEED_SLACK_M = 2;
/** Jarak maksimum pemain ke kendaraan saat klaim (m). */
export const VEHICLE_REACH = 6;
/** Radius kanal chat "Dekat" (m). */
export const NEARBY_CHAT_RADIUS = 30;
/** Rate limit chat per pemain: 1 pesan/detik, burst 5. */
export const CHAT_RATE_PER_SEC = 1;
export const CHAT_BURST = 5;
export { CHAT_TEXT_MAX };

/**
 * Ukuran maksimum satu pesan dari klien (byte). Pesan klien terbesar yang sah adalah `chat`
 * (2 + 13 + 800 = 815 byte); `hello` maks. 2 + 4 + 1 + 80 = 87 byte. 1024 memberi sedikit ruang.
 */
export const MAX_MESSAGE_BYTES = 1024;
/**
 * Rate limit umum per koneksi. Klien normal mengirim state 15 Hz + ping ~1 Hz + chat sesekali
 * (< 20 pesan/detik), jadi 40/detik dengan burst 80 tidak mengganggu klien jujur.
 */
export const MSG_RATE_PER_SEC = 40;
export const MSG_BURST = 80;
/**
 * Pelanggaran (pesan ditolak) berkurang 5 per detik; kalau menumpuk melebihi batas ini,
 * koneksi diputus (close 1008). Mencegah klien rusak/jahat membanjiri server.
 */
export const STRIKE_DECAY_PER_SEC = 5;
export const STRIKE_LIMIT = 100;

/** Pesan yang boleh dikirim klien ke server. Sisanya host-only. */
const CLIENT_TYPES: ReadonlySet<NetMessage['type']> = new Set(['hello', 'state', 'appearance', 'chat', 'vehicleClaim', 'ping']);

export type RejectReason =
  | DecodeError
  | 'too-large'
  | 'text-frame'
  | 'not-joined'
  | 'already-joined'
  | 'username'
  | 'room-full'
  | 'rate-limit'
  | 'msg-rate'
  | 'chat-text'
  | 'speed'
  | 'vehicle-taken'
  | 'vehicle-unknown'
  | 'vehicle-far'
  | 'not-owner'
  | 'unexpected';

export type ValidateResult = { ok: true; message: NetMessage } | { ok: false; reason: RejectReason };

/**
 * Validasi struktural pesan masuk: ukuran, skema biner (lewat decoder protokol yang sama dengan
 * klien), arah pesan, dan aturan khusus klien → server. Tidak pernah melempar exception.
 */
export function validateIncoming(data: Uint8Array): ValidateResult {
  if (data.length > MAX_MESSAGE_BYTES) return { ok: false, reason: 'too-large' };
  if (data.length < HEADER_BYTES) return { ok: false, reason: 'empty' };
  let decoded;
  try {
    decoded = decodeMessage(data);
  } catch {
    // Decoder tidak seharusnya melempar, tetapi server tidak boleh mati karena satu pesan.
    return { ok: false, reason: 'field' };
  }
  if (!decoded.ok) return { ok: false, reason: decoded.error };
  const message = decoded.message;
  if (!CLIENT_TYPES.has(message.type)) return { ok: false, reason: 'unexpected' };
  switch (message.type) {
    case 'state':
      // Klien → server harus tepat 1 entri (NET_PROTOCOL.md 3, `state`).
      if (message.players.length !== 1) return { ok: false, reason: 'field' };
      break;
    case 'hello':
      if (new TextEncoder().encode(message.username).length > USERNAME_BYTES_MAX) return { ok: false, reason: 'text' };
      break;
    case 'vehicleClaim':
      if (!inWorldBounds(message.x, message.z)) return { ok: false, reason: 'bounds' };
      break;
    default:
      break;
  }
  return { ok: true, message };
}

export const distance2d = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * Anti-teleport (sama dengan session.ts): benar kalau perpindahan dari `prev` ke `next` dalam
 * `dtMs` masih masuk akal dan posisi baru di dalam peta.
 */
export function isPlausibleMove(prev: { x: number; z: number } | null, next: { x: number; z: number }, dtMs: number): boolean {
  if (!inWorldBounds(next.x, next.z)) return false;
  if (!prev) return true;
  const dt = Math.max(0, dtMs) / 1000;
  return distance2d(prev, next) <= MAX_PLAYER_SPEED * dt + SPEED_SLACK_M;
}

/* ------------------------------------------------------------------------------------------------
 * Token bucket
 * ---------------------------------------------------------------------------------------------- */

export interface RateBucket {
  tokens: number;
  updatedMs: number;
}

export const newRateBucket = (nowMs: number, burst: number = CHAT_BURST): RateBucket => ({ tokens: burst, updatedMs: nowMs });

/** Mengambil satu token kalau ada. Mengubah `bucket` di tempat. Default = aturan chat. */
export function takeToken(bucket: RateBucket, nowMs: number, ratePerSec: number = CHAT_RATE_PER_SEC, burst: number = CHAT_BURST): boolean {
  const elapsed = Math.max(0, nowMs - bucket.updatedMs) / 1000;
  bucket.tokens = Math.min(burst, bucket.tokens + elapsed * ratePerSec);
  bucket.updatedMs = nowMs;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

/** Penghitung pelanggaran yang meluruh; mengembalikan true kalau koneksi harus diputus. */
export interface StrikeCounter {
  strikes: number;
  updatedMs: number;
}

export function addStrike(counter: StrikeCounter, nowMs: number): boolean {
  const elapsed = Math.max(0, nowMs - counter.updatedMs) / 1000;
  counter.strikes = Math.max(0, counter.strikes - elapsed * STRIKE_DECAY_PER_SEC) + 1;
  counter.updatedMs = nowMs;
  return counter.strikes > STRIKE_LIMIT;
}

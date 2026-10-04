import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE } from '../src/appearance.js';
import { encodeMessage, HALF_WORLD, MSG } from '../src/protocol.js';
import {
  addStrike,
  CHAT_BURST,
  isPlausibleMove,
  MAX_MESSAGE_BYTES,
  MAX_PLAYER_SPEED,
  MSG_BURST,
  MSG_RATE_PER_SEC,
  newRateBucket,
  SPEED_SLACK_M,
  STRIKE_LIMIT,
  takeToken,
  validateIncoming,
} from '../src/validate.js';

describe('anti-teleport', () => {
  it('angka sama dengan klien: 25,2 m/s + slack 2 m', () => {
    expect(MAX_PLAYER_SPEED).toBeCloseTo(25.2, 10);
    expect(SPEED_SLACK_M).toBe(2);
  });

  it('gerak wajar diterima, lompatan jauh ditolak', () => {
    // 100 ms: batas = 25,2 × 0,1 + 2 = 4,52 m.
    expect(isPlausibleMove({ x: 0, z: 0 }, { x: 4, z: 0 }, 100)).toBe(true);
    expect(isPlausibleMove({ x: 0, z: 0 }, { x: 10, z: 0 }, 100)).toBe(false);
    // Tanpa posisi sebelumnya (spawn) selalu diterima selama di dalam peta.
    expect(isPlausibleMove(null, { x: 100, z: 100 }, 0)).toBe(true);
    expect(isPlausibleMove(null, { x: HALF_WORLD + 1, z: 0 }, 0)).toBe(false);
    expect(isPlausibleMove({ x: 0, z: 0 }, { x: Number.NaN, z: 0 }, 100)).toBe(false);
  });
});

describe('rate limit', () => {
  it('chat: 1/detik burst 5', () => {
    const bucket = newRateBucket(0);
    for (let i = 0; i < CHAT_BURST; i++) expect(takeToken(bucket, 0)).toBe(true);
    expect(takeToken(bucket, 0)).toBe(false);
    expect(takeToken(bucket, 500)).toBe(false);
    expect(takeToken(bucket, 1000)).toBe(true);
    expect(takeToken(bucket, 1000)).toBe(false);
  });

  it('umum per koneksi: 40/detik burst 80', () => {
    const bucket = newRateBucket(0, MSG_BURST);
    for (let i = 0; i < MSG_BURST; i++) expect(takeToken(bucket, 0, MSG_RATE_PER_SEC, MSG_BURST)).toBe(true);
    expect(takeToken(bucket, 0, MSG_RATE_PER_SEC, MSG_BURST)).toBe(false);
    // 15 Hz state + 1 Hz ping selama 10 detik tidak pernah kena limit.
    const normal = newRateBucket(0, MSG_BURST);
    let ok = true;
    for (let tick = 0; tick < 160; tick++) {
      const now = tick * (1000 / 16);
      if (!takeToken(normal, now, MSG_RATE_PER_SEC, MSG_BURST)) ok = false;
    }
    expect(ok).toBe(true);
  });

  it('pelanggaran menumpuk sampai batas lalu koneksi diputus', () => {
    const counter = { strikes: 0, updatedMs: 0 };
    let kicked = false;
    for (let i = 0; i < STRIKE_LIMIT + 2 && !kicked; i++) kicked = addStrike(counter, 0);
    expect(kicked).toBe(true);
    // Meluruh 5/detik: setelah 60 detik tenang, tidak langsung diputus lagi.
    const calm = { strikes: STRIKE_LIMIT, updatedMs: 0 };
    expect(addStrike(calm, 60_000)).toBe(false);
  });
});

describe('validateIncoming', () => {
  const hello = encodeMessage({ type: 'hello', username: 'Budi', appearance: DEFAULT_APPEARANCE });

  it('pesan klien yang sah diterima', () => {
    const result = validateIncoming(hello);
    expect(result.ok).toBe(true);
  });

  it('pesan host-only dari klien ditolak', () => {
    for (const bytes of [
      encodeMessage({ type: 'welcome', playerId: 1, timeOfDay: 0, players: [] }),
      encodeMessage({ type: 'clock', timeOfDay: 0, timeMs: 0 }),
      encodeMessage({ type: 'playerLeave', playerId: 1 }),
      encodeMessage({ type: 'pong', nonce: 1 }),
      encodeMessage({ type: 'vehicleState', vehicleId: 'v', ownerId: 1, x: 0, z: 0, yaw: 0 }),
      encodeMessage({ type: 'playerJoin', player: { id: 1, username: 'A1', appearance: DEFAULT_APPEARANCE } }),
    ]) {
      expect(validateIncoming(bytes)).toEqual({ ok: false, reason: 'unexpected' });
    }
  });

  it('state dari klien harus tepat 1 entri', () => {
    const one = encodeMessage({
      type: 'state', timeMs: 1, players: [{ id: 0, x: 0, y: 0, z: 0, heading: 0, mode: 'walk', anim: 'idle', jumping: false }],
    });
    expect(validateIncoming(one).ok).toBe(true);
    const two = encodeMessage({
      type: 'state', timeMs: 1, players: [
        { id: 0, x: 0, y: 0, z: 0, heading: 0, mode: 'walk', anim: 'idle', jumping: false },
        { id: 1, x: 1, y: 0, z: 0, heading: 0, mode: 'walk', anim: 'idle', jumping: false },
      ],
    });
    expect(validateIncoming(two)).toEqual({ ok: false, reason: 'field' });
    const zero = encodeMessage({ type: 'state', timeMs: 1, players: [] });
    expect(validateIncoming(zero)).toEqual({ ok: false, reason: 'field' });
  });

  it('pesan terlalu besar dan buffer rusak ditolak tanpa melempar', () => {
    expect(validateIncoming(new Uint8Array(MAX_MESSAGE_BYTES + 1))).toEqual({ ok: false, reason: 'too-large' });
    expect(validateIncoming(new Uint8Array(0))).toEqual({ ok: false, reason: 'empty' });
    // hello dengan penampilan terpotong (butuh 4 byte) → length; panjang username melebihi buffer → text.
    expect(validateIncoming(new Uint8Array([1, MSG.hello, 1, 0]))).toEqual({ ok: false, reason: 'length' });
    expect(validateIncoming(new Uint8Array([1, MSG.hello, 1, 0x41, 0x08, 0, 9, 0x61]))).toEqual({ ok: false, reason: 'text' });
    expect(validateIncoming(new Uint8Array([9, 9, 9]))).toEqual({ ok: false, reason: 'version' });
  });

  it('chat 200 karakter lolos, 201 ditolak', () => {
    const ok = encodeMessage({ type: 'chat', channel: 'session', fromId: 0, msgId: 0, timeMs: 0, text: 'a'.repeat(200) });
    expect(validateIncoming(ok).ok).toBe(true);
    // 201 karakter tidak bisa di-encode oleh encoder, jadi buffer dibuat manual.
    const payload = Buffer.from('a'.repeat(201), 'utf8');
    const bytes = new Uint8Array([1, MSG.chat, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, (payload.length >> 8) & 0xff, payload.length & 0xff, ...payload]);
    expect(validateIncoming(bytes)).toEqual({ ok: false, reason: 'text' });
  });
});

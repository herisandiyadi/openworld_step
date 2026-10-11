import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE } from '../state/profile';
import { HALF_WORLD } from '../world/worldSpec';
import {
  CHAT_TEXT_MAX,
  decodeMessage,
  dequantizeHeading,
  dequantizeXZ,
  encodeMessage,
  HEADER_BYTES,
  isReliable,
  MSG,
  PROTOCOL_VERSION,
  quantizeHeading,
  quantizeXZ,
  sanitizeText,
  STATE_ENTRY_BYTES,
  FISHING_STATE_BYTES,
  FISHING_SPOT_ID_BYTES_MAX,
  type NetMessage,
  type PlayerSnapshot,
} from './protocol';

const snap = (over: Partial<PlayerSnapshot> = {}): PlayerSnapshot => ({
  id: 7,
  x: 12.5,
  y: 0.3,
  z: -40.25,
  heading: 1.2,
  mode: 'bike',
  anim: 'ride',
  jumping: false,
  ...over,
});

const roundTrip = (message: NetMessage): NetMessage => {
  const result = decodeMessage(encodeMessage(message));
  if (!result.ok) throw new Error(`decode gagal: ${result.error}`);
  return result.message;
};

describe('protocol encode/decode', () => {
  const look = { ...DEFAULT_APPEARANCE, gender: 'f' as const, hairColor: 2 };
  const samples: NetMessage[] = [
    { type: 'hello', username: 'Budi Ánh', appearance: look },
    {
      type: 'welcome',
      playerId: 3,
      timeOfDay: 123.5,
      players: [
        { id: 1, username: 'Host', appearance: DEFAULT_APPEARANCE },
        { id: 3, username: 'Sari', appearance: look },
      ],
    },
    { type: 'appearance', playerId: 4, appearance: look },
    { type: 'vehicleClaim', vehicleId: 'v_spawn_bike', action: 'mount', x: 5.25, z: -4, yaw: 0 },
    { type: 'vehicleClaim', vehicleId: 'v_spawn_bike', action: 'release', x: 10, z: 2.5, yaw: 1.5 },
    { type: 'vehicleState', vehicleId: 'v_96_96', ownerId: 2, x: 98, z: 108, yaw: 0.5 },
    { type: 'clock', timeOfDay: 240, timeMs: 123456 },
    { type: 'chat', channel: 'nearby', fromId: 2, msgId: 9, timeMs: 5000, text: 'Halo semua 👋' },
    { type: 'playerJoin', player: { id: 5, username: 'Tono', appearance: look } },
    { type: 'playerLeave', playerId: 5 },
    { type: 'ping', nonce: 0xfffffffe },
    { type: 'pong', nonce: 42 },
    { type: 'fishingReserve', playerId: 0, spotId: 'lake-east' },
    { type: 'fishingRelease', playerId: 7, spotId: 'lake-east' },
    {
      type: 'fishingState',
      playerId: 7,
      sequence: 42,
      payload: new Uint8Array([1, 3, 0, 4, 0, 125, 255, 206]),
    },
  ];

  it.each(samples.map((message) => [message.type, message] as const))('round-trip %s', (_type, message) => {
    expect(roundTrip(message)).toEqual(message);
  });

  it('snapshot state ~12 byte per pemain dan kuantisasi presisi', () => {
    const players = [snap(), snap({ id: 8, x: -200, z: 255.9, heading: 6.1, mode: 'walk', anim: 'jump', jumping: true })];
    const bytes = encodeMessage({ type: 'state', timeMs: 1000, players });
    expect(bytes.length).toBe(HEADER_BYTES + 5 + players.length * STATE_ENTRY_BYTES);
    expect(STATE_ENTRY_BYTES).toBeLessThanOrEqual(16);
    const result = roundTrip({ type: 'state', timeMs: 1000, players });
    if (result.type !== 'state') throw new Error('tipe salah');
    result.players.forEach((decoded, index) => {
      const source = players[index] as PlayerSnapshot;
      expect(decoded.id).toBe(source.id);
      expect(decoded.x).toBeCloseTo(source.x, 1);
      expect(decoded.z).toBeCloseTo(source.z, 1);
      expect(decoded.y).toBeCloseTo(source.y, 1);
      expect(Math.abs(decoded.heading - source.heading)).toBeLessThan(0.02);
      expect(decoded.mode).toBe(source.mode);
      expect(decoded.anim).toBe(source.anim);
      expect(decoded.jumping).toBe(source.jumping);
    });
  });

  it('kuantisasi x/z dan heading stabil di tepi', () => {
    expect(dequantizeXZ(quantizeXZ(-HALF_WORLD))).toBeCloseTo(-HALF_WORLD);
    expect(dequantizeXZ(quantizeXZ(HALF_WORLD))).toBeCloseTo(HALF_WORLD);
    expect(quantizeHeading(Math.PI * 2)).toBe(0);
    expect(dequantizeHeading(quantizeHeading(-Math.PI / 2))).toBeCloseTo((3 * Math.PI) / 2, 1);
  });

  it('hanya state yang unreliable', () => {
    expect(isReliable('state')).toBe(false);
    for (const message of samples) expect(isReliable(message.type)).toBe(true);
  });
});

describe('protocol validasi', () => {
  it('menolak versi protokol berbeda', () => {
    const bytes = encodeMessage({ type: 'ping', nonce: 1 });
    bytes[0] = PROTOCOL_VERSION + 1;
    expect(decodeMessage(bytes)).toEqual({ ok: false, error: 'version' });
  });

  it('menolak buffer kosong dan id pesan tak dikenal', () => {
    expect(decodeMessage(new Uint8Array(1))).toEqual({ ok: false, error: 'empty' });
    expect(decodeMessage(new Uint8Array([PROTOCOL_VERSION, 200]))).toEqual({ ok: false, error: 'unknown-type' });
  });

  it('menolak panjang buffer yang tidak sesuai (terpotong atau berlebih)', () => {
    const state = encodeMessage({ type: 'state', timeMs: 1, players: [snap()] });
    expect(decodeMessage(state.subarray(0, state.length - 1))).toEqual({ ok: false, error: 'length' });
    const longer = new Uint8Array(state.length + 1);
    longer.set(state);
    expect(decodeMessage(longer)).toEqual({ ok: false, error: 'length' });
    const ping = encodeMessage({ type: 'ping', nonce: 1 });
    expect(decodeMessage(ping.subarray(0, 4)).ok).toBe(false);
    const hello = encodeMessage({ type: 'hello', username: 'Budi', appearance: DEFAULT_APPEARANCE });
    expect(decodeMessage(hello.subarray(0, hello.length - 1)).ok).toBe(false);
  });

  it('menolak teks chat lebih dari 200 karakter, baik saat encode maupun decode', () => {
    const tooLong = 'a'.repeat(CHAT_TEXT_MAX + 1);
    expect(() => encodeMessage({ type: 'chat', channel: 'session', fromId: 0, msgId: 0, timeMs: 0, text: tooLong })).toThrow();
    // Paket buatan tangan (klien nakal) dengan teks 201 karakter.
    const text = new TextEncoder().encode(tooLong);
    const packet = new Uint8Array(HEADER_BYTES + 13 + text.length);
    const view = new DataView(packet.buffer);
    packet[0] = PROTOCOL_VERSION;
    packet[1] = MSG.chat;
    view.setUint16(HEADER_BYTES + 11, text.length);
    packet.set(text, HEADER_BYTES + 13);
    expect(decodeMessage(packet)).toEqual({ ok: false, error: 'text' });
    // Tepat 200 karakter masih boleh.
    const ok = encodeMessage({ type: 'chat', channel: 'session', fromId: 0, msgId: 0, timeMs: 0, text: 'b'.repeat(CHAT_TEXT_MAX) });
    expect(decodeMessage(ok).ok).toBe(true);
  });

  it('menolak payload fishing yang malformed atau oversized', () => {
    const state = encodeMessage({
      type: 'fishingState',
      playerId: 0,
      sequence: 1,
      payload: new Uint8Array(FISHING_STATE_BYTES),
    });
    expect(decodeMessage(state.subarray(0, state.length - 1))).toEqual({ ok: false, error: 'length' });
    const oversizedState = new Uint8Array(state.length + 1);
    oversizedState.set(state);
    expect(decodeMessage(oversizedState)).toEqual({ ok: false, error: 'length' });

    expect(() =>
      encodeMessage({
        type: 'fishingState',
        playerId: 0,
        sequence: 1,
        payload: new Uint8Array(FISHING_STATE_BYTES + 1),
      }),
    ).toThrow(RangeError);
    expect(() =>
      encodeMessage({ type: 'fishingReserve', playerId: 0, spotId: 'x'.repeat(FISHING_SPOT_ID_BYTES_MAX + 1) }),
    ).toThrow(RangeError);

    const reserve = encodeMessage({ type: 'fishingReserve', playerId: 0, spotId: 'lake-east' });
    reserve[HEADER_BYTES + 2] = FISHING_SPOT_ID_BYTES_MAX + 1;
    expect(decodeMessage(reserve)).toEqual({ ok: false, error: 'text' });
  });

  it('merapikan karakter kontrol dan menolak teks kosong', () => {
    expect(sanitizeText('  halo\u0000\n dunia\u0007 ')).toBe('halo dunia');
    expect(() => encodeMessage({ type: 'chat', channel: 'session', fromId: 0, msgId: 0, timeMs: 0, text: ' \n ' })).toThrow();
  });

  it('menolak koordinat kendaraan di luar batas peta', () => {
    const bytes = encodeMessage({ type: 'vehicleClaim', vehicleId: 'v', action: 'release', x: HALF_WORLD + 10, z: 0, yaw: 0 });
    expect(decodeMessage(bytes)).toEqual({ ok: false, error: 'bounds' });
    const nan = encodeMessage({ type: 'vehicleState', vehicleId: 'v', ownerId: 0, x: Number.NaN, z: 0, yaw: 0 });
    expect(decodeMessage(nan)).toEqual({ ok: false, error: 'bounds' });
  });

  it('menolak mode gerak, animasi, atau flag yang tidak dikenal', () => {
    const bytes = encodeMessage({ type: 'state', timeMs: 1, players: [snap()] });
    const bad = new Uint8Array(bytes);
    bad[HEADER_BYTES + 5 + 9] = 99; // byte moveMode
    expect(decodeMessage(bad)).toEqual({ ok: false, error: 'field' });
  });

  it('penampilan tidak valid di hello jatuh ke DEFAULT_APPEARANCE', () => {
    const bytes = encodeMessage({ type: 'hello', username: 'Budi', appearance: { ...DEFAULT_APPEARANCE, gender: 'f', accessory: 2 } });
    bytes[HEADER_BYTES + 1] = 0xff; // skinTone/hairStyle/... = 3
    const result = decodeMessage(bytes);
    expect(result.ok && result.message.type === 'hello' && result.message.appearance).toEqual(DEFAULT_APPEARANCE);
  });

  it('menolak UTF-8 yang rusak', () => {
    const bytes = encodeMessage({ type: 'playerLeave', playerId: 1 });
    expect(decodeMessage(bytes).ok).toBe(true);
    const hello = encodeMessage({ type: 'hello', username: 'ab', appearance: DEFAULT_APPEARANCE });
    hello[hello.length - 1] = 0xff;
    expect(decodeMessage(hello)).toEqual({ ok: false, error: 'text' });
  });
});

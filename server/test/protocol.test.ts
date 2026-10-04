import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE, decodeAppearance, encodeAppearance, APPEARANCE_FIELDS, type Appearance } from '../src/appearance.js';
import {
  decodeMessage,
  encodeMessage,
  HALF_WORLD,
  HEADER_BYTES,
  MSG,
  PROTOCOL_VERSION,
  STATE_ENTRY_BYTES,
  quantizeXZ,
  type NetMessage,
} from '../src/protocol.js';
import { CLIENT_HEX, SAMPLES } from './vectors.js';

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');
const fromHex = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, 'hex'));

describe('kompatibilitas byte-per-byte dengan klien', () => {
  it.each(Object.keys(SAMPLES))('encode server == encode klien: %s', (name) => {
    expect(hex(encodeMessage(SAMPLES[name] as NetMessage))).toBe(CLIENT_HEX[name]);
  });

  it.each(Object.keys(SAMPLES))('decode bytes klien → encode ulang identik: %s', (name) => {
    const bytes = fromHex(CLIENT_HEX[name] as string);
    const decoded = decodeMessage(bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.message.type).toBe((SAMPLES[name] as NetMessage).type);
    expect(hex(encodeMessage(decoded.message))).toBe(CLIENT_HEX[name]);
  });

  it('decode bytes klien memberi nilai yang sama (selain kuantisasi state)', () => {
    for (const name of Object.keys(SAMPLES)) {
      if (name === 'state') continue;
      const decoded = decodeMessage(fromHex(CLIENT_HEX[name] as string));
      if (!decoded.ok) throw new Error(name);
      expect(decoded.message).toEqual(SAMPLES[name]);
    }
  });

  it('header: versi 1, id pesan sesuai tabel NET_PROTOCOL.md 2', () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(MSG).toEqual({
      hello: 1, welcome: 2, state: 3, appearance: 4, vehicleClaim: 5, vehicleState: 6,
      clock: 7, chat: 8, playerJoin: 9, playerLeave: 10, ping: 11, pong: 12,
    });
    expect(STATE_ENTRY_BYTES).toBe(12);
  });

  it('state 1 pemain dari klien = 19 byte', () => {
    const bytes = encodeMessage({
      type: 'state', timeMs: 5, players: [{ id: 0, x: 0, y: 0, z: 0, heading: 0, mode: 'walk', anim: 'idle', jumping: false }],
    });
    expect(bytes.length).toBe(HEADER_BYTES + 5 + STATE_ENTRY_BYTES);
    expect(bytes.length).toBe(19);
  });
});

describe('penampilan', () => {
  it('semua 2 × 3^9 kombinasi round-trip', () => {
    let count = 0;
    for (let gender = 0; gender < 2; gender++) {
      for (let combo = 0; combo < 3 ** 9; combo++) {
        const look: Record<string, unknown> = { gender: gender ? 'f' : 'm' };
        let rest = combo;
        for (const field of APPEARANCE_FIELDS) {
          look[field] = rest % 3;
          rest = Math.floor(rest / 3);
        }
        expect(decodeAppearance(encodeAppearance(look as unknown as Appearance))).toEqual(look);
        count++;
      }
    }
    expect(count).toBe(39_366);
  });

  it('nilai 3, versi beda, bit cadangan → default tanpa menolak pesan', () => {
    const bytes = encodeMessage({ type: 'appearance', playerId: 0, appearance: DEFAULT_APPEARANCE });
    for (const mutate of [
      (b: Uint8Array) => (b[4] = 2), // versi format 2
      (b: Uint8Array) => (b[5] = 0b110), // skinTone = 3
      (b: Uint8Array) => (b[7] = 0x80), // bit cadangan
    ]) {
      const copy = bytes.slice();
      mutate(copy);
      const decoded = decodeMessage(copy);
      expect(decoded.ok).toBe(true);
      if (decoded.ok && decoded.message.type === 'appearance') expect(decoded.message.appearance).toEqual(DEFAULT_APPEARANCE);
    }
  });
});

describe('penolakan pesan rusak', () => {
  const ping = fromHex(CLIENT_HEX.ping as string);

  it('kosong, versi beda, id tidak dikenal', () => {
    expect(decodeMessage(new Uint8Array([1]))).toEqual({ ok: false, error: 'empty' });
    expect(decodeMessage(new Uint8Array([2, 11, 0, 0, 0, 0]))).toEqual({ ok: false, error: 'version' });
    expect(decodeMessage(new Uint8Array([1, 99]))).toEqual({ ok: false, error: 'unknown-type' });
  });

  it('panjang kurang atau lebih ditolak', () => {
    expect(decodeMessage(ping.subarray(0, 5))).toEqual({ ok: false, error: 'length' });
    expect(decodeMessage(new Uint8Array([...ping, 0]))).toEqual({ ok: false, error: 'length' });
  });

  it('enum di luar rentang dan flag cadangan ditolak', () => {
    const state = fromHex(CLIENT_HEX.state as string);
    const badMode = state.slice();
    badMode[HEADER_BYTES + 5 + 9] = 5;
    expect(decodeMessage(badMode)).toEqual({ ok: false, error: 'field' });
    const badFlag = state.slice();
    badFlag[HEADER_BYTES + 5 + 11] = 2;
    expect(decodeMessage(badFlag)).toEqual({ ok: false, error: 'field' });
  });

  it('teks chat kosong / > 200 karakter / UTF-8 rusak ditolak', () => {
    const header = [1, MSG.chat, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const withText = (payload: number[]) => new Uint8Array([...header, (payload.length >> 8) & 0xff, payload.length & 0xff, ...payload]);
    expect(decodeMessage(withText([0x20, 0x20]))).toEqual({ ok: false, error: 'text' });
    expect(decodeMessage(withText(new Array(201).fill(0x61)))).toEqual({ ok: false, error: 'text' });
    expect(decodeMessage(withText([0xc3, 0x28]))).toEqual({ ok: false, error: 'text' });
    expect(decodeMessage(withText(new Array(200).fill(0x61))).ok).toBe(true);
  });

  it('koordinat kendaraan NaN / di luar peta ditolak', () => {
    const view = (x: number) => {
      const bytes = encodeMessage({ type: 'vehicleClaim', vehicleId: 'v', action: 'mount', x: 0, z: 0, yaw: 0 });
      new DataView(bytes.buffer, bytes.byteOffset).setFloat32(HEADER_BYTES + 3, x);
      return bytes;
    };
    expect(decodeMessage(view(Number.NaN))).toEqual({ ok: false, error: 'bounds' });
    expect(decodeMessage(view(HALF_WORLD + 1))).toEqual({ ok: false, error: 'bounds' });
  });

  it('fuzz: 20.000 buffer acak tidak pernah melempar', () => {
    let seed = 12345;
    const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    for (let i = 0; i < 20_000; i++) {
      const length = Math.floor(rand() * 64);
      const bytes = new Uint8Array(length);
      for (let j = 0; j < length; j++) bytes[j] = Math.floor(rand() * 256);
      if (length > 1 && rand() < 0.8) {
        bytes[0] = 1;
        bytes[1] = 1 + Math.floor(rand() * 12);
      }
      expect(() => decodeMessage(bytes)).not.toThrow();
    }
  });

  it('kuantisasi x/z sama dengan rumus dokumen', () => {
    expect(quantizeXZ(-256)).toBe(0);
    expect(quantizeXZ(256)).toBe(65535);
    expect(quantizeXZ(12.5)).toBe(Math.round(((12.5 + 256) / 512) * 65535));
  });
});

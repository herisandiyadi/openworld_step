import { describe, expect, it } from 'vitest';
import { APPEARANCE_FIELDS, DEFAULT_APPEARANCE, type Appearance } from '../state/profile';
import {
  APPEARANCE_BYTES,
  APPEARANCE_FORMAT_VERSION,
  decodeAppearance,
  decodeAppearanceOrDefault,
  encodeAppearance,
} from './appearanceCodec';

/** 2 gender x 3^9 field = 39.366 kombinasi; gerbang M1 menuntut semuanya diuji. */
function* allAppearances(): Generator<Appearance> {
  const total = 3 ** APPEARANCE_FIELDS.length;
  for (const gender of ['m', 'f'] as const) {
    for (let code = 0; code < total; code++) {
      const appearance = { ...DEFAULT_APPEARANCE, gender };
      let rest = code;
      for (const field of APPEARANCE_FIELDS) {
        appearance[field] = rest % 3;
        rest = Math.floor(rest / 3);
      }
      yield appearance;
    }
  }
}

describe('appearanceCodec', () => {
  it('memakai 4 byte: 1 versi format + 3 payload', () => {
    const bytes = encodeAppearance(DEFAULT_APPEARANCE);
    expect(bytes).toHaveLength(4);
    expect(APPEARANCE_BYTES).toBe(4);
    expect(bytes[0]).toBe(APPEARANCE_FORMAT_VERSION);
  });

  // `expect` per kombinasi terlalu lambat untuk 39.366 iterasi, jadi beda dicatat dulu
  // lalu diperiksa sekali di akhir.
  it('encode/decode semua 39.366 kombinasi tanpa tabrakan', () => {
    const codes = new Set<number>();
    const mismatches: string[] = [];
    let count = 0;
    for (const appearance of allAppearances()) {
      const bytes = encodeAppearance(appearance);
      const decoded = decodeAppearance(bytes);
      if (
        bytes.length !== APPEARANCE_BYTES ||
        !decoded ||
        decoded.gender !== appearance.gender ||
        APPEARANCE_FIELDS.some((field) => decoded[field] !== appearance[field])
      ) {
        mismatches.push(JSON.stringify(appearance));
      }
      codes.add((bytes[1] as number) | ((bytes[2] as number) << 8) | ((bytes[3] as number) << 16));
      count++;
    }
    expect(mismatches).toEqual([]);
    expect(count).toBe(2 * 3 ** 9);
    expect(codes.size).toBe(count);
  });

  it('menolak versi format lain', () => {
    const bytes = encodeAppearance(DEFAULT_APPEARANCE);
    bytes[0] = APPEARANCE_FORMAT_VERSION + 1;
    expect(decodeAppearance(bytes)).toBeNull();
    expect(decodeAppearanceOrDefault(bytes)).toEqual(DEFAULT_APPEARANCE);
  });

  it('menolak buffer yang terlalu pendek', () => {
    expect(decodeAppearance(encodeAppearance(DEFAULT_APPEARANCE).subarray(0, 3))).toBeNull();
    expect(decodeAppearance(new Uint8Array(0))).toBeNull();
  });

  it('menolak bit cadangan yang tidak nol', () => {
    const bytes = encodeAppearance(DEFAULT_APPEARANCE);
    bytes[3] = (bytes[3] as number) | 0b1000;
    expect(decodeAppearance(bytes)).toBeNull();
  });

  it('menolak nilai field 3 (di luar 0-2)', () => {
    // skinTone menempati bit 1-2; nilai 0b11 tidak sah.
    const bytes = encodeAppearance(DEFAULT_APPEARANCE);
    bytes[1] = (bytes[1] as number) | 0b110;
    expect(decodeAppearance(bytes)).toBeNull();
    expect(decodeAppearanceOrDefault(bytes)).toEqual(DEFAULT_APPEARANCE);
  });

  it('menolak encode penampilan yang nilainya di luar rentang', () => {
    expect(() => encodeAppearance({ ...DEFAULT_APPEARANCE, hairStyle: 3 })).toThrow();
    expect(() => encodeAppearance({ ...DEFAULT_APPEARANCE, gender: 'x' as 'm' })).toThrow();
    expect(() => encodeAppearance({ ...DEFAULT_APPEARANCE, shirtColor: -1 })).toThrow();
    expect(() => encodeAppearance({ ...DEFAULT_APPEARANCE, pantsStyle: 1.5 })).toThrow();
  });

  it('bisa menulis ke tengah buffer pesan', () => {
    const look: Appearance = { ...DEFAULT_APPEARANCE, gender: 'f', accessory: 2, hairColor: 1 };
    const packet = new Uint8Array(10);
    packet.set(encodeAppearance(look), 4);
    expect(decodeAppearance(packet, 4)).toEqual(look);
    expect(decodeAppearance(packet, 8)).toBeNull();
  });
});

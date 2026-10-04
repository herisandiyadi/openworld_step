import { APPEARANCE_FIELDS, DEFAULT_APPEARANCE, isValidAppearance, parseAppearance, type Appearance } from '../state/profile';

/**
 * Codec penampilan pemain (MULTIPLAYER.md 3.1). Dokumen menyebut 7 field (2 byte payload),
 * tetapi `Appearance` di repo ini punya 10 field: gender (1 bit) + 9 field 0-2 (2 bit) = 19 bit,
 * jadi payload butuh 3 byte. Total di wire: 1 byte versi format + 3 byte payload = 4 byte.
 * Penyimpangan ini dicatat di docs/NET_PROTOCOL.md.
 *
 * Tata letak bit payload (little-endian 24 bit):
 *   bit 0        gender (0 = 'm', 1 = 'f')
 *   bit 1-2      skinTone     bit 3-4   hairStyle   bit 5-6   hairColor
 *   bit 7-8      expression   bit 9-10  shirtColor  bit 11-12 shirtStyle
 *   bit 13-14    pantsColor   bit 15-16 pantsStyle  bit 17-18 accessory
 *   bit 19-23    cadangan, harus 0
 */
export const APPEARANCE_FORMAT_VERSION = 1;
/** Byte payload (tanpa byte versi). */
export const APPEARANCE_PAYLOAD_BYTES = 3;
/** Total byte di wire: versi + payload. */
export const APPEARANCE_BYTES = APPEARANCE_PAYLOAD_BYTES + 1;

/** Menulis 4 byte penampilan ke `target` mulai `offset`. Melempar RangeError kalau nilainya tidak valid. */
export function encodeAppearanceInto(target: Uint8Array, offset: number, appearance: Appearance): void {
  if (!isValidAppearance(appearance)) throw new RangeError('Penampilan tidak valid, tidak bisa di-encode.');
  if (offset + APPEARANCE_BYTES > target.length) throw new RangeError('Buffer terlalu kecil untuk penampilan.');
  let bits = appearance.gender === 'f' ? 1 : 0;
  APPEARANCE_FIELDS.forEach((field, index) => {
    bits |= (appearance[field] & 0b11) << (1 + index * 2);
  });
  target[offset] = APPEARANCE_FORMAT_VERSION;
  target[offset + 1] = bits & 0xff;
  target[offset + 2] = (bits >>> 8) & 0xff;
  target[offset + 3] = (bits >>> 16) & 0xff;
}

/** 4 byte: versi format + 3 byte field. */
export function encodeAppearance(appearance: Appearance): Uint8Array {
  const bytes = new Uint8Array(APPEARANCE_BYTES);
  encodeAppearanceInto(bytes, 0, appearance);
  return bytes;
}

/**
 * Mengembalikan `null` kalau versi format beda, panjang buffer kurang, nilai field di luar 0-2,
 * atau bit cadangan tidak nol. Pemanggil memutuskan apakah jatuh ke default (lihat
 * `decodeAppearanceOrDefault`).
 */
export function decodeAppearance(data: Uint8Array, offset = 0): Appearance | null {
  if (offset < 0 || offset + APPEARANCE_BYTES > data.length) return null;
  if (data[offset] !== APPEARANCE_FORMAT_VERSION) return null;
  const bits = (data[offset + 1] as number) | ((data[offset + 2] as number) << 8) | ((data[offset + 3] as number) << 16);
  if (bits >>> 19 !== 0) return null;
  const appearance: Partial<Appearance> = { gender: (bits & 1) === 1 ? 'f' : 'm' };
  for (let index = 0; index < APPEARANCE_FIELDS.length; index++) {
    const field = APPEARANCE_FIELDS[index] as (typeof APPEARANCE_FIELDS)[number];
    const value = (bits >>> (1 + index * 2)) & 0b11;
    if (value > 2) return null;
    appearance[field] = value;
  }
  return isValidAppearance(appearance) ? parseAppearance(appearance) : null;
}

/** Varian "host/server": nilai tidak valid tidak memutus sesi, pemain memakai tampilan default. */
export function decodeAppearanceOrDefault(data: Uint8Array, offset = 0): Appearance {
  return decodeAppearance(data, offset) ?? DEFAULT_APPEARANCE;
}
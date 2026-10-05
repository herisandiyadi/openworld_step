/**
 * Penampilan pemain dan codec 4 byte-nya (NET_PROTOCOL.md bagian 4).
 * Disalin dari klien: web/src/state/profile.ts + web/src/net/appearanceCodec.ts.
 * Tata letak bit harus sama persis, jadi jangan ubah urutan APPEARANCE_FIELDS.
 */

export interface Appearance {
  gender: 'm' | 'f';
  skinTone: number;
  hairStyle: number;
  hairColor: number;
  expression: number;
  shirtColor: number;
  shirtStyle: number;
  pantsColor: number;
  pantsStyle: number;
  accessory: number;
}

/** Default = hero laki-laki, hoodie biru (sama dengan klien). */
export const DEFAULT_APPEARANCE: Appearance = {
  gender: 'm',
  skinTone: 0,
  hairStyle: 0,
  hairColor: 0,
  expression: 0,
  shirtColor: 0,
  shirtStyle: 1,
  pantsColor: 0,
  pantsStyle: 0,
  accessory: 0,
};

/** Urutan field menentukan posisi bit; ikut klien. */
export const APPEARANCE_FIELDS = [
  'skinTone',
  'hairStyle',
  'hairColor',
  'expression',
  'shirtColor',
  'shirtStyle',
  'pantsColor',
  'pantsStyle',
  'accessory',
] as const;

export type AppearanceField = (typeof APPEARANCE_FIELDS)[number];

export const APPEARANCE_FORMAT_VERSION = 1;
/** Byte payload tanpa byte versi. */
export const APPEARANCE_PAYLOAD_BYTES = 3;
/** Total byte di wire: 1 versi + 3 payload. */
export const APPEARANCE_BYTES = APPEARANCE_PAYLOAD_BYTES + 1;

/** Benar hanya kalau semua field sudah dalam rentang yang sah. */
export function isValidAppearance(value: unknown): boolean {
  const data = value as Partial<Appearance> | null | undefined;
  if (!data || (data.gender !== 'm' && data.gender !== 'f')) return false;
  return APPEARANCE_FIELDS.every((field) => {
    const raw = data[field];
    return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 2;
  });
}

/** Memaksa nilai ke rentang valid; field salah/absen kembali ke default. */
export function parseAppearance(value: unknown): Appearance {
  const data = value as Record<string, unknown> | null | undefined;
  if (!data || typeof data !== 'object') return DEFAULT_APPEARANCE;
  const appearance: Appearance = { ...DEFAULT_APPEARANCE, gender: data.gender === 'f' ? 'f' : 'm' };
  for (const field of APPEARANCE_FIELDS) {
    const raw = data[field];
    if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 2) appearance[field] = raw;
  }
  return appearance;
}

/** Menulis 4 byte penampilan ke `target` mulai `offset`. */
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

export function encodeAppearance(appearance: Appearance): Uint8Array {
  const bytes = new Uint8Array(APPEARANCE_BYTES);
  encodeAppearanceInto(bytes, 0, appearance);
  return bytes;
}

/** `null` kalau versi format beda, byte kurang, nilai di luar 0-2, atau bit cadangan tidak nol. */
export function decodeAppearance(data: Uint8Array, offset = 0): Appearance | null {
  if (offset < 0 || offset + APPEARANCE_BYTES > data.length) return null;
  if (data[offset] !== APPEARANCE_FORMAT_VERSION) return null;
  const bits = (data[offset + 1] as number) | ((data[offset + 2] as number) << 8) | ((data[offset + 3] as number) << 16);
  if (bits >>> 19 !== 0) return null;
  const appearance: Record<string, unknown> = { gender: (bits & 1) === 1 ? 'f' : 'm' };
  for (let index = 0; index < APPEARANCE_FIELDS.length; index++) {
    const field = APPEARANCE_FIELDS[index] as AppearanceField;
    const value = (bits >>> (1 + index * 2)) & 0b11;
    if (value > 2) return null;
    appearance[field] = value;
  }
  return isValidAppearance(appearance) ? parseAppearance(appearance) : null;
}

/** Varian server: penampilan tidak valid tidak memutus sesi, pemain memakai default (MULTIPLAYER.md 3.1). */
export function decodeAppearanceOrDefault(data: Uint8Array, offset = 0): Appearance {
  return decodeAppearance(data, offset) ?? DEFAULT_APPEARANCE;
}

/* ------------------------------------------------------------------------------------------------
 * Username (aturan sama dengan web/src/state/profile.ts)
 * ---------------------------------------------------------------------------------------------- */

export const USERNAME_MIN = 2;
export const USERNAME_MAX = 20;
const USERNAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u;

export const normalizeUsername = (value: string): string => value.trim().replace(/\s+/g, ' ');

/** Mengembalikan pesan kesalahan, atau null kalau username diterima. */
export function validateUsername(value: string): string | null {
  const name = normalizeUsername(value);
  const length = [...name].length;
  if (length < USERNAME_MIN) return `Username minimal ${USERNAME_MIN} karakter.`;
  if (length > USERNAME_MAX) return `Username maksimal ${USERNAME_MAX} karakter.`;
  if (!USERNAME_PATTERN.test(name)) return 'Gunakan huruf, angka, spasi, titik, garis bawah, atau strip.';
  return null;
}

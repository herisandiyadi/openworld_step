/** Linear-space RGB, as required for glTF COLOR_0. */
export type Rgb = [number, number, number];

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

export function hex(value: string): Rgb {
  const n = Number.parseInt(value.replace('#', ''), 16);
  return [toLinear(((n >> 16) & 255) / 255), toLinear(((n >> 8) & 255) / 255), toLinear((n & 255) / 255)];
}

export function linearToSrgbByte(c: number): number {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
}

/** Shared limited palette so every asset stays visually consistent. */
export const PALETTE = {
  // Urban hero palette from Notion §11.3 (sRGB source values, stored as linear RGB).
  skin: hex('#78361b'),
  skinTan: hex('#b97e56'),
  hair: hex('#030302'),
  eye: hex('#1b1b22'),
  white: hex('#f3f1ea'),
  hoodie: hex('#d1c4a8'),
  hoodieDark: hex('#9e937d'),
  jeans: hex('#0b0d11'),
  pantsDark: hex('#3a3430'),
  shoe: hex('#e0dbd1'),
  sole: hex('#f2f0e6'),
  backpack: hex('#e2582b'),
  apron: hex('#8a5a3b'),
  cap: hex('#1f1f24'),
  metalDark: hex('#3c4148'),
  metalLight: hex('#9aa3ad'),
  wood: hex('#b07a45'),
  woodDark: hex('#8a5c32'),
  trunk: hex('#7a5537'),
  leaf: hex('#5f9e4a'),
  leafDark: hex('#47803a'),
  leafLight: hex('#7fb85a'),
  lamp: hex('#ffe9a8'),
  glass: hex('#a9cfe0'),
  binGreen: hex('#2f7d5b'),
  binDark: hex('#215a41'),
  signBlue: hex('#2a64c8'),
  roof: hex('#d8d4cc'),
  deck: hex('#e2582b'),
  grip: hex('#2a2a2e'),
  rubber: hex('#1d1d20'),
  frame: hex('#1f9d55'),
  // Netral supaya runtime bisa mengalikan warna instance (variasi warna mobil/warga/hewan).
  paint: hex('#cfd3d8'),
  seat: hex('#2a2a2e'),
  plate: hex('#e8e6df'),
  lightRed: hex('#d8342a'),
  lightYellow: hex('#e8b02a'),
  lightGreen: hex('#3fb360'),
  concrete: hex('#b8b4ac'),
  // Detail karakter kustom (hero m/f): bibir, logam aksesori, lensa kacamata.
  lip: hex('#b5564f'),
  gold: hex('#d8ab3c'),
  lens: hex('#cfe3ef'),
  furGrey: hex('#9a948c'),
  furDark: hex('#4a4440'),
  beak: hex('#d79a3a'),
} as const;
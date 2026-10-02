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
  skin: hex('#e9b48f'),
  skinTan: hex('#b97e56'),
  hair: hex('#2b211c'),
  eye: hex('#1b1b22'),
  white: hex('#f3f1ea'),
  hoodie: hex('#2f6fdb'),
  hoodieDark: hex('#2456ad'),
  jeans: hex('#34405a'),
  pantsDark: hex('#3a3430'),
  shoe: hex('#f3f1ea'),
  sole: hex('#2a2a2e'),
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
} as const;
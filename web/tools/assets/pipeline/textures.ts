import { textureMaxSize, type TextureRole } from './config';
import type { Category } from '../defs/types';
export interface TextureInput { asset: string; role: TextureRole; category: Category; width: number; height: number }
export interface TexturePlan { errors: string[]; preferred: { uri: string; mime: 'image/ktx2'; codec: 'etc1s' | 'uastc' }; fallback: { uri: string; mime: 'image/png'; maxSize: number }; colorSpace: 'sRGB' | 'linear'; lods: { level: number; size: number }[] }
export function planTexture(input: TextureInput): TexturePlan {
  const max = textureMaxSize(input.category, input.role); const errors: string[] = [];
  if (Math.max(input.width, input.height) > max) errors.push(`${input.role} ${Math.max(input.width, input.height)}px exceeds ${input.category} max ${max}px`);
  if ((input.width & (input.width - 1)) || (input.height & (input.height - 1))) errors.push(`dimensions ${input.width}x${input.height} must be powers of two for KTX2 mips`);
  const codec = input.role === 'normal' ? 'uastc' : 'etc1s';
  const lods = [input.width, Math.max(1, Math.floor(input.width / 2)), Math.max(1, Math.round(input.width * 0.1))].map((size, level) => ({ level, size }));
  return { errors, preferred: { uri: `${input.asset}_${input.role}.ktx2`, mime: 'image/ktx2', codec }, fallback: { uri: `texture-fallbacks/${input.asset}_${input.role}.png`, mime: 'image/png', maxSize: Math.min(max, 1024) }, colorSpace: input.role === 'albedo' || input.role === 'emissive' ? 'sRGB' : 'linear', lods };
}

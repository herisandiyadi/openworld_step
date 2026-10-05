/**
 * Konfigurasi color pipeline renderer.
 * Albedo adalah data warna (sRGB); normal/roughness/metalness/AO adalah data numerik linear.
 */
import { ACESFilmicToneMapping, NoColorSpace, SRGBColorSpace } from 'three';
import type { QualityTier } from '../state/qualityTiers';
import { QUALITY_TIERS } from '../state/qualityTiers';

export interface ColorPipelineConfig {
  outputColorSpace: typeof SRGBColorSpace;
  toneMapping: typeof ACESFilmicToneMapping;
  exposure: number;
}

export type TextureMapKind = 'albedo' | 'normal' | 'roughness' | 'metalness' | 'ao';

type ColorSpaceTexture = { colorSpace: string };

export function colorPipelineFor(tier: QualityTier): ColorPipelineConfig {
  return {
    outputColorSpace: SRGBColorSpace,
    toneMapping: ACESFilmicToneMapping,
    exposure: QUALITY_TIERS[tier].exposure,
  };
}

/** Atur colorSpace tanpa perlu GPU; Texture Three.js memenuhi bentuk ini. */
export function markTextureColorSpace<T extends ColorSpaceTexture>(texture: T, kind: TextureMapKind): T {
  texture.colorSpace = kind === 'albedo' ? SRGBColorSpace : NoColorSpace;
  return texture;
}


export interface ColorPipelineRenderer {
  outputColorSpace: string;
  toneMapping: number;
  toneMappingExposure: number;
}

/** Terapkan konfigurasi ke WebGLRenderer atau stub dengan properti yang sama. */
export function applyColorPipeline<T extends ColorPipelineRenderer>(renderer: T, tier: QualityTier): T {
  const config = colorPipelineFor(tier);
  renderer.outputColorSpace = config.outputColorSpace;
  renderer.toneMapping = config.toneMapping;
  renderer.toneMappingExposure = config.exposure;
  return renderer;
}

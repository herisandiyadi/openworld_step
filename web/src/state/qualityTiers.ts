/**
 * Definisi quality tier render (Low/Medium/High) — VISUAL_UPGRADE_TASKS §1, §2, §7.
 * Terpisah dari preset kepadatan (graphicsSettings) — ini murni setelan renderer.
 * Modul murni: tidak menyentuh three/WebGL supaya bisa diuji tanpa GPU.
 */

import { chooseAntialias } from '../render/antialias';
import type { RendererCapabilities } from '../render/capabilities';

export type QualityTier = 'low' | 'medium' | 'high';
/** 'half' = bloom di render target setengah resolusi; 'full' = resolusi penuh. */
export type BloomMode = 'off' | 'half' | 'full';

export interface TierSettings {
  /** Batas atas devicePixelRatio canvas. */
  maxDpr: number;
  /** Shadow map untuk satu-satunya directional light (budget: 1 caster). */
  shadows: boolean;
  /** Ukuran shadow map (px); 0 bila shadows off. */
  shadowMapSize: number;
  /** Sample MSAA yang DIMINTA tier; nilai final ditentukan capability. */
  msaaSamples: number;
  bloom: BloomMode;
  /**
   * Budget full-screen pass resolusi penuh. Bloom 'half' tidak dihitung (jalan di
   * target setengah resolusi); FXAA dilipat ke pass color grade bila pass itu ada.
   */
  maxFullscreenPasses: number;
  /** Pass gabungan grade + vignette + saturasi/kontras. Low: tone map langsung di renderer. */
  colorGradePass: boolean;
  /** renderer.toneMappingExposure untuk ACES. */
  exposure: number;
}

export const QUALITY_TIER_NAMES: readonly QualityTier[] = ['low', 'medium', 'high'];

export const QUALITY_TIERS: Readonly<Record<QualityTier, Readonly<TierSettings>>> = {
  low: {
    maxDpr: 1,
    shadows: false,
    shadowMapSize: 0,
    msaaSamples: 0,
    bloom: 'off',
    maxFullscreenPasses: 1,
    colorGradePass: false,
    // Sedikit lebih terang: tanpa bloom & tanpa grade, highlight kurang "pop".
    exposure: 1.05,
  },
  medium: {
    maxDpr: 1.5,
    shadows: true,
    shadowMapSize: 1024,
    msaaSamples: 2,
    bloom: 'half',
    maxFullscreenPasses: 1,
    colorGradePass: true,
    exposure: 1,
  },
  high: {
    maxDpr: 2,
    shadows: true,
    shadowMapSize: 2048,
    msaaSamples: 4,
    bloom: 'full',
    maxFullscreenPasses: 2,
    colorGradePass: true,
    exposure: 1,
  },
};

/** Setelan tier setelah disesuaikan dengan capability device nyata. */
export interface ResolvedTier extends TierSettings {
  tier: QualityTier;
  /** Fallback FXAA; tidak pernah true bersamaan dengan msaaSamples > 0. */
  fxaa: boolean;
}

/**
 * Turunkan setelan tier bila capability tidak mendukung.
 * Catatan: import siklik dengan render/antialias aman karena hanya dipakai saat dipanggil.
 */
export function resolveTier(tier: QualityTier, caps: RendererCapabilities): ResolvedTier {
  const base = QUALITY_TIERS[tier];
  const aa = chooseAntialias(tier, caps);
  // Bloom butuh target HDR (half-float); di LDR threshold ikut ter-clamp dan lampu jadi orb putih.
  const bloom: BloomMode = caps.halfFloatRenderTarget ? base.bloom : 'off';
  return { ...base, tier, msaaSamples: aa.msaaSamples, fxaa: aa.fxaa, bloom };
}

/**
 * Jumlah full-screen pass resolusi penuh untuk setelan ini.
 * FXAA menumpang di pass color grade bila ada; kalau tidak, butuh pass sendiri.
 * Bloom 'half' jalan di target setengah resolusi sehingga tidak dihitung.
 */
export function fullscreenPassCount(s: Pick<ResolvedTier, 'colorGradePass' | 'fxaa' | 'bloom'>): number {
  const gradeOrFxaa = s.colorGradePass || s.fxaa ? 1 : 0;
  const bloom = s.bloom === 'full' ? 1 : 0;
  return gradeOrFxaa + bloom;
}

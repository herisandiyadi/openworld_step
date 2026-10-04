/**
 * Rencana pass post-processing per quality tier — VISUAL_UPGRADE_TASKS §3, §4, §7.
 * Murni: tidak menyentuh three/WebGL, jadi budget pass bisa diuji tanpa GPU.
 */
import type { LightingState } from '../game/lighting';
import { fullscreenPassCount, type ResolvedTier } from '../state/qualityTiers';

export interface BloomPlan {
  /** Faktor resolusi render target bloom (1 = penuh, 0.5 = setengah). */
  resolutionScale: number;
  /** Threshold ketat supaya hanya highlight lampu yang mekar, bukan seluruh frame. */
  threshold: number;
  strength: number;
  radius: number;
}

export interface GradePlan {
  /** Pengali warna area gelap (cool) dan terang (warm). */
  shadowTint: readonly [number, number, number];
  highlightTint: readonly [number, number, number];
  saturation: number;
  contrast: number;
  /** Kekuatan vignette (0 = mati). */
  vignette: number;
}

export interface PostPlan {
  bloom: BloomPlan | null;
  grade: GradePlan | null;
  /** True bila FXAA harus jalan tanpa grade (Low tier): satu pass ringan. */
  standaloneFxaa: boolean;
  /** Jumlah full-screen pass resolusi penuh. */
  fullscreenPasses: number;
}

const BLOOM_BY_STATE: Readonly<Record<LightingState, { threshold: number; strength: number }>> = {
  day: { threshold: 0.92, strength: 0.15 },
  dusk: { threshold: 0.85, strength: 0.25 },
  night: { threshold: 0.78, strength: 0.38 },
};

export const GRADE_BY_STATE: Readonly<Record<LightingState, GradePlan>> = {
  day: { shadowTint: [0.98, 0.99, 1.03], highlightTint: [1.02, 1, 0.98], saturation: 1.04, contrast: 1.03, vignette: 0.16 },
  dusk: { shadowTint: [0.95, 0.97, 1.08], highlightTint: [1.06, 1, 0.94], saturation: 1.06, contrast: 1.04, vignette: 0.2 },
  // Night grade: cool shadows, warm highlights, vignette ringan.
  night: { shadowTint: [0.9, 0.95, 1.14], highlightTint: [1.08, 1.01, 0.9], saturation: 0.96, contrast: 1.06, vignette: 0.24 },
};

export interface BloomSample { threshold: number; strength: number; radius: number; }
export function bloomAt(daylight: number): BloomSample {
  const t = Math.min(1, Math.max(0, daylight));
  return { threshold: 1 + t * 0.6, strength: 0.42 - t * 0.27, radius: 0.35 };
}

export function gradeAt(daylight: number, dusk: number): GradePlan {
  const t = Math.min(1, Math.max(0, daylight));
  const n = GRADE_BY_STATE.night;
  const d = GRADE_BY_STATE.day;
  const mix = (a: number, b: number) => a + (b - a) * t;
  return {
    shadowTint: [mix(n.shadowTint[0], d.shadowTint[0]), mix(n.shadowTint[1], d.shadowTint[1]), mix(n.shadowTint[2], d.shadowTint[2])],
    highlightTint: [mix(n.highlightTint[0], d.highlightTint[0]), mix(n.highlightTint[1], d.highlightTint[1]), mix(n.highlightTint[2], d.highlightTint[2])],
    saturation: mix(n.saturation, d.saturation), contrast: mix(n.contrast, d.contrast),
    vignette: mix(n.vignette, d.vignette) + dusk * 0.02,
  };
}

export function planPost(tier: ResolvedTier, state: LightingState): PostPlan {
  const bloom: BloomPlan | null =
    tier.bloom === 'off' ? null : { resolutionScale: tier.bloom === 'half' ? 0.5 : 1, ...BLOOM_BY_STATE[state], radius: 0.35 };
  return {
    bloom,
    grade: tier.colorGradePass ? GRADE_BY_STATE[state] : null,
    standaloneFxaa: tier.fxaa && !tier.colorGradePass,
    fullscreenPasses: fullscreenPassCount(tier),
  };
}

import { describe, expect, it } from 'vitest';
import { QUALITY_TIERS, resolveTier } from '../state/qualityTiers';
import { planPost } from './postPlan';
const caps = { webgl2: true, msaaSupport: true, maxSamples: 4, halfFloatRenderTarget: true, textureCompression: { astc: true, etc2: true, s3tc: false } };
describe('post plan', () => {
  it('disables bloom on low tier', () => expect(planPost(resolveTier('low', caps), 'night').bloom).toBeNull());
  it('uses half resolution bloom on medium and grade in one full pass', () => {
    const plan = planPost(resolveTier('medium', caps), 'night');
    expect(plan.bloom?.resolutionScale).toBe(0.5);
    expect(plan.grade?.shadowTint[2]).toBeGreaterThan(plan.grade!.shadowTint[0]);
    expect(plan.fullscreenPasses).toBe(1);
  });
  it('never exceeds high-tier two full-screen pass budget', () => {
    const plan = planPost(resolveTier('high', caps), 'night');
    expect(plan.fullscreenPasses).toBeLessThanOrEqual(QUALITY_TIERS.high.maxFullscreenPasses);
    expect(plan.bloom?.threshold).toBeGreaterThan(0.7);
  });
  it('blends grade continuously from night to day', async () => {
    const { gradeAt, GRADE_BY_STATE } = await import('./postPlan');
    expect(gradeAt(1, 0)).toEqual(GRADE_BY_STATE.day);
    expect(gradeAt(0, 0)).toEqual(GRADE_BY_STATE.night);
    const mid = gradeAt(0.5, 0);
    expect(mid.vignette).toBeGreaterThan(GRADE_BY_STATE.day.vignette);
    expect(mid.vignette).toBeLessThan(GRADE_BY_STATE.night.vignette);
  });
});

describe('bloomAt', () => {
  it('keeps bloom restrained by day and tighter-threshold at night', async () => {
    const { bloomAt } = await import('./postPlan');
    const day = bloomAt(1);
    const night = bloomAt(0);
    expect(day.strength).toBeLessThan(night.strength);
    // Siang: permukaan kena matahari (linear ~1.4) tidak boleh mekar.
    expect(day.threshold).toBeGreaterThan(1.4);
    // Malam: bohlam lampu jalan (emissive 2.2) mekar, jendela (~0.9) tidak.
    expect(night.threshold).toBeGreaterThan(0.9);
    expect(night.threshold).toBeLessThan(2.2);
  });
});

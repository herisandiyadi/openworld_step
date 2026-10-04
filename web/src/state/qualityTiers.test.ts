import { describe, expect, it } from 'vitest';
import type { RendererCapabilities } from '../render/capabilities';
import { QUALITY_TIERS, QUALITY_TIER_NAMES, fullscreenPassCount, resolveTier } from './qualityTiers';

/** Capability data polos (bukan mock): default = device WebGL2 yang mampu semuanya. */
function caps(overrides: Partial<RendererCapabilities> = {}): RendererCapabilities {
  return {
    webgl2: true,
    msaaSupport: true,
    maxSamples: 4,
    halfFloatRenderTarget: true,
    textureCompression: { astc: true, etc2: true, s3tc: false },
    ...overrides,
  };
}

describe('QUALITY_TIERS', () => {
  it('punya tiga tier low/medium/high', () => {
    expect(QUALITY_TIER_NAMES).toEqual(['low', 'medium', 'high']);
    for (const name of QUALITY_TIER_NAMES) expect(QUALITY_TIERS[name]).toBeDefined();
  });

  it('setelan naik monoton dari low ke high', () => {
    const { low, medium, high } = QUALITY_TIERS;
    expect(low.maxDpr).toBeLessThanOrEqual(medium.maxDpr);
    expect(medium.maxDpr).toBeLessThanOrEqual(high.maxDpr);
    expect(low.shadowMapSize).toBeLessThanOrEqual(medium.shadowMapSize);
    expect(medium.shadowMapSize).toBeLessThanOrEqual(high.shadowMapSize);
    expect(low.msaaSamples).toBeLessThanOrEqual(high.msaaSamples);
  });

  it('low: tanpa shadow dan tanpa bloom; high: shadow aktif', () => {
    expect(QUALITY_TIERS.low.shadows).toBe(false);
    expect(QUALITY_TIERS.low.shadowMapSize).toBe(0);
    expect(QUALITY_TIERS.low.bloom).toBe('off');
    expect(QUALITY_TIERS.high.shadows).toBe(true);
  });

  it('budget full-screen pass sesuai spec: high 2, medium 1, low 1', () => {
    expect(QUALITY_TIERS.high.maxFullscreenPasses).toBe(2);
    expect(QUALITY_TIERS.medium.maxFullscreenPasses).toBe(1);
    expect(QUALITY_TIERS.low.maxFullscreenPasses).toBe(1);
  });

  it('exposure positif dan dalam rentang wajar', () => {
    for (const name of QUALITY_TIER_NAMES) {
      expect(QUALITY_TIERS[name].exposure).toBeGreaterThan(0.5);
      expect(QUALITY_TIERS[name].exposure).toBeLessThan(2);
    }
  });
});

describe('resolveTier: anti-aliasing', () => {
  it('device mampu: MSAA sesuai tier, tanpa FXAA', () => {
    const r = resolveTier('high', caps());
    expect(r.tier).toBe('high');
    expect(r.msaaSamples).toBe(4);
    expect(r.fxaa).toBe(false);
  });

  it('MSAA diminta tapi WebGL1: msaaSamples 0 dan flag FXAA menyala', () => {
    const r = resolveTier('high', caps({ webgl2: false, msaaSupport: false, maxSamples: 0 }));
    expect(r.msaaSamples).toBe(0);
    expect(r.fxaa).toBe(true);
  });

  it('tidak memutasi tabel QUALITY_TIERS', () => {
    resolveTier('high', caps({ webgl2: false, msaaSupport: false, maxSamples: 0 }));
    expect(QUALITY_TIERS.high.msaaSamples).toBe(4);
  });
});

describe('resolveTier: bloom & shadow', () => {
  it('tanpa half-float render target, bloom dimatikan (LDR bloom = blown-out orb)', () => {
    expect(resolveTier('high', caps({ halfFloatRenderTarget: false })).bloom).toBe('off');
    expect(resolveTier('medium', caps({ halfFloatRenderTarget: false })).bloom).toBe('off');
  });

  it('dengan half-float, bloom mengikuti tier', () => {
    expect(resolveTier('high', caps()).bloom).toBe('full');
    expect(resolveTier('medium', caps()).bloom).toBe('half');
    expect(resolveTier('low', caps()).bloom).toBe('off');
  });

  it('shadowMapSize konsisten dengan flag shadows', () => {
    for (const name of QUALITY_TIER_NAMES) {
      const r = resolveTier(name, caps({ webgl2: false, msaaSupport: false, maxSamples: 0 }));
      expect(r.shadows ? r.shadowMapSize > 0 : r.shadowMapSize === 0).toBe(true);
    }
  });
});

describe('fullscreenPassCount', () => {
  it('menghitung pass grade (FXAA dilipat ke dalamnya) + bloom full', () => {
    expect(fullscreenPassCount({ colorGradePass: true, fxaa: true, bloom: 'full' })).toBe(2);
    expect(fullscreenPassCount({ colorGradePass: true, fxaa: false, bloom: 'half' })).toBe(1);
    expect(fullscreenPassCount({ colorGradePass: false, fxaa: true, bloom: 'off' })).toBe(1);
    expect(fullscreenPassCount({ colorGradePass: false, fxaa: false, bloom: 'off' })).toBe(0);
  });

  it('setiap tier hasil resolve tetap di dalam budget pass-nya, apa pun capability-nya', () => {
    const variants = [
      caps(),
      caps({ webgl2: false, msaaSupport: false, maxSamples: 0 }),
      caps({ halfFloatRenderTarget: false }),
      caps({ webgl2: false, msaaSupport: false, maxSamples: 0, halfFloatRenderTarget: false }),
    ];
    for (const name of QUALITY_TIER_NAMES) {
      for (const c of variants) {
        const r = resolveTier(name, c);
        expect(fullscreenPassCount(r)).toBeLessThanOrEqual(r.maxFullscreenPasses);
      }
    }
  });
});

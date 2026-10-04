import { describe, expect, it } from 'vitest';
import type { QualityTier } from '../state/qualityTiers';
import { QUALITY_TIERS, QUALITY_TIER_NAMES } from '../state/qualityTiers';
import type { RendererCapabilities } from './capabilities';
import { chooseAntialias } from './antialias';

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

describe('chooseAntialias', () => {
  it('pakai MSAA saat WebGL2 mampu dan tier memintanya', () => {
    expect(chooseAntialias('high', caps())).toEqual({ msaaSamples: 4, fxaa: false });
  });

  it('MSAA dibatasi maxSamples device', () => {
    expect(chooseAntialias('high', caps({ maxSamples: 2 }))).toEqual({ msaaSamples: 2, fxaa: false });
  });

  it('WebGL1 tanpa MSAA jatuh ke FXAA', () => {
    const result = chooseAntialias('high', caps({ webgl2: false, msaaSupport: false, maxSamples: 0 }));
    expect(result).toEqual({ msaaSamples: 0, fxaa: true });
  });

  it('tier yang tidak meminta MSAA (low) pakai FXAA yang lebih murah', () => {
    expect(QUALITY_TIERS.low.msaaSamples).toBe(0);
    expect(chooseAntialias('low', caps())).toEqual({ msaaSamples: 0, fxaa: true });
  });

  it('aturan keras: MSAA dan FXAA tidak pernah aktif bersamaan', () => {
    const variants: RendererCapabilities[] = [
      caps(),
      caps({ maxSamples: 0, msaaSupport: false }),
      caps({ webgl2: false, msaaSupport: false, maxSamples: 0 }),
      caps({ msaaSupport: true, maxSamples: 1 }),
      caps({ webgl2: true, msaaSupport: false, maxSamples: 8 }),
    ];
    for (const tier of QUALITY_TIER_NAMES as QualityTier[]) {
      for (const c of variants) {
        const { msaaSamples, fxaa } = chooseAntialias(tier, c);
        expect(msaaSamples > 0 && fxaa).toBe(false);
        // Selalu ada satu strategi AA aktif.
        expect(msaaSamples > 0 || fxaa).toBe(true);
      }
    }
  });

  it('maxSamples 1 bukan MSAA nyata, jatuh ke FXAA', () => {
    expect(chooseAntialias('medium', caps({ maxSamples: 1 }))).toEqual({ msaaSamples: 0, fxaa: true });
  });
});

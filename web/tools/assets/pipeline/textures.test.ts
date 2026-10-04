import { describe, expect, it } from 'vitest';
import { planTexture } from './textures';

describe('planTexture', () => {
  it('emits KTX2 as preferred with a PNG fallback and a mip/LOD chain', () => {
    const plan = planTexture({ asset: 'bld_shop_01', role: 'albedo', category: 'structure', width: 2048, height: 2048 });
    expect(plan.errors).toEqual([]);
    expect(plan.preferred).toEqual({ uri: 'bld_shop_01_albedo.ktx2', mime: 'image/ktx2', codec: 'etc1s' });
    expect(plan.fallback).toEqual({ uri: 'texture-fallbacks/bld_shop_01_albedo.png', mime: 'image/png', maxSize: 1024 });
    expect(plan.lods.map((l) => l.size)).toEqual([2048, 1024, 205]);
  });

  it('uses UASTC for normal maps and linear colour space for data textures', () => {
    const plan = planTexture({ asset: 'a', role: 'normal', category: 'structure', width: 1024, height: 1024 });
    expect(plan.preferred.codec).toBe('uastc');
    expect(plan.colorSpace).toBe('linear');
  });

  it('rejects oversized and non-power-of-two textures', () => {
    expect(planTexture({ asset: 'a', role: 'albedo', category: 'prop_small', width: 1024, height: 1024 }).errors).toContain('albedo 1024px exceeds prop_small max 512px');
    expect(planTexture({ asset: 'a', role: 'albedo', category: 'structure', width: 1000, height: 1024 }).errors).toContain('dimensions 1000x1024 must be powers of two for KTX2 mips');
  });
});

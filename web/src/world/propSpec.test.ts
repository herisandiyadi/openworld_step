import { describe, expect, it } from 'vitest';
import { FACADE_KIT, PROP_DENSITY, propCountForQuality, type CityQuality } from './propSpec';

describe('city polish policies', () => {
  it('exposes modular facade pieces and variation/decal/LOD policy', () => {
    expect(FACADE_KIT.length).toBeGreaterThanOrEqual(5);
    expect(new Set(FACADE_KIT).size).toBe(FACADE_KIT.length);
    expect(PROP_DENSITY.medium).toBeGreaterThan(PROP_DENSITY.low);
  });
  it('scales decorative props by quality without exceeding policy caps', () => {
    const qualities: CityQuality[] = ['low', 'medium', 'high'];
    expect(propCountForQuality('low', 100)).toBe(30);
    expect(propCountForQuality('medium', 100)).toBe(60);
    expect(propCountForQuality('high', 100)).toBe(100);
    for (const quality of qualities) expect(propCountForQuality(quality, 999)).toBeLessThanOrEqual(PROP_DENSITY[quality]);
  });
});

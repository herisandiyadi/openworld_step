import { describe, expect, it } from 'vitest';
import { shouldUnload, streamingPolicyFor } from './streamingPolicy';
import { QUALITY_TIER_NAMES } from '../state/qualityTiers';

describe('streamingPolicyFor', () => {
  it('menaikkan radius load seiring tier (low paling hemat)', () => {
    const low = streamingPolicyFor('low');
    const medium = streamingPolicyFor('medium');
    const high = streamingPolicyFor('high');
    expect(low.loadRadius).toBeLessThan(medium.loadRadius);
    expect(medium.loadRadius).toBeLessThanOrEqual(high.loadRadius);
    expect(low.propRadius).toBeLessThanOrEqual(medium.propRadius);
  });

  it('selalu punya hysteresis: unloadRadius lebih besar dari loadRadius', () => {
    for (const tier of QUALITY_TIER_NAMES) {
      const policy = streamingPolicyFor(tier);
      expect(policy.unloadRadius).toBeGreaterThan(policy.loadRadius);
      expect(policy.propRadius).toBeLessThanOrEqual(policy.loadRadius);
      expect(policy.chunkSize).toBeGreaterThan(0);
    }
  });
});

describe('shouldUnload', () => {
  it('hanya unload di luar unloadRadius (batas tepat tetap dipertahankan)', () => {
    const policy = streamingPolicyFor('medium');
    expect(shouldUnload(policy.loadRadius, policy)).toBe(false);
    expect(shouldUnload(policy.unloadRadius, policy)).toBe(false);
    expect(shouldUnload(policy.unloadRadius + 1, policy)).toBe(true);
  });
});

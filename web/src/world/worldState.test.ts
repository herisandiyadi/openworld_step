import { describe, expect, it } from 'vitest';
import type { ChunkRecord } from './worldState';

describe('ChunkRecord POIs', () => {
  it('keeps all per-chunk gameplay points available to consumers', () => {
    const chunk: ChunkRecord = {
      key: '1_3',
      cx: 1,
      cz: 3,
      district: 'city_park',
      heights: [],
      surface: [],
      colliders: [],
      fishingSpots: [{ id: 'fish_0', x: 1, z: 2, yaw: 0, water: 'lake' }],
      trashBins: [{ id: 'bin_0', x: 3, z: 4 }],
      fishStalls: [{ id: 'stall_0', x: 5, z: 6, water: 'lake' }],
    };
    expect(chunk.fishingSpots[0]?.water).toBe('lake');
    expect(chunk.trashBins[0]?.id).toBe('bin_0');
    expect(chunk.fishStalls[0]?.id).toBe('stall_0');
  });
});

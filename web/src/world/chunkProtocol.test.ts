import { describe, expect, it } from 'vitest';
import type { BuiltChunk } from './chunkProtocol';

describe('BuiltChunk POI contract', () => {
  it('includes fishingSpots, trashBins, fishStalls arrays', () => {
    const chunk: BuiltChunk = {
      key: '1_3',
      cx: 1,
      cz: 3,
      district: 'city_park',
      heights: new Int32Array(1089),
      surface: new Uint8Array(1024),
      terrain: { positions: new Float32Array(0), normals: new Float32Array(0), colors: new Float32Array(0) },
      buildingMatrices: new Float32Array(0),
      buildingColors: new Float32Array(0),
      props: [],
      colliders: [],
      fishingSpots: [{ id: 'fish_0', x: -442, z: -314, yaw: Math.PI, water: 'lake' }],
      trashBins: [{ id: 'bin_0', x: -440, z: -310 }],
      fishStalls: [{ id: 'stall_0', x: -418, z: -304, water: 'lake' }],
      workerMs: 12,
    };
    expect(chunk.fishingSpots).toHaveLength(1);
    expect(chunk.trashBins).toHaveLength(1);
    expect(chunk.fishStalls).toHaveLength(1);
    expect(chunk.fishingSpots[0]?.id).toBe('fish_0');
  });
});

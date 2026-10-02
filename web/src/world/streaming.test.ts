import { describe, expect, it } from 'vitest';
import { planStreaming } from './streaming';
import { chunkKey, LOAD_RADIUS, UNLOAD_RADIUS, WORLD_CHUNKS } from './worldSpec';

const square = (cx: number, cz: number, radius: number) => {
  const keys: string[] = [];
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx;
      const z = cz + dz;
      if (x >= 0 && z >= 0 && x < WORLD_CHUNKS && z < WORLD_CHUNKS) keys.push(chunkKey(x, z));
    }
  }
  return keys;
};

describe('planStreaming', () => {
  it('loads the full radius around the player, nearest first', () => {
    const plan = planStreaming({ cx: 4, cz: 4 }, [], new Set());
    expect(plan.load).toHaveLength((LOAD_RADIUS * 2 + 1) ** 2);
    expect(plan.load[0]?.key).toBe(chunkKey(4, 4));
    const rings = plan.load.map((c) => Math.max(Math.abs(c.cx - 4), Math.abs(c.cz - 4)));
    expect(rings).toEqual([...rings].sort((a, b) => a - b));
  });

  it('clips to the world edge', () => {
    const plan = planStreaming({ cx: 0, cz: 0 }, [], new Set());
    expect(plan.load).toHaveLength((LOAD_RADIUS + 1) ** 2);
  });

  it('skips loaded and pending chunks', () => {
    const loaded = square(4, 4, 1);
    const plan = planStreaming({ cx: 4, cz: 4 }, loaded, new Set([chunkKey(2, 2)]));
    expect(plan.load.some((c) => loaded.includes(c.key) || c.key === chunkKey(2, 2))).toBe(false);
  });

  it('only unloads beyond the unload radius (hysteresis)', () => {
    const loaded = square(4, 4, LOAD_RADIUS);
    const oneStep = planStreaming({ cx: 5, cz: 4 }, loaded, new Set());
    expect(oneStep.unload).toHaveLength(0);
    const far = planStreaming({ cx: 4 + UNLOAD_RADIUS, cz: 4 }, loaded, new Set());
    expect(far.unload.length).toBeGreaterThan(0);
    const center = 4 + UNLOAD_RADIUS;
    for (const key of far.unload) {
      const [cx, cz] = key.split('_').map(Number);
      expect(Math.max(Math.abs((cx ?? 0) - center), Math.abs((cz ?? 0) - 4))).toBeGreaterThan(UNLOAD_RADIUS);
    }
  });
});
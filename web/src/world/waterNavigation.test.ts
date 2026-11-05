import { describe, expect, it } from 'vitest';
import { buildTerrainBuffers } from './terrainMesh';
import { generateWorld } from './worldGen';
import { SURFACE } from './worldSpec';

describe('water navigation geometry', () => {
  it('omits water cells from navmesh input while retaining them in render terrain', { timeout: 60_000 }, () => {
    const world = generateWorld(1337);
    const chunk = world.chunks.find((entry) => entry.surface.includes(SURFACE.water));
    if (!chunk) throw new Error('expected a water chunk');
    const rendered = buildTerrainBuffers(chunk);
    const navigable = buildTerrainBuffers(chunk, new Set([SURFACE.water]));
    expect(navigable.positions.length).toBeLessThan(rendered.positions.length);
    expect(navigable.positions.length).toBeGreaterThan(0);
  });
});

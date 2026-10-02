import { describe, expect, it } from 'vitest';
import type { Aabb } from '../game/movement';
import { buildTerrainBuffers } from './terrainMesh';
import { generateWorld } from './worldGen';
import {
  chunkGroundHeight,
  chunkCoord,
  chunkOrigin,
  GRID_CELLS,
  GRID_VERTS,
  propCollider,
  sampleChunkHeight,
  SURFACE,
  surfaceAt,
  WORLD_CHUNKS,
} from './worldSpec';

const world = generateWorld(1337);
const overlaps = (a: Aabb, b: Aabb) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
const allBuildings = world.chunks.flatMap((chunk) => chunk.buildings);

describe('generateWorld', () => {
  it('is deterministic', () => {
    expect(JSON.stringify(generateWorld(1337).chunks)).toBe(JSON.stringify(world.chunks));
  });

  it('produces a full chunk grid with correctly sized arrays and both districts', () => {
    expect(world.chunks).toHaveLength(WORLD_CHUNKS * WORLD_CHUNKS);
    for (const chunk of world.chunks) {
      expect(chunk.heights).toHaveLength(GRID_VERTS * GRID_VERTS);
      expect(chunk.surface).toHaveLength(GRID_CELLS * GRID_CELLS);
    }
    expect(new Set(world.chunks.map((chunk) => chunk.district))).toEqual(new Set(['downtown', 'residential', 'industrial']));
  });

  it('stores every object in the chunk that contains it', () => {
    for (const chunk of world.chunks) {
      for (const prop of chunk.props) {
        expect([chunkCoord(prop.x), chunkCoord(prop.z)]).toEqual([chunk.cx, chunk.cz]);
      }
      for (const building of chunk.buildings) {
        expect([chunkCoord((building.minX + building.maxX) / 2), chunkCoord((building.minZ + building.maxZ) / 2)]).toEqual([chunk.cx, chunk.cz]);
      }
    }
  });

  it('keeps props out of buildings and on the ground', () => {
    for (const chunk of world.chunks) {
      for (const prop of chunk.props) {
        expect(allBuildings.some((building) => overlaps(building, propCollider(prop)))).toBe(false);
        expect(prop.y).toBeCloseTo(chunkGroundHeight(chunk, prop.x, prop.z), 1);
      }
    }
  });

  it('keeps the spawn on a road and NPC spots free', () => {
    const spawnChunk = world.chunks.find((chunk) => chunk.cx === chunkCoord(0) && chunk.cz === chunkCoord(0));
    expect(spawnChunk && surfaceAt(spawnChunk, 0, 0)).toBe(SURFACE.road);
    for (const npc of world.index.npcs) {
      const zone = { minX: npc.x - 1, maxX: npc.x + 1, minZ: npc.z - 1, maxZ: npc.z + 1 };
      expect(allBuildings.some((building) => overlaps(zone, building))).toBe(false);
    }
  });

  it('lists bus stops off the buildings in every district', () => {
    expect(world.index.busStops.length).toBeGreaterThan(10);
    expect(new Set(world.index.busStops.map((stop) => stop.district))).toEqual(new Set(['downtown', 'residential', 'industrial']));
    for (const stop of world.index.busStops) {
      const spot = { minX: stop.x - 0.4, maxX: stop.x + 0.4, minZ: stop.z - 0.4, maxZ: stop.z + 0.4 };
      expect(allBuildings.some((building) => overlaps(spot, building))).toBe(false);
    }
  });

  it('roots every building below the ground under its footprint', () => {
    for (const chunk of world.chunks) {
      for (const building of chunk.buildings) {
        expect(building.baseY).toBeLessThan(chunkGroundHeight(chunk, building.minX, building.minZ));
        expect(building.topY - building.baseY).toBeGreaterThan(3);
      }
    }
  });

  it('has seamless heights across chunk borders', () => {
    const left = world.chunks[0];
    const right = world.chunks[1];
    if (!left || !right) throw new Error('missing chunks');
    for (let j = 0; j < GRID_VERTS; j++) {
      expect(left.heights[j * GRID_VERTS + GRID_VERTS - 1]).toBe(right.heights[j * GRID_VERTS]);
    }
  });
});

describe('terrain mesh', () => {
  it('matches sampleChunkHeight at triangle vertices and cell centres', () => {
    const chunk = world.chunks[WORLD_CHUNKS * WORLD_CHUNKS - 1];
    if (!chunk) throw new Error('missing chunk');
    const { positions } = buildTerrainBuffers(chunk);
    expect(positions.length % 9).toBe(0);
    // First two triangles are the (0,0) cell's top surface.
    for (let v = 0; v < 6; v++) {
      const x = positions[v * 3] ?? 0;
      const y = positions[v * 3 + 1] ?? 0;
      const z = positions[v * 3 + 2] ?? 0;
      const centerX = chunkOrigin(chunk.cx) + 1;
      const centerZ = chunkOrigin(chunk.cz) + 1;
      const raise = chunkGroundHeight(chunk, centerX, centerZ) - sampleChunkHeight(chunk, centerX, centerZ);
      expect(y).toBeCloseTo(sampleChunkHeight(chunk, x, z) + raise, 4);
    }
  });

  it('produces upward-facing ground normals', () => {
    const { normals } = buildTerrainBuffers(world.chunks[0] ?? { cx: 0, cz: 0, heights: [], surface: [] });
    expect(normals[1]).toBeGreaterThan(0.5);
  });
});
import { describe, expect, it } from 'vitest';
import { generateWorld } from './worldGen';
import {
  chunkCoord,
  HALF_WORLD,
  SURFACE,
  WORLD_CHUNKS,
  WORLD_SIZE,
} from './worldSpec';

const world = generateWorld(1337);

describe('U4 expanded world', () => {
  it('is a data-described 16x16, 1024 metre world', () => {
    expect(WORLD_CHUNKS).toBe(16);
    expect(WORLD_SIZE).toBe(1024);
    expect(HALF_WORLD).toBe(512);
    expect(world.index.worldChunks).toBe(16);
    expect(world.index.worldSize).toBe(1024);
    expect(world.index.bounds).toEqual({ minX: -512, maxX: 512, minZ: -512, maxZ: 512 });
    expect(world.chunks).toHaveLength(256);
    expect(world.index.chunks).toHaveLength(256);
    expect(world.index.chunks.every((entry) => entry.file === `chunks/${entry.cx}_${entry.cz}.json`)).toBe(true);
  });

  it('keeps the old central 8x8 world coordinates and anchors unchanged', () => {
    expect(world.index.legacy).toEqual({ chunkOffset: { x: 4, z: 4 }, worldChunks: 8, bounds: { minX: -256, maxX: 256, minZ: -256, maxZ: 256 } });
    expect(world.index.spawn).toEqual({ x: 0, z: 0 });
    expect(world.index.npcs.map(({ id, x, z }) => ({ id, x, z }))).toEqual([
      { id: 'npc_budi', x: 5, z: 10 },
      { id: 'npc_sari', x: -187, z: -170 },
      { id: 'npc_rina', x: 69, z: -54 },
      { id: 'npc_dewi', x: -123, z: 74 },
      { id: 'npc_joko', x: 165, z: 138 },
    ]);
    expect(chunkCoord(-256)).toBe(4);
    expect(chunkCoord(0)).toBe(8);
    expect(chunkCoord(255.99)).toBe(11);
    const inner = world.chunks.filter((chunk) => chunk.cx >= 4 && chunk.cx <= 11 && chunk.cz >= 4 && chunk.cz <= 11);
    expect(inner).toHaveLength(64);
  });

  it('adds all three outer districts without replacing central districts', () => {
    const outer = world.chunks.filter((chunk) => chunk.cx < 4 || chunk.cx > 11 || chunk.cz < 4 || chunk.cz > 11);
    const districts = new Set(outer.map((chunk) => chunk.district));
    expect(districts).toEqual(new Set(['industrial', 'harbor', 'city_park']));
    expect(world.index.districts.map((district) => district.id)).toEqual(
      expect.arrayContaining(['downtown', 'residential', 'industrial', 'harbor', 'city_park']),
    );
  });

  it('publishes added bus routes to every new district', () => {
    expect(world.index.busRoutes.length).toBeGreaterThanOrEqual(3);
    for (const district of ['industrial', 'harbor', 'city_park'] as const) {
      expect(world.index.busRoutes.some((route) => route.districts.includes(district))).toBe(true);
      expect(world.index.busStops.some((stop) => stop.district === district)).toBe(true);
    }
  });
});

describe('F1/F5 baked world data', () => {
  it('places a lake adjacent to city park with water surface and blocking collision', () => {
    const lakeChunks = world.chunks.filter((chunk) => chunk.water.some((water) => water.kind === 'lake'));
    expect(lakeChunks.length).toBeGreaterThan(0);
    expect(lakeChunks.every((chunk) => chunk.district === 'city_park')).toBe(true);
    const lake = world.index.waterBodies.find((body) => body.id === 'lake_city_park');
    expect(lake).toBeDefined();
    expect(lake?.kind).toBe('lake');
    expect(lake?.adjacentDistrict).toBe('city_park');
    expect(lake?.noNav).toBe(true);
    for (const chunk of lakeChunks) {
      expect(chunk.surface).toContain(SURFACE.water);
      for (const water of chunk.water) {
        expect(water.noNav).toBe(true);
        expect(chunk.colliders).toContainEqual(water.bounds);
      }
    }
  });

  it('bakes lake and sea fishing spots, trash bins, and fish stalls', () => {
    const fishingSpots = world.chunks.flatMap((chunk) => chunk.fishingSpots);
    const trashBins = world.chunks.flatMap((chunk) => chunk.trashBins);
    const fishStalls = world.chunks.flatMap((chunk) => chunk.fishStalls);
    expect(fishingSpots.filter((spot) => spot.water === 'lake').length).toBeGreaterThanOrEqual(8);
    expect(fishingSpots.filter((spot) => spot.water === 'sea').length).toBeGreaterThanOrEqual(4);
    expect(new Set(fishingSpots.map((spot) => spot.id)).size).toBe(fishingSpots.length);
    expect(trashBins.length).toBeGreaterThan(20);
    expect(new Set(trashBins.map((bin) => bin.id)).size).toBe(trashBins.length);
    expect(fishStalls.map((stall) => stall.id)).toEqual(expect.arrayContaining(['fish_stall_lake', 'fish_stall_harbor']));
  });

  it('describes per-tile navmesh and size-aware map/exploration formats', () => {
    expect(world.index.navmesh).toEqual({ format: 'recast-tile-v1', directory: 'navmesh', pattern: '{cx}_{cz}.bin', loadRadius: 2 });
    expect(world.index.map).toMatchObject({ width: 1024, height: 1024, pixelsPerMeter: 1 });
    expect(world.index.exploration).toEqual({ version: 2, cellSize: 8, width: 128, height: 128, originX: -512, originZ: -512 });
    for (const entry of world.index.chunks) expect(entry.navmesh).toBe(`navmesh/${entry.cx}_${entry.cz}.bin`);
  });
});

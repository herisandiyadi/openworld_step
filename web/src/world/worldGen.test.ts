import { describe, expect, it } from 'vitest';
import type { Aabb } from '../game/movement';
import { BENCH_IDS, SEAT_HEIGHT } from './propSpec';
import { buildTerrainBuffers } from './terrainMesh';
import { generateWorld } from './worldGen';
import {
  BLOCK_PITCH,
  chunkGroundHeight,
  chunkCoord,
  chunkOrigin,
  GRID_CELLS,
  GRID_VERTS,
  HALF_WORLD,
  propCollider,
  ROAD_WIDTH,
  sampleChunkHeight,
  SIDEWALK_WIDTH,
  SURFACE,
  surfaceAt,
  WORLD_CHUNKS,
} from './worldSpec';

const world = generateWorld(1337);
const overlaps = (a: Aabb, b: Aabb) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
const allBuildings = world.chunks.flatMap((chunk) => chunk.buildings);

describe('generateWorld', () => {
  it('is deterministic', { timeout: 60_000 }, () => {
    expect(JSON.stringify(generateWorld(1337).chunks)).toBe(JSON.stringify(world.chunks));
  });

  it('produces a full chunk grid with correctly sized arrays and all five districts', () => {
    expect(world.chunks).toHaveLength(WORLD_CHUNKS * WORLD_CHUNKS);
    for (const chunk of world.chunks) {
      expect(chunk.heights).toHaveLength(GRID_VERTS * GRID_VERTS);
      expect(chunk.surface).toHaveLength(GRID_CELLS * GRID_CELLS);
    }
    expect(new Set(world.chunks.map((chunk) => chunk.district))).toEqual(
      new Set(['downtown', 'residential', 'industrial', 'harbor', 'city_park']),
    );
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

  it('keeps props out of buildings and on the ground', { timeout: 60_000 }, () => {
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
    expect(new Set(world.index.busStops.map((stop) => stop.district))).toEqual(
      new Set(['downtown', 'residential', 'industrial', 'harbor', 'city_park']),
    );
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

describe('bangku dan titik duduk', () => {
  const props = world.chunks.flatMap((chunk) => chunk.props);
  const benches = props.filter((prop) => BENCH_IDS.includes(prop.id));
  const local = (value: number) => (((value + HALF_WORLD) % BLOCK_PITCH) + BLOCK_PITCH) % BLOCK_PITCH;
  const HALF_ROAD = ROAD_WIDTH / 2;
  const onSidewalk = (value: number) => {
    const l = local(value);
    return (l > HALF_ROAD && l < HALF_ROAD + SIDEWALK_WIDTH) || (l > BLOCK_PITCH - HALF_ROAD - SIDEWALK_WIDTH && l < BLOCK_PITCH - HALF_ROAD);
  };
  const street = benches.filter((bench) => onSidewalk(bench.x) || onSidewalk(bench.z));

  it('menaruh bangku pinggir jalan di ketiga kawasan', () => {
    const districts = new Set(world.chunks.filter((chunk) => chunk.props.some((prop) => street.includes(prop))).map((chunk) => chunk.district));
    expect(districts).toEqual(new Set(['downtown', 'residential', 'industrial']));
  });

  it('menyisakan trotoar >= 1.4 m dan tidak di 6 m terakhir sebelum persimpangan', () => {
    for (const bench of street) {
      const box = propCollider(bench);
      const acrossX = onSidewalk(bench.x);
      const depth = acrossX ? box.maxX - box.minX : box.maxZ - box.minZ;
      expect(SIDEWALK_WIDTH - depth).toBeGreaterThanOrEqual(1.4 - 1e-6);
      const [min, max] = acrossX ? [box.minZ, box.maxZ] : [box.minX, box.maxX];
      // 6 m diukur dari tepi jalan yang memotong (awal blok).
      const blockStart = HALF_ROAD;
      expect(local(min)).toBeGreaterThanOrEqual(blockStart + 6 - 1e-6);
      expect(local(max)).toBeLessThanOrEqual(BLOCK_PITCH - blockStart - 6 + 1e-6);
    }
  });

  it('bangku tidak tumpang tindih dengan prop lain dan berjarak 1.5 m dari lampu/tempat sampah/halte', () => {
    // Prop di-indeks per sel 8 m supaya pemeriksaan tidak O(n^2) untuk ~20 ribu prop.
    const CELL = 8;
    const key = (x: number, z: number) => `${Math.floor(x / CELL)}_${Math.floor(z / CELL)}`;
    const grid = new Map<string, { prop: (typeof props)[number]; box: Aabb }[]>();
    for (const prop of props) {
      const entry = { prop, box: propCollider(prop) };
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const cell = key(prop.x + dx * CELL, prop.z + dz * CELL);
          const list = grid.get(cell);
          if (list) list.push(entry);
          else grid.set(cell, [entry]);
        }
      }
    }
    const furniture = ['prop_streetlamp_01', 'prop_trashbin_01', 'prop_busstop_01'];
    for (const bench of street) {
      const box = propCollider(bench);
      for (const { prop: other, box: otherBox } of grid.get(key(bench.x, bench.z)) ?? []) {
        if (other === bench) continue;
        expect(overlaps(box, otherBox)).toBe(false);
        if (furniture.includes(other.id)) {
          const gap = Math.max(otherBox.minX - box.maxX, box.minX - otherBox.maxX, otherBox.minZ - box.maxZ, box.minZ - otherBox.maxZ);
          expect(gap).toBeGreaterThanOrEqual(1.5 - 1e-6);
        }
      }
    }
  });

  it('membake 2 titik duduk per bangku di luar collider gedung, tinggi 0.45 m', () => {
    for (const chunk of world.chunks) {
      expect(chunk.seats).toHaveLength(chunk.props.filter((prop) => BENCH_IDS.includes(prop.id)).length * 2);
      for (const seat of chunk.seats) {
        expect(allBuildings.some((b) => seat.x > b.minX && seat.x < b.maxX && seat.z > b.minZ && seat.z < b.maxZ)).toBe(false);
        expect(seat.y).toBeCloseTo(chunkGroundHeight(chunk, seat.x, seat.z) + SEAT_HEIGHT, 1);
      }
    }
    const ids = world.chunks.flatMap((chunk) => chunk.seats.map((seat) => seat.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(world.index.seats).toHaveLength(ids.length);
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
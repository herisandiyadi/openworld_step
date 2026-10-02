/**
 * Offline world bake: per-chunk JSON + world index, Recast navmesh, and the baked map image.
 * Deterministic for a given seed. Usage: npm run world
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportNavMesh, init, NavMeshQuery } from '@recast-navigation/core';
import { generateTiledNavMesh } from '@recast-navigation/generators';
import type { Aabb } from '../../src/game/movement';
import { PROP_COLLIDERS } from '../../src/world/propSpec';
import { buildTerrainBuffers } from '../../src/world/terrainMesh';
import { generateWorld } from '../../src/world/worldGen';
import {
  type ChunkData,
  chunkGroundHeight,
  chunkKey,
  chunkOrigin,
  CHUNK_SIZE,
  GRID_CELLS,
  GRID_STEP,
  HALF_WORLD,
  SURFACE_COLORS,
  type SurfaceId,
  WORLD_CHUNKS,
  WORLD_SIZE,
} from '../../src/world/worldSpec';
import { encodePng } from '../assets/lib/png';

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = join(WEB_ROOT, 'public/world');
const BUILDING_MAP_COLOR = '#7d8796';
/** Agent matches the player: radius 0.4 m (rounded up to the cell), height 1.8 m, can step onto 0.15 m curbs. */
const NAV_CONFIG = {
  cs: 0.25,
  ch: 0.1,
  tileSize: 64,
  walkableRadius: 2,
  walkableHeight: 18,
  walkableClimb: 4,
  walkableSlopeAngle: 40,
  maxEdgeLen: 48,
  maxSimplificationError: 1.3,
  minRegionArea: 8,
  mergeRegionArea: 20,
  maxVertsPerPoly: 6,
  detailSampleDist: 6,
  detailSampleMaxError: 1,
};

class GeometrySink {
  positions: number[] = [];
  indices: number[] = [];

  addTriangles(flat: Float32Array): void {
    const base = this.positions.length / 3;
    for (const value of flat) this.positions.push(value);
    for (let i = 0; i < flat.length / 3; i++) this.indices.push(base + i);
  }

  /** Closed box; Recast only needs the surfaces, winding is counter-clockwise seen from outside. */
  addBox(box: Aabb, minY: number, maxY: number): void {
    const base = this.positions.length / 3;
    for (const y of [minY, maxY]) {
      this.positions.push(box.minX, y, box.minZ, box.maxX, y, box.minZ, box.maxX, y, box.maxZ, box.minX, y, box.maxZ);
    }
    const faces = [
      [4, 7, 6, 5],
      [0, 1, 2, 3],
      [0, 4, 5, 1],
      [1, 5, 6, 2],
      [2, 6, 7, 3],
      [3, 7, 4, 0],
    ];
    for (const [a, b, c, d] of faces as [number, number, number, number][]) {
      this.indices.push(base + a, base + b, base + c, base + a, base + c, base + d);
    }
  }
}

function bakeNavMeshInput(chunks: ChunkData[]): GeometrySink {
  const sink = new GeometrySink();
  for (const chunk of chunks) {
    sink.addTriangles(buildTerrainBuffers(chunk).positions);
    for (const building of chunk.buildings) sink.addBox(building, building.baseY, building.topY);
    for (const prop of chunk.props) {
      const collider = PROP_COLLIDERS[prop.id];
      const footprint = chunk.colliders.find(
        (box) => Math.abs((box.minX + box.maxX) / 2 - prop.x) < 2 && Math.abs((box.minZ + box.maxZ) / 2 - prop.z) < 2,
      );
      if (footprint) sink.addBox(footprint, prop.y - 0.2, prop.y + collider.center[1] + collider.size[1] / 2);
    }
  }
  return sink;
}

function hexRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** North-up map image: +X to the right, +Z down (matches the minimap's world-to-pixel mapping). */
function renderMap(chunks: ChunkData[], pixelsPerMeter: number): Buffer {
  const size = WORLD_SIZE * pixelsPerMeter;
  const rgb = new Uint8Array(size * size * 3);
  const chunkAt = (x: number, z: number) =>
    chunks[Math.floor((z + HALF_WORLD) / CHUNK_SIZE) * WORLD_CHUNKS + Math.floor((x + HALF_WORLD) / CHUNK_SIZE)];
  const surfaceRgb = Object.fromEntries(Object.entries(SURFACE_COLORS).map(([id, hex]) => [id, hexRgb(hex)]));
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5) / pixelsPerMeter - HALF_WORLD;
      const z = (py + 0.5) / pixelsPerMeter - HALF_WORLD;
      const chunk = chunkAt(x, z);
      if (!chunk) continue;
      const i = Math.min(GRID_CELLS - 1, Math.floor((x - chunkOrigin(chunk.cx)) / GRID_STEP));
      const j = Math.min(GRID_CELLS - 1, Math.floor((z - chunkOrigin(chunk.cz)) / GRID_STEP));
      const color = surfaceRgb[chunk.surface[j * GRID_CELLS + i] as SurfaceId] ?? [0, 0, 0];
      rgb.set(color, (py * size + px) * 3);
    }
  }
  const building = hexRgb(BUILDING_MAP_COLOR);
  for (const chunk of chunks) {
    for (const box of chunk.buildings) {
      const x0 = Math.round((box.minX + HALF_WORLD) * pixelsPerMeter);
      const x1 = Math.round((box.maxX + HALF_WORLD) * pixelsPerMeter);
      const y0 = Math.round((box.minZ + HALF_WORLD) * pixelsPerMeter);
      const y1 = Math.round((box.maxZ + HALF_WORLD) * pixelsPerMeter);
      for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) rgb.set(building, (py * size + px) * 3);
    }
  }
  return encodePng(size, size, rgb);
}

const insideAny = (x: number, z: number, boxes: Aabb[]) =>
  boxes.some((box) => x > box.minX && x < box.maxX && z > box.minZ && z < box.maxZ);

async function main(): Promise<void> {
  const started = performance.now();
  const { index, chunks } = generateWorld();

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(join(OUT_DIR, 'chunks'), { recursive: true });
  let chunkBytes = 0;
  let maxChunkBytes = 0;
  for (const chunk of chunks) {
    const json = JSON.stringify(chunk);
    chunkBytes += json.length;
    maxChunkBytes = Math.max(maxChunkBytes, json.length);
    await writeFile(join(OUT_DIR, 'chunks', `${chunkKey(chunk.cx, chunk.cz)}.json`), json);
  }
  await writeFile(join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2));

  await init();
  const input = bakeNavMeshInput(chunks);
  const navStarted = performance.now();
  const result = generateTiledNavMesh(input.positions, input.indices, NAV_CONFIG);
  if (!result.success) throw new Error(`navmesh generation failed: ${result.error}`);
  const navMs = performance.now() - navStarted;
  const navBytes = exportNavMesh(result.navMesh);
  await writeFile(join(OUT_DIR, index.navmesh), navBytes);

  // Gate: paths from spawn reach every NPC and the world corners without crossing buildings.
  // Corner-to-corner paths cross the whole city; the default 2048-node A* pool returns partial paths.
  const query = new NavMeshQuery(result.navMesh, { maxNodes: 8192 });
  const allBuildings = chunks.flatMap((chunk) => chunk.buildings);
  const groundAt = (x: number, z: number) => {
    const chunk = chunks[Math.floor((z + HALF_WORLD) / CHUNK_SIZE) * WORLD_CHUNKS + Math.floor((x + HALF_WORLD) / CHUNK_SIZE)];
    return chunk ? chunkGroundHeight(chunk, x, z) : 0;
  };
  const goals = [
    ...index.npcs.map((npc) => ({ label: npc.name, x: npc.x + 1.2, z: npc.z })),
    { label: 'NE corner', x: 224, z: -224 },
    { label: 'SW corner', x: -224, z: 224 },
    { label: 'SE corner', x: 224, z: 224 },
  ];
  const failures: string[] = [];
  for (const goal of goals) {
    const start = { x: index.spawn.x, y: groundAt(index.spawn.x, index.spawn.z), z: index.spawn.z };
    const end = { x: goal.x, y: groundAt(goal.x, goal.z), z: goal.z };
    const path = query.computePath(start, end, { halfExtents: { x: 2, y: 1, z: 2 }, maxPathPolys: 2048 });
    const last = path.path[path.path.length - 1];
    const reached = path.success && last !== undefined && Math.hypot(last.x - goal.x, last.z - goal.z) < 1.5;
    let crossesBuilding = false;
    for (let k = 1; k < path.path.length; k++) {
      const a = path.path[k - 1];
      const b = path.path[k];
      if (!a || !b) continue;
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.5);
      for (let s = 0; s <= steps; s++) {
        const t = s / Math.max(steps, 1);
        if (insideAny(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, allBuildings)) crossesBuilding = true;
      }
    }
    console.log(`path spawn -> ${goal.label}: ${reached ? 'ok' : 'FAIL'} (${path.path.length} pts)${crossesBuilding ? ' CROSSES BUILDING' : ''}`);
    if (!reached || crossesBuilding) failures.push(goal.label);
  }
  query.destroy();
  result.navMesh.destroy();

  const ppm = index.map.pixelsPerMeter;
  await writeFile(join(OUT_DIR, index.map.file), renderMap(chunks, ppm));

  const props = chunks.reduce((sum, chunk) => sum + chunk.props.length, 0);
  const buildings = chunks.reduce((sum, chunk) => sum + chunk.buildings.length, 0);
  const maxProps = Math.max(...chunks.map((chunk) => chunk.props.length));
  console.log(
    [
      `chunks: ${chunks.length} (${WORLD_CHUNKS}x${WORLD_CHUNKS} of ${CHUNK_SIZE} m), ${(chunkBytes / 1024).toFixed(0)} KB total, max ${(maxChunkBytes / 1024).toFixed(1)} KB`,
      `buildings: ${buildings}, props: ${props} (max ${maxProps}/chunk), npcs: ${index.npcs.length}`,
      `navmesh: ${(input.indices.length / 3).toLocaleString()} input tris, built in ${(navMs / 1000).toFixed(1)} s, ${(navBytes.length / 1024).toFixed(0)} KB`,
      `map: ${WORLD_SIZE * ppm}px`,
      `total ${((performance.now() - started) / 1000).toFixed(1)} s`,
    ].join('\n'),
  );
  if (failures.length > 0) {
    console.error(`FAILED navmesh checks: ${failures.join(', ')}`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
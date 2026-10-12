/**
 * Worker navmesh per batch: proses terpisah supaya heap WASM Recast di-reset tiap batch
 * (bake 1.024 chunk dalam satu proses membuat WASM abort di ~chunk 358).
 * Usage: npx vite-node tools/geo/nav-worker.ts -- --dir <outDir> --keys 0_0,0_1,...
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { exportNavMesh, init } from '@recast-navigation/core';
import { generateTiledNavMesh } from '@recast-navigation/generators';
import type { Aabb } from '../../src/game/movement';
import { buildTerrainBuffers } from '../../src/world/terrainMesh';
import { CHUNK_SIZE, SURFACE, type ChunkData } from '../../src/world/worldSpec';

const argv = process.argv.slice(2);
const get = (flag: string) => {
  const at = argv.indexOf(flag);
  return at >= 0 ? argv[at + 1] : undefined;
};
const dir = get('--dir');
const keys = (get('--keys') ?? '').split(',').filter(Boolean);
if (!dir || keys.length === 0) throw new Error('wajib: --dir <outDir> --keys <cx_cz,...>');

const NAV_CONFIG = {
  cs: 0.25, ch: 0.1, tileSize: CHUNK_SIZE,
  walkableRadius: 2, walkableHeight: 18, walkableClimb: 4, walkableSlopeAngle: 40,
  maxEdgeLen: 48, maxSimplificationError: 1.3, minRegionArea: 8, mergeRegionArea: 20,
  maxVertsPerPoly: 6, detailSampleDist: 6, detailSampleMaxError: 1,
};

class GeometrySink {
  positions: number[] = [];
  indices: number[] = [];
  addTriangles(flat: Float32Array): void {
    const base = this.positions.length / 3;
    for (const v of flat) this.positions.push(v);
    for (let i = 0; i < flat.length / 3; i++) this.indices.push(base + i);
  }
  addBox(box: Aabb, minY: number, maxY: number): void {
    const base = this.positions.length / 3;
    for (const y of [minY, maxY]) {
      this.positions.push(box.minX, y, box.minZ, box.maxX, y, box.minZ, box.maxX, y, box.maxZ, box.minX, y, box.maxZ);
    }
    const faces = [[4, 7, 6, 5], [0, 1, 2, 3], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]];
    for (const [a, b, c, d] of faces as [number, number, number, number][]) {
      this.indices.push(base + a, base + b, base + c, base + a, base + c, base + d);
    }
  }
}

await init();
const failures: string[] = [];
for (const key of keys) {
  const chunk = JSON.parse(await readFile(join(resolve(dir), 'chunks', `${key}.json`), 'utf8')) as ChunkData;
  const sink = new GeometrySink();
  sink.addTriangles(buildTerrainBuffers(chunk, new Set([SURFACE.water])).positions);
  for (const b of chunk.buildings) sink.addBox(b, b.baseY, b.topY);
  const file = join(resolve(dir), 'navmesh', `${key}.bin`);
  if (sink.indices.length === 0) {
    await writeFile(file, new Uint8Array(0));
    continue;
  }
  const result = generateTiledNavMesh(sink.positions, sink.indices, NAV_CONFIG);
  if (!result.success) {
    failures.push(key);
    continue;
  }
  await writeFile(file, exportNavMesh(result.navMesh));
  result.navMesh.destroy();
}
console.log(JSON.stringify({ batch: keys.length, failures }));

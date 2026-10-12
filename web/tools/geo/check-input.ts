/**
 * Validasi numerik output buildGeoWorld sebelum navmesh: cari NaN/Infinity/degenerate box.
 * Usage: npx vite-node tools/geo/check-input.ts -- --xml <file> --bbox w,s,e,n [--chunks 32]
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildGeoWorld, type GeoBbox } from './convert';

const argv = process.argv.slice(2);
const get = (flag: string) => {
  const at = argv.indexOf(flag);
  return at >= 0 ? argv[at + 1] : undefined;
};
const xmlPath = get('--xml');
const bboxRaw = get('--bbox');
if (!xmlPath || !bboxRaw) throw new Error('wajib: --xml --bbox w,s,e,n');
const [w, s, e, n] = bboxRaw.split(',').map(Number) as [number, number, number, number];
const xml = await readFile(resolve(xmlPath), 'utf8');
const world = buildGeoWorld({ xml, bbox: { w, s, e, n } as GeoBbox, name: 'check', worldChunks: Number(get('--chunks') ?? 32), chunkSize: 64, buildingHeightDefault: 8 });

let bad = 0;
const check = (label: string, v: number) => {
  if (!Number.isFinite(v)) { if (bad < 10) console.log('NON-FINITE', label, v); bad++; }
};
for (const chunk of world.chunks) {
  for (const h of chunk.heights) check(`h ${chunk.cx},${chunk.cz}`, h);
  for (const sf of chunk.surface) if (sf < 0 || sf > 4) { console.log('BAD SURFACE', chunk.cx, chunk.cz, sf); bad++; }
  for (const b of chunk.buildings) {
    for (const v of [b.minX, b.maxX, b.minZ, b.maxZ, b.baseY, b.topY]) check(`b ${b.minX}`, v);
    if (b.minX >= b.maxX || b.minZ >= b.maxZ || b.topY <= b.baseY) { console.log('DEGENERATE', JSON.stringify(b)); bad++; }
  }
  for (const water of chunk.water) {
    for (const v of [water.bounds.minX, water.bounds.maxX, water.bounds.minZ, water.bounds.maxZ]) check('water', v);
  }
}
console.log(JSON.stringify({
  chunks: world.chunks.length,
  buildings: world.stats.buildings,
  roads: world.stats.roadWays,
  waterWays: world.stats.waterWays,
  greenWays: world.stats.greenWays,
  outside: world.stats.outside,
  spawn: world.index.spawn,
  nonFinite: bad,
}, null, 2));

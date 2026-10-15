/**
 * Bake map geo: OSM XML -> public/world-<name>/ (chunks, index, navmesh, map.png, lanes).
 * Jalur 1: dataset terpisah, tidak menyentuh dunia prosedural.
 * Usage: npm run geo -- --xml <file> --bbox w,s,e,n --name little_tokyo [--chunks 32] [--height 8]
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type ChunkData,
  chunkKey,
  CHUNK_SIZE,
  GRID_CELLS,
  GRID_STEP,
  SURFACE_COLORS,
  type SurfaceId,
} from '../../src/world/worldSpec';
import { encodePng } from '../assets/lib/png';
import { buildGeoWorld, type GeoBbox } from './convert';

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BUILDING_MAP_COLOR = '#7d8796';

interface Args { xml: string; bbox: GeoBbox; name: string; chunks: number; height: number; }

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const at = argv.indexOf(flag);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  const xml = get('--xml');
  const bboxRaw = get('--bbox');
  const name = get('--name');
  if (!xml || !bboxRaw || !name) throw new Error('wajib: --xml <file> --bbox w,s,e,n --name <slug>');
  const parts = bboxRaw.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) throw new Error('--bbox harus w,s,e,n');
  const [w, s, e, n] = parts as [number, number, number, number];
  if (!(w < e && s < n)) throw new Error('--bbox tidak valid (w<e, s<n)');
  return {
    xml, bbox: { w, s, e, n }, name,
    chunks: Number(get('--chunks') ?? 32),
    height: Number(get('--height') ?? 8),
  };
}

function hexRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Map utara-atas, +X kanan, +Z bawah. Ukuran = worldSize (1 px = 1 m). */
function renderMap(chunks: ChunkData[], worldSize: number, halfWorld: number): Buffer {
  const size = worldSize;
  const rgb = new Uint8Array(size * size * 3);
  const surfaceRgb = Object.fromEntries(Object.entries(SURFACE_COLORS).map(([id, hex]) => [id, hexRgb(hex)]));
  const perChunk = CHUNK_SIZE / GRID_STEP;
  const cols = Math.round(worldSize / CHUNK_SIZE);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = px + 0.5 - halfWorld;
      const z = py + 0.5 - halfWorld;
      const cx = Math.min(cols - 1, Math.floor((x + halfWorld) / CHUNK_SIZE));
      const cz = Math.min(cols - 1, Math.floor((z + halfWorld) / CHUNK_SIZE));
      const chunk = chunks[cz * cols + cx];
      if (!chunk) continue;
      const i = Math.min(GRID_CELLS - 1, Math.floor((x - (cx * CHUNK_SIZE - halfWorld)) / GRID_STEP));
      const j = Math.min(GRID_CELLS - 1, Math.floor((z - (cz * CHUNK_SIZE - halfWorld)) / GRID_STEP));
      const color = surfaceRgb[chunk.surface[j * perChunk + i] as SurfaceId] ?? [0, 0, 0];
      rgb.set(color, (py * size + px) * 3);
    }
  }
  const building = hexRgb(BUILDING_MAP_COLOR);
  for (const chunk of chunks) {
    for (const box of chunk.buildings) {
      const x0 = Math.max(0, Math.round(box.minX + halfWorld));
      const x1 = Math.min(size, Math.round(box.maxX + halfWorld));
      const y0 = Math.max(0, Math.round(box.minZ + halfWorld));
      const y1 = Math.min(size, Math.round(box.maxZ + halfWorld));
      for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) rgb.set(building, (py * size + px) * 3);
    }
  }
  return encodePng(size, size, rgb);
}

function runWorker(workerFile: string, outDir: string, keys: string[]): Promise<string[]> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [join(WEB_ROOT, 'node_modules', 'vite-node', 'vite-node.mjs'), workerFile, '--', '--dir', outDir, '--keys', keys.join(',')], { cwd: WEB_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    child.on('error', reject);
    child.on('close', (code: number | null) => {
      const line = out.trim().split('\n').pop() ?? '';
      try {
        const parsed = JSON.parse(line) as { failures: string[] };
        resolveRun(code === 0 ? parsed.failures : [...keys]);
      } catch {
        if (process.env.GEO_TRACE) console.error(err.slice(-400));
        resolveRun(keys);
      }
    });
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const started = performance.now();
  const xml = await readFile(resolve(args.xml), 'utf8');
  const { chunks, index, worldSize, halfWorld, stats, lanes } = buildGeoWorld({
    xml,
    bbox: args.bbox,
    name: args.name,
    worldChunks: args.chunks,
    chunkSize: CHUNK_SIZE,
    buildingHeightDefault: args.height,
  });
  const outDir = join(WEB_ROOT, 'public', `world-${args.name}`);

  // Pick spawn: chunk with most buildings (downtown). Fallback to center if none.
  let spawnCx = Math.floor(args.chunks / 2), spawnCz = Math.floor(args.chunks / 2);
  let maxBuildings = 0;
  for (const chunk of chunks) {
    if (chunk.buildings.length > maxBuildings) {
      maxBuildings = chunk.buildings.length;
      spawnCx = chunk.cx;
      spawnCz = chunk.cz;
    }
  }
  const spawnX = (spawnCx + 0.5) * CHUNK_SIZE - halfWorld;
  const spawnZ = (spawnCz + 0.5) * CHUNK_SIZE - halfWorld;
  index.spawn = { x: spawnX, z: spawnZ };

  await rm(outDir, { recursive: true, force: true });
  await mkdir(join(outDir, 'chunks'), { recursive: true });
  for (const chunk of chunks) {
    await writeFile(join(outDir, 'chunks', `${chunkKey(chunk.cx, chunk.cz)}.json`), JSON.stringify(chunk));
  }
  await writeFile(join(outDir, 'index.json'), JSON.stringify(index, null, 2));

  // Navmesh per chunk di proses worker terpisah (WASM Recast bocor memori di proses panjang).
  const navDir = join(outDir, index.navmesh.directory);
  await mkdir(navDir, { recursive: true });
  const keys = chunks.map((chunk) => chunkKey(chunk.cx, chunk.cz));
  const BATCH = 64;
  const batches: string[][] = [];
  for (let i = 0; i < keys.length; i += BATCH) batches.push(keys.slice(i, i + BATCH));
  const workerFile = join(WEB_ROOT, 'tools', 'geo', 'nav-worker.ts');
  const failures: string[] = [];
  const CONCURRENCY = 4;
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const group = batches.slice(i, i + CONCURRENCY);
    const results = await Promise.all(group.map((batch) => runWorker(workerFile, outDir, batch)));
    for (const result of results) failures.push(...result);
    console.log(`navmesh ${Math.min(i + CONCURRENCY, batches.length)}/${batches.length} batch`);
  }

  await writeFile(join(outDir, index.map.file), renderMap(chunks, worldSize, halfWorld));
  // Lanes: OSM tidak dipakai untuk lalu lintas (keputusan #5, lihat Notion). Tulis graf kosong
  // yang valid sesuai skema LanesData supaya game tidak menerima HTML fallback saat fetch.
  // Lanes dari OSM: graf jalan (kendaraan) + graf trotoar (pejalan kaki). Tanpa ini
  // PedestrianLayer berhenti karena walkEdges kosong dan kota terasa mati.
  await writeFile(join(outDir, 'lanes.json'), JSON.stringify(lanes));

  console.log(
    [
      `geo world "${args.name}": ${worldSize} m (${args.chunks}x${args.chunks} chunk)`,
      `buildings: ${stats.buildings}, roads: ${stats.roadWays}, water: ${stats.waterWays}, green: ${stats.greenWays}`,
      `navmesh failures: ${failures.length}${failures.length ? ` (${failures.slice(0, 5).join(', ')})` : ''}`,
      `spawn: ${spawnX.toFixed(1)}, ${spawnZ.toFixed(1)} (chunk ${spawnCx},${spawnCz})`,
      `total ${((performance.now() - started) / 1000).toFixed(1)} s -> ${outDir}`,
    ].join('\n'),
  );
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

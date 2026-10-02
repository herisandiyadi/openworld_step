import type { Aabb } from '../game/movement';
import {
  BLOCK_PITCH,
  type Building,
  type ChunkData,
  CHUNK_SIZE,
  chunkGroundHeight,
  chunkKey,
  chunkOrigin,
  districtOf,
  type DistrictId,
  GRID_CELLS,
  GRID_STEP,
  GRID_VERTS,
  HALF_WORLD,
  type NpcSpawn,
  type PropPlacement,
  propCollider,
  ROAD_WIDTH,
  SIDEWALK_WIDTH,
  SURFACE,
  WORLD_CHUNKS,
  WORLD_DATA_VERSION,
  WORLD_SIZE,
  type WorldIndex,
} from './worldSpec';
import { BENCH_IDS, PROP_COLLIDERS, PROP_IDS, type PropId, SEAT_HEIGHT, SEAT_OFFSETS_X } from './propSpec';

/**
 * Offline, deterministic city generator (run by tools/world/build.ts, also used by tests).
 * The runtime never calls this: it streams the JSON chunks it produces.
 */

export interface GeneratedWorld {
  index: WorldIndex;
  chunks: ChunkData[];
}

type BlockKind = 'towers' | 'plaza' | 'houses' | 'park' | 'warehouses';

interface Block extends Aabb {
  bx: number;
  bz: number;
  district: DistrictId;
  kind: BlockKind;
}

const HALF_PI = Math.PI / 2;
const BLOCKS_PER_SIDE = WORLD_SIZE / BLOCK_PITCH;
const HALF_ROAD = ROAD_WIDTH / 2;
const NPC_HALF_SIZE = 0.35;
const BUS_WAIT_OFFSET = 1.8;
const chunkCoordOf = (value: number) => Math.min(WORLD_CHUNKS - 1, Math.max(0, Math.floor((value + HALF_WORLD) / CHUNK_SIZE)));
const DOWNTOWN_COLORS = ['#9fb4c7', '#c9b79c', '#a7a3b8', '#d8d4cc', '#8fa2b5', '#b9c2c9'];
const INDUSTRIAL_COLORS = ['#8c939b', '#a9886a', '#6f7f8f', '#b3b09f', '#7e8a74'];
/** Bangku pinggir jalan memakai prop_bench_02 kalau asetnya sudah terdaftar, kalau belum prop_bench_01. */
const STREET_BENCH: PropId = (PROP_IDS as readonly string[]).includes('prop_bench_02') ? ('prop_bench_02' as PropId) : 'prop_bench_01';
/** Jarak bebas bangku dari lampu, tempat sampah, dan halte (tepi ke tepi). */
const BENCH_CLEARANCE = 1.5;
const BENCH_CLEAR_OF: readonly PropId[] = ['prop_streetlamp_01', 'prop_trashbin_01', 'prop_busstop_01'];
const HOUSE_COLORS = ['#e8d8c3', '#d9a68b', '#b8c4a6', '#e3c46f', '#f0e4d0', '#c98f7a'];

export const NPCS: NpcSpawn[] = [
  { id: 'npc_budi', asset: 'npc_vendor', name: 'Pak Budi', x: 5, z: 10, yaw: HALF_PI },
  { id: 'npc_sari', asset: 'npc_vendor', name: 'Bu Sari', x: -187, z: -170, yaw: HALF_PI },
  // On sidewalks (5 m from a road centre line) so they never sit inside a building lot.
  { id: 'npc_rina', asset: 'npc_vendor', name: 'Mbak Rina', x: 69, z: -54, yaw: HALF_PI },
  { id: 'npc_dewi', asset: 'npc_vendor', name: 'Bu Dewi', x: -123, z: 74, yaw: HALF_PI },
  { id: 'npc_joko', asset: 'npc_vendor', name: 'Mas Joko', x: 165, z: 138, yaw: HALF_PI },
];

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const smoothstep = (edge0: number, edge1: number, value: number) =>
  smooth(Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0))));

function valueNoise(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = smooth(x - x0);
  const fz = smooth(z - z0);
  const a = hash2(x0, z0, seed);
  const b = hash2(x0 + 1, z0, seed);
  const c = hash2(x0, z0 + 1, seed);
  const d = hash2(x0 + 1, z0 + 1, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

/** Gentle terrain: nearly flat downtown, rolling hills (up to ~5 m) in the residential ring. */
export function terrainHeight(x: number, z: number, seed: number): number {
  const noise = valueNoise(x / 96, z / 96, seed) * 0.7 + valueNoise(x / 40, z / 40, seed + 1) * 0.3;
  const ring = Math.max(Math.abs(x), Math.abs(z)) / HALF_WORLD;
  const amplitude = 0.5 + 4.5 * smoothstep(0.4, 0.75, ring);
  return noise * amplitude;
}

const mod = (value: number, base: number) => ((value % base) + base) % base;
const bandAt = (value: number) => mod(value + HALF_WORLD, BLOCK_PITCH);
const isRoadBand = (local: number) => local < HALF_ROAD || local > BLOCK_PITCH - HALF_ROAD;
const isSidewalkBand = (local: number) =>
  local < HALF_ROAD + SIDEWALK_WIDTH || local > BLOCK_PITCH - HALF_ROAD - SIDEWALK_WIDTH;

function makeBlocks(seed: number): Block[] {
  const random = mulberry32(seed ^ 0x5bd1e995);
  const blocks: Block[] = [];
  for (let bz = 0; bz < BLOCKS_PER_SIDE; bz++) {
    for (let bx = 0; bx < BLOCKS_PER_SIDE; bx++) {
      const district = districtOf(Math.floor((bx * BLOCK_PITCH) / CHUNK_SIZE), Math.floor((bz * BLOCK_PITCH) / CHUNK_SIZE));
      const roll = random();
      const kind: BlockKind =
        district === 'downtown'
          ? roll < 0.18
            ? 'plaza'
            : 'towers'
          : district === 'industrial'
            ? roll < 0.15
              ? 'park'
              : 'warehouses'
            : roll < 0.2
              ? 'park'
              : 'houses';
      const minX = -HALF_WORLD + bx * BLOCK_PITCH + HALF_ROAD;
      const minZ = -HALF_WORLD + bz * BLOCK_PITCH + HALF_ROAD;
      blocks.push({ bx, bz, district, kind, minX, minZ, maxX: minX + BLOCK_PITCH - ROAD_WIDTH, maxZ: minZ + BLOCK_PITCH - ROAD_WIDTH });
    }
  }
  return blocks;
}

function surfaceAtWorld(x: number, z: number, blocks: readonly Block[]): number {
  const lx = bandAt(x);
  const lz = bandAt(z);
  if (isRoadBand(lx) || isRoadBand(lz)) return SURFACE.road;
  if (isSidewalkBand(lx) || isSidewalkBand(lz)) return SURFACE.sidewalk;
  const bx = Math.floor((x + HALF_WORLD) / BLOCK_PITCH);
  const bz = Math.floor((z + HALF_WORLD) / BLOCK_PITCH);
  const kind = blocks[bz * BLOCKS_PER_SIDE + bx]?.kind ?? 'park';
  if (kind === 'towers' || kind === 'plaza' || kind === 'warehouses') return SURFACE.plaza;
  return SURFACE.grass;
}

function makeChunkGround(cx: number, cz: number, seed: number, blocks: readonly Block[]): ChunkData {
  const originX = chunkOrigin(cx);
  const originZ = chunkOrigin(cz);
  const heights: number[] = [];
  for (let j = 0; j < GRID_VERTS; j++) {
    for (let i = 0; i < GRID_VERTS; i++) {
      heights.push(Math.round(terrainHeight(originX + i * GRID_STEP, originZ + j * GRID_STEP, seed) * 100));
    }
  }
  const surface: number[] = [];
  for (let j = 0; j < GRID_CELLS; j++) {
    for (let i = 0; i < GRID_CELLS; i++) {
      surface.push(surfaceAtWorld(originX + (i + 0.5) * GRID_STEP, originZ + (j + 0.5) * GRID_STEP, blocks));
    }
  }
  return {
    version: WORLD_DATA_VERSION,
    cx,
    cz,
    district: districtOf(cx, cz),
    heights,
    surface,
    buildings: [],
    props: [],
    colliders: [],
    seats: [],
  };
}

const overlaps = (a: Aabb, b: Aabb) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
const expand = (box: Aabb, margin: number): Aabb => ({
  minX: box.minX - margin,
  maxX: box.maxX + margin,
  minZ: box.minZ - margin,
  maxZ: box.maxZ + margin,
});

/** Generates the full city. Same seed -> byte-identical chunk data. */
export function generateWorld(seed = 1337): GeneratedWorld {
  const random = mulberry32(seed);
  const blocks = makeBlocks(seed);
  const chunks: ChunkData[] = [];
  for (let cz = 0; cz < WORLD_CHUNKS; cz++) {
    for (let cx = 0; cx < WORLD_CHUNKS; cx++) chunks.push(makeChunkGround(cx, cz, seed, blocks));
  }
  const chunkAt = (x: number, z: number): ChunkData => {
    const cx = Math.min(WORLD_CHUNKS - 1, Math.max(0, Math.floor((x + HALF_WORLD) / CHUNK_SIZE)));
    const cz = Math.min(WORLD_CHUNKS - 1, Math.max(0, Math.floor((z + HALF_WORLD) / CHUNK_SIZE)));
    const chunk = chunks[cz * WORLD_CHUNKS + cx];
    if (!chunk) throw new Error(`chunk ${cx},${cz} missing`);
    return chunk;
  };
  const ground = (x: number, z: number) => chunkGroundHeight(chunkAt(x, z), x, z);
  const quarterYaw = () => Math.floor(random() * 4) * HALF_PI;

  const buildings: Building[] = [];
  let props: PropPlacement[] = [];
  const addProp = (id: PropPlacement['id'], x: number, z: number, yaw: number) => props.push({ id, x, y: 0, z, yaw });
  const streetBenches: PropPlacement[] = [];

  const addBuilding = (box: Aabb, height: number, color: string) => {
    const samples = [
      ground(box.minX, box.minZ),
      ground(box.maxX, box.minZ),
      ground(box.minX, box.maxZ),
      ground(box.maxX, box.maxZ),
      ground((box.minX + box.maxX) / 2, (box.minZ + box.maxZ) / 2),
    ];
    const round2 = (value: number) => Math.round(value * 100) / 100;
    buildings.push({ ...box, baseY: round2(Math.min(...samples) - 0.3), topY: round2(Math.max(...samples) + height), color });
  };
  const pick = (list: readonly string[]) => list[Math.floor(random() * list.length)] ?? '#cccccc';

  for (const block of blocks) {
    const innerMinX = block.minX + SIDEWALK_WIDTH;
    const innerMinZ = block.minZ + SIDEWALK_WIDTH;
    const inner = block.maxX - block.minX - SIDEWALK_WIDTH * 2;
    const centerX = (block.minX + block.maxX) / 2;
    const centerZ = (block.minZ + block.maxZ) / 2;

    if (block.kind === 'towers') {
      if (random() < 0.15) {
        const inset = 1 + random();
        addBuilding(
          { minX: innerMinX + inset, maxX: innerMinX + inner - inset, minZ: innerMinZ + inset, maxZ: innerMinZ + inner - inset },
          24 + Math.floor(random() * 5) * 6,
          pick(DOWNTOWN_COLORS),
        );
      } else {
        const lot = inner / 2;
        for (let lz = 0; lz < 2; lz++) {
          for (let lx = 0; lx < 2; lx++) {
            const inset = 0.8 + random() * 1.2;
            addBuilding(
              {
                minX: innerMinX + lx * lot + inset,
                maxX: innerMinX + (lx + 1) * lot - inset,
                minZ: innerMinZ + lz * lot + inset,
                maxZ: innerMinZ + (lz + 1) * lot - inset,
              },
              12 + Math.floor(random() * 8) * 4,
              pick(DOWNTOWN_COLORS),
            );
          }
        }
      }
    } else if (block.kind === 'warehouses') {
      // Two long, low sheds per block with a yard between them.
      const half = inner / 2;
      for (let lz = 0; lz < 2; lz++) {
        const inset = 1 + random();
        addBuilding(
          {
            minX: innerMinX + inset,
            maxX: innerMinX + inner - inset,
            minZ: innerMinZ + lz * half + inset,
            maxZ: innerMinZ + (lz + 1) * half - inset - 1.5,
          },
          6 + Math.floor(random() * 3) * 1.5,
          pick(INDUSTRIAL_COLORS),
        );
      }
    } else if (block.kind === 'houses') {
      const lot = inner / 3;
      for (let lz = 0; lz < 3; lz++) {
        for (let lx = 0; lx < 3; lx++) {
          const lotX = innerMinX + (lx + 0.5) * lot;
          const lotZ = innerMinZ + (lz + 0.5) * lot;
          if ((lx === 1 && lz === 1) || random() < 0.2) {
            addProp('prop_tree_01', lotX, lotZ, quarterYaw());
            continue;
          }
          const half = lot / 2 - (0.9 + random() * 0.6);
          addBuilding({ minX: lotX - half, maxX: lotX + half, minZ: lotZ - half, maxZ: lotZ + half }, 3.5 + random() * 3.5, pick(HOUSE_COLORS));
        }
      }
    } else {
      // Parks and plazas: open space with trees around and benches facing the centre.
      for (const [dx, dz] of [
        [-6, -6],
        [6, -6],
        [-6, 6],
        [6, 6],
      ] as const) {
        addProp('prop_tree_01', centerX + dx, centerZ + dz, quarterYaw());
      }
      if (block.kind === 'park') {
        addProp('prop_tree_01', centerX - 1.5, centerZ - 1, quarterYaw());
        addProp('prop_tree_01', centerX + 2, centerZ + 1.5, quarterYaw());
      }
      addProp('prop_bench_01', centerX, centerZ - 3.5, 0);
      addProp('prop_bench_01', centerX, centerZ + 3.5, Math.PI);
      addProp('prop_bench_01', centerX - 3.5, centerZ, HALF_PI);
      addProp('prop_bench_01', centerX + 3.5, centerZ, -HALF_PI);
      addProp('prop_trashbin_01', centerX + 2.5, centerZ - 3.5, 0);
    }

    // Street furniture on the sidewalk ring; lamp arms point at the road.
    const edgeInset = 0.6;
    const edges = [
      (along: number) => ({ x: centerX + along, z: block.minZ + edgeInset, yaw: 0 }),
      (along: number) => ({ x: centerX - along, z: block.maxZ - edgeInset, yaw: Math.PI }),
      (along: number) => ({ x: block.minX + edgeInset, z: centerZ - along, yaw: HALF_PI }),
      (along: number) => ({ x: block.maxX - edgeInset, z: centerZ + along, yaw: -HALF_PI }),
    ];
    const busEvery = block.district === 'downtown' ? 3 : block.district === 'industrial' ? 4 : 5;
    edges.forEach((edge, edgeIndex) => {
      const hasBus = edgeIndex === 0 && (block.bx + block.bz) % busEvery === 0;
      const place = (id: PropPlacement['id'], along: number) => {
        const spot = edge(along);
        addProp(id, spot.x, spot.z, spot.yaw);
      };
      if (hasBus) place('prop_busstop_01', 0);
      // Bangku menempel ke sisi kavling dan menghadap jalan, jadi sisa trotoar = lebar - kedalaman bangku.
      const bench = (along: number) => {
        const spot = edge(along);
        const back = SIDEWALK_WIDTH - edgeInset - PROP_COLLIDERS[STREET_BENCH].size[2] / 2;
        streetBenches.push({ id: STREET_BENCH, x: spot.x + Math.sin(spot.yaw) * back, y: 0, z: spot.z + Math.cos(spot.yaw) * back, yaw: spot.yaw });
      };
      // Semua posisi |along| + 0.8 <= 6, jadi tidak ada bangku di 6 m terakhir sebelum persimpangan.
      // Pusat Kota: 2 per sisi; sisi dengan halte tidak muat (halte sudah punya tempat duduk).
      if (block.district === 'downtown' && !hasBus) {
        bench(-2.5);
        bench(2.5);
      }
      if (block.district === 'residential' || (block.district === 'industrial' && hasBus)) bench(-4.5);
      if (block.district !== 'residential') {
        // Industri: lampu kiri halte digeser keluar supaya bangku dekat halte tetap 1.5 m dari lampu.
        place('prop_streetlamp_01', block.district === 'industrial' && hasBus ? -9 : -6);
        place('prop_streetlamp_01', 6);
        if (random() < 0.5) place('prop_trashbin_01', 8.5);
      } else {
        place('prop_streetlamp_01', -8);
        if (!hasBus) place('prop_tree_01', -2.5);
        place('prop_tree_01', 4.5);
        if (random() < 0.4) place('prop_trashbin_01', 9.5);
      }
    });
  }

  // Keep NPC spots and the player spawn clear, and never let props intersect buildings.
  const npcBoxes = NPCS.map((npc) => ({
    minX: npc.x - NPC_HALF_SIZE,
    maxX: npc.x + NPC_HALF_SIZE,
    minZ: npc.z - NPC_HALF_SIZE,
    maxZ: npc.z + NPC_HALF_SIZE,
  }));
  const keepClear = npcBoxes.map((box) => expand(box, 1));
  props = props.filter((prop) => {
    const box = propCollider(prop);
    return !keepClear.some((zone) => overlaps(zone, box)) && !buildings.some((building) => overlaps(building, box));
  });
  // Bangku pinggir jalan dicek terakhir: tidak menimpa prop lain dan berjarak dari perabot jalan.
  for (const bench of streetBenches) {
    const box = propCollider(bench);
    const clash = props.some((prop) => overlaps(BENCH_CLEAR_OF.includes(prop.id) ? expand(propCollider(prop), BENCH_CLEARANCE) : propCollider(prop), box));
    if (!clash && !keepClear.some((zone) => overlaps(zone, box)) && !buildings.some((building) => overlaps(building, box))) props.push(bench);
  }

  for (const prop of props) {
    prop.y = Math.round(ground(prop.x, prop.z) * 100) / 100;
    const chunk = chunkAt(prop.x, prop.z);
    chunk.props.push(prop);
    chunk.colliders.push(propCollider(prop));
    if (!BENCH_IDS.includes(prop.id)) continue;
    // Titik duduk: offset lokal X diputar yaw (sama seperti propCollider), menghadap depan bangku.
    for (const offset of SEAT_OFFSETS_X) {
      const round2 = (value: number) => Math.round(value * 100) / 100;
      chunk.seats.push({
        id: `seat_${chunk.cx}_${chunk.cz}_${chunk.seats.length}`,
        x: round2(prop.x + Math.cos(prop.yaw) * offset),
        y: round2(prop.y + SEAT_HEIGHT),
        z: round2(prop.z - Math.sin(prop.yaw) * offset),
        yaw: Math.round(prop.yaw * 1e4) / 1e4,
      });
    }
  }
  for (const building of buildings) {
    const chunk = chunkAt((building.minX + building.maxX) / 2, (building.minZ + building.maxZ) / 2);
    chunk.buildings.push(building);
    chunk.colliders.push({ minX: building.minX, maxX: building.maxX, minZ: building.minZ, maxZ: building.maxZ });
  }
  NPCS.forEach((npc, index) => {
    const box = npcBoxes[index];
    if (box) chunkAt(npc.x, npc.z).colliders.push(box);
  });

  const index: WorldIndex = {
    version: WORLD_DATA_VERSION,
    chunkSize: CHUNK_SIZE,
    worldChunks: WORLD_CHUNKS,
    gridStep: GRID_STEP,
    spawn: { x: 0, z: 0 },
    npcs: NPCS,
    busStops: props
      .filter((prop) => prop.id === 'prop_busstop_01')
      .map((prop, stopIndex) => ({
        id: `bus_${stopIndex}`,
        district: districtOf(chunkCoordOf(prop.x), chunkCoordOf(prop.z)),
        // Waiting spot on the road side of the shelter (shelters face -Z).
        x: prop.x,
        z: Math.round((prop.z - BUS_WAIT_OFFSET) * 100) / 100,
      })),
    seats: chunks.flatMap((chunk) => chunk.seats),
    chunks: chunks.map((chunk) => ({
      cx: chunk.cx,
      cz: chunk.cz,
      district: chunk.district,
      file: `chunks/${chunkKey(chunk.cx, chunk.cz)}.json`,
    })),
    navmesh: 'navmesh.bin',
    map: { file: 'map.png', pixelsPerMeter: 2 },
  };
  return { index, chunks };
}
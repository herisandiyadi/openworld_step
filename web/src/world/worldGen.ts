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
  type WorldDistrictId,
  GRID_CELLS,
  GRID_STEP,
  GRID_VERTS,
  HALF_WORLD,
  LEGACY_CHUNK_OFFSET,
  LEGACY_HALF_WORLD,
  LEGACY_WORLD_CHUNKS,
  type FishingSpot,
  type FishStallPoint,
  type TrashBinPoint,
  type WaterBounds,
  type BusRoute,
  type DistrictMeta,
  WORLD_DISTRICT_NAMES,
  type NpcSpawn,
  type PropPlacement,
  propCollider,
  ROAD_WIDTH,
  SIDEWALK_WIDTH,
  SURFACE,
  WORLD_CHUNKS,
  WORLD_DATA_VERSION,
  WORLD_SIZE,
  LOAD_RADIUS,
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

type BlockKind = 'towers' | 'plaza' | 'houses' | 'park' | 'warehouses' | 'harbor' | 'lake';

interface Block extends Aabb {
  bx: number;
  bz: number;
  district: WorldDistrictId;
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

/**
 * Lake block: chosen once in the city_park district, adjacent to a park block.
 * cx/cz in chunk coords, bx/bz in block coords.
 */
/**  Fishing spots: 1 per 6 m along the perimeter. */
function makeFishingSpots(lakeBlocks: Block[], spotIdStart: number): FishingSpot[] {
  const spots: FishingSpot[] = [];
  let sid = spotIdStart;
  for (const block of lakeBlocks) {
    const cx = (block.minX + block.maxX) / 2;
    const cz = (block.minZ + block.maxZ) / 2;
    const halfW = (block.maxX - block.minX) / 2 - 2;
    const halfH = (block.maxZ - block.minZ) / 2 - 2;
    const step = 6;
    // North edge (z = minZ + 2)
    for (let x = block.minX + 2; x <= block.maxX - 2; x += step) {
      spots.push({ id: `fish_${sid++}`, x: Math.round(x * 100) / 100, z: Math.round((cz - halfH) * 100) / 100, yaw: Math.PI, water: 'lake' });
    }
    // South edge
    for (let x = block.minX + 2; x <= block.maxX - 2; x += step) {
      spots.push({ id: `fish_${sid++}`, x: Math.round(x * 100) / 100, z: Math.round((cz + halfH) * 100) / 100, yaw: 0, water: 'lake' });
    }
    // West edge
    for (let z = block.minZ + 2; z <= block.maxZ - 2; z += step) {
      spots.push({ id: `fish_${sid++}`, x: Math.round((cx - halfW) * 100) / 100, z: Math.round(z * 100) / 100, yaw: HALF_PI, water: 'lake' });
    }
    // East edge
    for (let z = block.minZ + 2; z <= block.maxZ - 2; z += step) {
      spots.push({ id: `fish_${sid++}`, x: Math.round((cx + halfW) * 100) / 100, z: Math.round(z * 100) / 100, yaw: -HALF_PI, water: 'lake' });
    }
  }
  return spots;
}

/** Sea fishing spots at the harbor — scattered along south edge of harbor blocks. */
function makeSeaFishingSpots(harborBlocks: Block[], spotIdStart: number): FishingSpot[] {
  const spots: FishingSpot[] = [];
  let sid = spotIdStart;
  for (const block of harborBlocks.slice(0, 2)) {
    const cx = (block.minX + block.maxX) / 2;
    const step = 8;
    for (let x = block.minX + 2; x <= block.maxX - 2; x += step) {
      spots.push({ id: `fish_sea_${sid++}`, x: Math.round(x * 100) / 100, z: Math.round((block.maxZ - 2) * 100) / 100, yaw: 0, water: 'sea' });
    }
    void cx;
  }
  return spots;
}

/** One trash bin every ~25 m along the outer ring streets (simple grid placement). */
function makeOuterTrashBins(outerBlocks: Block[], binIdStart: number): TrashBinPoint[] {
  const bins: TrashBinPoint[] = [];
  let bid = binIdStart;
  for (const block of outerBlocks) {
    const cx = (block.minX + block.maxX) / 2;
    const cz = (block.minZ + block.maxZ) / 2;
    bins.push({ id: `bin_outer_${bid++}`, x: Math.round((cx + 3) * 100) / 100, z: Math.round((block.minZ + 1) * 100) / 100 });
    bins.push({ id: `bin_outer_${bid++}`, x: Math.round((cx - 3) * 100) / 100, z: Math.round((block.maxZ - 1) * 100) / 100 });
    void cz;
  }
  return bins;
}

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
  // The original central 512 m keeps its old height profile; only the new outer ring uses the wider scale.
  const inLegacy = Math.abs(x) <= LEGACY_HALF_WORLD && Math.abs(z) <= LEGACY_HALF_WORLD;
  const ring = Math.max(Math.abs(x), Math.abs(z)) / (inLegacy ? LEGACY_HALF_WORLD : HALF_WORLD);
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
  const legacyBlockStart = LEGACY_CHUNK_OFFSET * (CHUNK_SIZE / BLOCK_PITCH);
  const legacyBlockEnd = legacyBlockStart + LEGACY_WORLD_CHUNKS * (CHUNK_SIZE / BLOCK_PITCH);
  // Fixed 2x2-block lake in the outer city-park district, directly beside park blocks.
  const lakeMinBx = 2;
  const lakeMinBz = legacyBlockStart - 2;
  for (let bz = 0; bz < BLOCKS_PER_SIDE; bz++) {
    for (let bx = 0; bx < BLOCKS_PER_SIDE; bx++) {
      const district = districtOf(Math.floor((bx * BLOCK_PITCH) / CHUNK_SIZE), Math.floor((bz * BLOCK_PITCH) / CHUNK_SIZE));
      const roll = random();
      const isLake = bx >= lakeMinBx && bx < lakeMinBx + 2 && bz >= lakeMinBz && bz < lakeMinBz + 2;
      const inLegacy = bx >= legacyBlockStart && bx < legacyBlockEnd && bz >= legacyBlockStart && bz < legacyBlockEnd;
      let kind: BlockKind;
      if (isLake) kind = 'lake';
      else if (inLegacy) {
        // Preserve the old deterministic generator exactly: old RNG was consumed in local 8x8 order.
        // Outer blocks are generated around it, but their random sequence does not affect legacy coordinates.
        const legacyBx = bx - legacyBlockStart;
        const legacyBz = bz - legacyBlockStart;
        const oldRandom = mulberry32(seed ^ 0x5bd1e995);
        let oldRoll = 0;
        const oldBlocksPerSide = LEGACY_WORLD_CHUNKS * (CHUNK_SIZE / BLOCK_PITCH);
        for (let n = 0; n <= legacyBz * oldBlocksPerSide + legacyBx; n++) oldRoll = oldRandom();
        if (district === 'downtown') kind = oldRoll < 0.18 ? 'plaza' : 'towers';
        else if (district === 'industrial') kind = oldRoll < 0.15 ? 'park' : 'warehouses';
        else kind = oldRoll < 0.2 ? 'park' : 'houses';
      } else if (district === 'harbor') kind = roll < 0.45 ? 'harbor' : roll < 0.65 ? 'park' : 'warehouses';
      else if (district === 'city_park') kind = roll < 0.65 ? 'park' : 'houses';
      else if (district === 'industrial') kind = roll < 0.15 ? 'park' : 'warehouses';
      else kind = roll < 0.2 ? 'park' : 'houses';
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
  if (kind === 'lake' || kind === 'harbor') return SURFACE.water;
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
    water: [],
    fishingSpots: [],
    trashBins: [],
    fishStalls: [],
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

    if (block.kind === 'lake' || block.kind === 'harbor') {
      // Water blocks are baked after props/buildings so they remain open and non-navigable.
      continue;
    }
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

  // Bake non-navigable water, interaction points and fish stalls into owning chunks.
  const lakeBlocks = blocks.filter((block) => block.kind === 'lake');
  const harborBlocks = blocks.filter((block) => block.kind === 'harbor');
  const waterBodies: WaterBounds[] = [];
  for (const block of lakeBlocks) {
    const bounds = { minX: block.minX, maxX: block.maxX, minZ: block.minZ, maxZ: block.maxZ };
    const water: WaterBounds = { id: 'lake_city_park', kind: 'lake', bounds, noNav: true, adjacentDistrict: 'city_park' };
    const chunk = chunkAt((block.minX + block.maxX) / 2, (block.minZ + block.maxZ) / 2);
    chunk.water.push(water);
    chunk.colliders.push(bounds);
    waterBodies.push(water);
  }
  for (const block of harborBlocks.slice(0, 2)) {
    const bounds = { minX: block.minX, maxX: block.maxX, minZ: block.minZ, maxZ: block.maxZ };
    const water: WaterBounds = { id: 'sea_harbor', kind: 'sea', bounds, noNav: true };
    const chunk = chunkAt((block.minX + block.maxX) / 2, (block.minZ + block.maxZ) / 2);
    chunk.water.push(water);
    chunk.colliders.push(bounds);
    waterBodies.push(water);
  }
  const fishingSpots = [...makeFishingSpots(lakeBlocks, 0), ...makeSeaFishingSpots(harborBlocks, 0)];
  for (const spot of fishingSpots) chunkAt(spot.x, spot.z).fishingSpots.push(spot);
  const outerBlocks = blocks.filter((block) =>
    block.bx < LEGACY_CHUNK_OFFSET * 2 || block.bx >= (LEGACY_CHUNK_OFFSET + LEGACY_WORLD_CHUNKS) * 2 ||
    block.bz < LEGACY_CHUNK_OFFSET * 2 || block.bz >= (LEGACY_CHUNK_OFFSET + LEGACY_WORLD_CHUNKS) * 2,
  );
  const trashBins = makeOuterTrashBins(outerBlocks.filter((block) => block.kind !== 'lake' && block.kind !== 'harbor'), 0);
  for (const prop of props.filter((entry) => entry.id === 'prop_trashbin_01')) {
    trashBins.push({ id: `bin_${trashBins.length}`, x: prop.x, z: prop.z });
  }
  for (const bin of trashBins) chunkAt(bin.x, bin.z).trashBins.push(bin);
  const lake = lakeBlocks[0];
  const harbor = harborBlocks[0];
  const fishStalls: FishStallPoint[] = [];
  if (lake) fishStalls.push({ id: 'fish_stall_lake', x: lake.maxX + 2, z: (lake.minZ + lake.maxZ) / 2, water: 'lake' });
  if (harbor) fishStalls.push({ id: 'fish_stall_harbor', x: harbor.minX + 2, z: harbor.minZ - 2, water: 'sea' });
  for (const stall of fishStalls) chunkAt(stall.x, stall.z).fishStalls.push(stall);

  const districtMetas: DistrictMeta[] = (Object.entries(WORLD_DISTRICT_NAMES) as [WorldDistrictId, string][]).map(([id, name]) => ({ id, name }));
  const busRoutes: BusRoute[] = [
    { id: 'route_industrial', districts: ['downtown', 'industrial'], stops: [] },
    { id: 'route_harbor', districts: ['downtown', 'harbor'], stops: [] },
    { id: 'route_city_park', districts: ['downtown', 'city_park'], stops: [] },
  ];

  const index: WorldIndex = {
    version: WORLD_DATA_VERSION,
    worldVersion: '3.0.0-u4-fishing',
    chunkSize: CHUNK_SIZE,
    worldChunks: WORLD_CHUNKS,
    worldSize: WORLD_SIZE,
    gridStep: GRID_STEP,
    bounds: { minX: -HALF_WORLD, maxX: HALF_WORLD, minZ: -HALF_WORLD, maxZ: HALF_WORLD },
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
      navmesh: `navmesh/${chunkKey(chunk.cx, chunk.cz)}.bin`,
    })),
    waterBodies,
    busRoutes,
    districts: districtMetas,
    navmesh: {
      format: 'recast-tile-v1',
      directory: 'navmesh',
      pattern: '{cx}_{cz}.bin',
      loadRadius: LOAD_RADIUS,
    },
    map: { file: 'map.png', pixelsPerMeter: 1, width: WORLD_SIZE, height: WORLD_SIZE },
    exploration: { version: 2, cellSize: 8, width: WORLD_SIZE / 8, height: WORLD_SIZE / 8, originX: -HALF_WORLD, originZ: -HALF_WORLD },
    legacy: {
      chunkOffset: { x: LEGACY_CHUNK_OFFSET, z: LEGACY_CHUNK_OFFSET },
      worldChunks: LEGACY_WORLD_CHUNKS,
      bounds: { minX: -LEGACY_HALF_WORLD, maxX: LEGACY_HALF_WORLD, minZ: -LEGACY_HALF_WORLD, maxZ: LEGACY_HALF_WORLD },
    },
  };
  return { index, chunks };
}
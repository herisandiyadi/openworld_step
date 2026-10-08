import type { Aabb } from '../game/movement';
import { PROP_COLLIDERS, type PropId } from './propSpec';

/**
 * Data contract shared by the offline world generator (tools/world) and the runtime streamer.
 * Units: metres, +Y up. The world is a square grid of chunks centred on the origin.
 */
export const WORLD_DATA_VERSION = 3;
export const CHUNK_SIZE = 64;
/** Built-in world dimensions. Runtime helpers are configured from public/world/index.json. */
export const WORLD_CHUNKS = 16;
export const WORLD_SIZE = CHUNK_SIZE * WORLD_CHUNKS;
export const HALF_WORLD = WORLD_SIZE / 2;
export const LEGACY_WORLD_CHUNKS = 8;
export const LEGACY_HALF_WORLD = (LEGACY_WORLD_CHUNKS * CHUNK_SIZE) / 2;
export const LEGACY_CHUNK_OFFSET = (WORLD_CHUNKS - LEGACY_WORLD_CHUNKS) / 2;

export interface WorldDimensions {
  chunkSize: number;
  worldChunks: number;
}

let runtimeDimensions: WorldDimensions = { chunkSize: CHUNK_SIZE, worldChunks: WORLD_CHUNKS };
export const configureWorldDimensions = (dimensions: WorldDimensions): void => {
  if (!Number.isInteger(dimensions.worldChunks) || dimensions.worldChunks <= 0 || dimensions.chunkSize <= 0) {
    throw new Error('invalid world dimensions');
  }
  runtimeDimensions = { ...dimensions };
};
export const getWorldDimensions = (): WorldDimensions => ({ ...runtimeDimensions });
export const worldSizeFor = (dimensions = runtimeDimensions): number => dimensions.chunkSize * dimensions.worldChunks;
export const halfWorldFor = (dimensions = runtimeDimensions): number => worldSizeFor(dimensions) / 2;
/** Terrain heightmap resolution: one vertex every GRID_STEP metres. */
export const GRID_STEP = 2;
export const GRID_CELLS = CHUNK_SIZE / GRID_STEP;
export const GRID_VERTS = GRID_CELLS + 1;
export const BLOCK_PITCH = 32;
export const ROAD_WIDTH = 8;
export const SIDEWALK_WIDTH = 2;
/** Blocks (sidewalks, lots) sit this much above the road surface. */
export const SIDEWALK_RAISE = 0.15;
/** Chunks within this Chebyshev distance of the player's chunk are loaded... */
export const LOAD_RADIUS = 2;
/** ...and chunks beyond this distance are unloaded (hysteresis avoids thrashing at borders). */
export const UNLOAD_RADIUS = 3;

export type DistrictId = 'downtown' | 'residential' | 'industrial';
export type OuterDistrictId = 'harbor' | 'city_park';
export type WorldDistrictId = DistrictId | OuterDistrictId;
/** Map outer districts onto existing ambient-simulation profiles. */
export const legacyDistrict = (district: WorldDistrictId): DistrictId =>
  district === 'harbor' ? 'industrial' : district === 'city_park' ? 'residential' : district;

export const DISTRICT_NAMES: Record<DistrictId, string> = {
  downtown: 'Pusat Kota',
  residential: 'Perumahan',
  industrial: 'Kawasan Industri',
};

export const WORLD_DISTRICT_NAMES: Record<WorldDistrictId, string> = {
  ...DISTRICT_NAMES,
  harbor: 'Pelabuhan/Pantai',
  city_park: 'Taman Kota',
};

export const SURFACE = { grass: 0, road: 1, sidewalk: 2, plaza: 3, water: 4 } as const;
export type SurfaceId = (typeof SURFACE)[keyof typeof SURFACE];

/** Shared by the terrain mesh (vertex colours) and the baked map image. */
export const SURFACE_COLORS: Record<SurfaceId, string> = {
  [SURFACE.grass]: '#8fb27a',
  [SURFACE.road]: '#4a4f57',
  [SURFACE.sidewalk]: '#c8c6c0',
  [SURFACE.plaza]: '#b5aea2',
  [SURFACE.water]: '#3c8db8',
};

export const WORLD_BOUNDS: Aabb = { minX: -HALF_WORLD, maxX: HALF_WORLD, minZ: -HALF_WORLD, maxZ: HALF_WORLD };

export interface Building extends Aabb {
  /** Bottom of the box (sunk slightly below the lowest ground point under the footprint). */
  baseY: number;
  topY: number;
  color: string;
}

export interface PropPlacement {
  id: PropId;
  x: number;
  y: number;
  z: number;
  /** Yaw in radians, quarter turns only (keeps colliders axis-aligned). */
  yaw: number;
}

export interface NpcSpawn {
  id: string;
  asset: 'npc_vendor';
  name: string;
  x: number;
  z: number;
  yaw: number;
}

/** Titik duduk bangku (dibake oleh worldGen). yaw = arah hadap karakter yang duduk, konvensi sama dengan heading. */
export interface SeatPoint {
  id: string;
  x: number;
  /** Tinggi dudukan (tanah + 0.45 m). */
  y: number;
  z: number;
  yaw: number;
}

/** Fast-travel stop (a bus shelter); the player is placed at (x, z). */
export interface BusStop {
  id: string;
  district: WorldDistrictId;
  x: number;
  z: number;
}

export interface FishingSpot {
  id: string;
  x: number;
  z: number;
  yaw: number;
  water: 'lake' | 'sea';
}

export interface TrashBinPoint {
  id: string;
  x: number;
  z: number;
}

export interface FishStallPoint {
  id: string;
  x: number;
  z: number;
  water: 'lake' | 'sea';
}

export interface WaterBounds {
  id: string;
  kind: 'lake' | 'sea';
  bounds: Aabb;
  noNav: true;
  adjacentDistrict?: WorldDistrictId;
}

export interface BusRoute {
  id: string;
  districts: WorldDistrictId[];
  stops: string[];
}

export interface DistrictMeta {
  id: WorldDistrictId;
  name: string;
}

/** One file per chunk: public/world/chunks/<cx>_<cz>.json */
export interface ChunkData {
  version: number;
  cx: number;
  cz: number;
  district: WorldDistrictId;
  /** GRID_VERTS x GRID_VERTS heights in centimetres, row-major (z rows, x columns). */
  heights: number[];
  /** GRID_CELLS x GRID_CELLS surface ids, row-major. */
  surface: number[];
  buildings: Building[];
  props: PropPlacement[];
  /** Collision footprints (buildings, props, NPCs); visual meshes are never used for collision. */
  colliders: Aabb[];
  /** Titik duduk semua bangku di chunk ini (sejak versi 2). */
  seats: SeatPoint[];
  /** Non-walkable water planes and their blocking footprint. */
  water: WaterBounds[];
  fishingSpots: FishingSpot[];
  trashBins: TrashBinPoint[];
  fishStalls: FishStallPoint[];
}

export interface ChunkEntry {
  cx: number;
  cz: number;
  district: WorldDistrictId;
  file: string;
  navmesh: string;
}

/** public/world/index.json */
export interface WorldIndex {
  version: number;
  worldVersion: string;
  chunkSize: number;
  worldChunks: number;
  worldSize: number;
  gridStep: number;
  bounds: Aabb;
  spawn: { x: number; z: number };
  npcs: NpcSpawn[];
  busStops: BusStop[];
  busRoutes: BusRoute[];
  districts: DistrictMeta[];
  /**
   * Salinan datar titik duduk semua chunk untuk Proximity (index sudah dimuat di worldState).
   * ponytail: chunkWorker belum meneruskan `ChunkData.seats`; pindahkan ke ChunkRecord kalau index jadi terlalu besar.
   */
  seats: SeatPoint[];
  chunks: ChunkEntry[];
  waterBodies: WaterBounds[];
  navmesh: {
    format: 'recast-tile-v1';
    directory: string;
    pattern: string;
    loadRadius: number;
  };
  map: { file: string; pixelsPerMeter: number; width: number; height: number };
  exploration: { version: number; cellSize: number; width: number; height: number; originX: number; originZ: number };
  /** Legacy: bounds of the original 8x8 world that lives in the centre. */
  legacy: {
    chunkOffset: { x: number; z: number };
    worldChunks: number;
    bounds: Aabb;
  };
}

export const chunkKey = (cx: number, cz: number): string => `${cx}_${cz}`;
/** Chunk index containing a world coordinate in the built-in world grid. */
export const chunkCoord = (value: number): number =>
  Math.min(WORLD_CHUNKS - 1, Math.max(0, Math.floor((value + HALF_WORLD) / CHUNK_SIZE)));
export const chunkOrigin = (index: number): number => -HALF_WORLD + index * CHUNK_SIZE;
export const inWorld = (cx: number, cz: number): boolean => cx >= 0 && cz >= 0 && cx < WORLD_CHUNKS && cz < WORLD_CHUNKS;
/** Data-driven variants for callers that load a different index at runtime. */
export const chunkCoordFor = (value: number, dimensions: WorldDimensions): number =>
  Math.min(dimensions.worldChunks - 1, Math.max(0, Math.floor((value + halfWorldFor(dimensions)) / dimensions.chunkSize)));
export const chunkOriginFor = (index: number, dimensions: WorldDimensions): number => -halfWorldFor(dimensions) + index * dimensions.chunkSize;
export const inWorldFor = (cx: number, cz: number, dimensions: WorldDimensions): boolean =>
  cx >= 0 && cz >= 0 && cx < dimensions.worldChunks && cz < dimensions.worldChunks;

/**
 * Original 8×8 district formula, kept for data baked before the 16×16 expansion (e.g. residents.json).
 * Coordinates are the legacy 8×8 grid indices (0..7).
 */
export function legacyDistrictOf(cx: number, cz: number): DistrictId {
  const inner = (index: number) => index >= 2 && index <= LEGACY_WORLD_CHUNKS - 3;
  if (inner(cx) && inner(cz)) return 'downtown';
  return cx >= LEGACY_WORLD_CHUNKS - 2 ? 'industrial' : 'residential';
}

/**
 * Central 8×8 legacy chunks become downtown/residential/industrial (matching old districtOf at cx-4, cz-4).
 * The outer ring (4 chunks wide) gets the three new districts based on position.
 */
export function districtOf(cx: number, cz: number): WorldDistrictId {
  const inLegacy = cx >= LEGACY_CHUNK_OFFSET && cx < LEGACY_CHUNK_OFFSET + LEGACY_WORLD_CHUNKS &&
    cz >= LEGACY_CHUNK_OFFSET && cz < LEGACY_CHUNK_OFFSET + LEGACY_WORLD_CHUNKS;
  if (inLegacy) {
    const lx = cx - LEGACY_CHUNK_OFFSET;
    const lz = cz - LEGACY_CHUNK_OFFSET;
    const inner = (index: number) => index >= 2 && index <= LEGACY_WORLD_CHUNKS - 3;
    if (inner(lx) && inner(lz)) return 'downtown';
    return lx >= LEGACY_WORLD_CHUNKS - 2 ? 'industrial' : 'residential';
  }
  // Outer ring: harbor on south/east, city_park on north/west, industrial on far east strip
  if (cx >= WORLD_CHUNKS - 4) return 'industrial';
  if (cz >= WORLD_CHUNKS - 4) return 'harbor';
  return 'city_park';
}

/**
 * Height of the chunk's triangulated heightmap at (x, z). Each cell is split along the
 * (i, j) -> (i+1, j+1) diagonal, matching the terrain mesh so feet and props sit on the surface.
 */
export function sampleChunkHeight(chunk: { cx: number; cz: number; heights: ArrayLike<number> }, x: number, z: number): number {
  const gx = Math.min(Math.max((x - chunkOrigin(chunk.cx)) / GRID_STEP, 0), GRID_CELLS);
  const gz = Math.min(Math.max((z - chunkOrigin(chunk.cz)) / GRID_STEP, 0), GRID_CELLS);
  const i = Math.min(Math.floor(gx), GRID_CELLS - 1);
  const j = Math.min(Math.floor(gz), GRID_CELLS - 1);
  const fx = gx - i;
  const fz = gz - j;
  const at = (di: number, dj: number) => (chunk.heights[(j + dj) * GRID_VERTS + i + di] ?? 0) / 100;
  const h00 = at(0, 0);
  const h11 = at(1, 1);
  if (fx >= fz) return h00 + fx * (at(1, 0) - h00) + fz * (h11 - at(1, 0));
  return h00 + fz * (at(0, 1) - h00) + fx * (h11 - at(0, 1));
}
const HALF_PI = Math.PI / 2;

/** World-space collider footprint of a placed prop (quarter-turn yaw only). */
export function propCollider(placement: PropPlacement): Aabb {
  const collider = PROP_COLLIDERS[placement.id];
  const quarter = ((Math.round(placement.yaw / HALF_PI) % 4) + 4) % 4;
  const cos = [1, 0, -1, 0][quarter] ?? 1;
  const sin = [0, 1, 0, -1][quarter] ?? 0;
  const [cx0, , cz0] = collider.center;
  const cx = cx0 * cos + cz0 * sin;
  const cz = -cx0 * sin + cz0 * cos;
  const sizeX = cos !== 0 ? collider.size[0] : collider.size[2];
  const sizeZ = cos !== 0 ? collider.size[2] : collider.size[0];
  return {
    minX: placement.x + cx - sizeX / 2,
    maxX: placement.x + cx + sizeX / 2,
    minZ: placement.z + cz - sizeZ / 2,
    maxZ: placement.z + cz + sizeZ / 2,
  };
}
/** Minimal chunk view needed for ground queries (both raw JSON and runtime typed arrays fit). */
export interface ChunkGround {
  cx: number;
  cz: number;
  heights: ArrayLike<number>;
  surface: ArrayLike<number>;
}

export const isRaisedSurface = (surface: number): boolean => surface !== SURFACE.road && surface !== SURFACE.water;

const cellIndex = (value: number, origin: number): number =>
  Math.min(GRID_CELLS - 1, Math.max(0, Math.floor((value - origin) / GRID_STEP)));

export function surfaceAt(chunk: ChunkGround, x: number, z: number): number {
  const i = cellIndex(x, chunkOrigin(chunk.cx));
  const j = cellIndex(z, chunkOrigin(chunk.cz));
  return chunk.surface[j * GRID_CELLS + i] ?? SURFACE.road;
}

/** Walkable surface height: terrain plus the block raise. Matches the rendered terrain mesh. */
export function chunkGroundHeight(chunk: ChunkGround, x: number, z: number): number {
  return sampleChunkHeight(chunk, x, z) + (isRaisedSurface(surfaceAt(chunk, x, z)) ? SIDEWALK_RAISE : 0);
}
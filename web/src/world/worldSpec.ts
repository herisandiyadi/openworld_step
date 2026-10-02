import type { Aabb } from '../game/movement';
import { PROP_COLLIDERS, type PropId } from './propSpec';

/**
 * Data contract shared by the offline world generator (tools/world) and the runtime streamer.
 * Units: metres, +Y up. The world is a square grid of chunks centred on the origin.
 */
export const WORLD_DATA_VERSION = 2;
export const CHUNK_SIZE = 64;
export const WORLD_CHUNKS = 8;
export const WORLD_SIZE = CHUNK_SIZE * WORLD_CHUNKS;
export const HALF_WORLD = WORLD_SIZE / 2;
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

export const DISTRICT_NAMES: Record<DistrictId, string> = {
  downtown: 'Pusat Kota',
  residential: 'Perumahan',
  industrial: 'Kawasan Industri',
};

export const SURFACE = { grass: 0, road: 1, sidewalk: 2, plaza: 3 } as const;
export type SurfaceId = (typeof SURFACE)[keyof typeof SURFACE];

/** Shared by the terrain mesh (vertex colours) and the baked map image. */
export const SURFACE_COLORS: Record<SurfaceId, string> = {
  [SURFACE.grass]: '#8fb27a',
  [SURFACE.road]: '#4a4f57',
  [SURFACE.sidewalk]: '#c8c6c0',
  [SURFACE.plaza]: '#b5aea2',
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
  district: DistrictId;
  x: number;
  z: number;
}

/** One file per chunk: public/world/chunks/<cx>_<cz>.json */
export interface ChunkData {
  version: number;
  cx: number;
  cz: number;
  district: DistrictId;
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
}

export interface ChunkEntry {
  cx: number;
  cz: number;
  district: DistrictId;
  file: string;
}

/** public/world/index.json */
export interface WorldIndex {
  version: number;
  chunkSize: number;
  worldChunks: number;
  gridStep: number;
  spawn: { x: number; z: number };
  npcs: NpcSpawn[];
  busStops: BusStop[];
  /**
   * Salinan datar titik duduk semua chunk untuk Proximity (index sudah dimuat di worldState).
   * ponytail: chunkWorker belum meneruskan `ChunkData.seats`; pindahkan ke ChunkRecord kalau index jadi terlalu besar.
   */
  seats: SeatPoint[];
  chunks: ChunkEntry[];
  navmesh: string;
  map: { file: string; pixelsPerMeter: number };
}

export const chunkKey = (cx: number, cz: number): string => `${cx}_${cz}`;
/** Chunk index containing a world coordinate, clamped to the world grid. */
export const chunkCoord = (value: number): number =>
  Math.min(WORLD_CHUNKS - 1, Math.max(0, Math.floor((value + HALF_WORLD) / CHUNK_SIZE)));
export const chunkOrigin = (index: number): number => -HALF_WORLD + index * CHUNK_SIZE;
export const inWorld = (cx: number, cz: number): boolean => cx >= 0 && cz >= 0 && cx < WORLD_CHUNKS && cz < WORLD_CHUNKS;

/** Central 4x4 chunks are downtown; the two eastern columns are industrial; the rest is residential. */
export function districtOf(cx: number, cz: number): DistrictId {
  const inner = (index: number) => index >= 2 && index <= WORLD_CHUNKS - 3;
  if (inner(cx) && inner(cz)) return 'downtown';
  return cx >= WORLD_CHUNKS - 2 ? 'industrial' : 'residential';
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

export const isRaisedSurface = (surface: number): boolean => surface !== SURFACE.road;

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
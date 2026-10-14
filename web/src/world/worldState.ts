import type { Aabb, CollisionWorld } from '../game/movement';
import {
  chunkCoord,
  chunkGroundHeight,
  chunkKey,
  configureWorldDimensionsFromIndex,
  type FishingSpot,
  type FishStallPoint,
  type TrashBinPoint,
  type WorldDistrictId,
  WORLD_BOUNDS,
  type WorldIndex,
} from './worldSpec';

/** Gameplay-side data of a streamed chunk (no render objects; safe to serialise). */
export interface ChunkRecord {
  key: string;
  cx: number;
  cz: number;
  district: WorldDistrictId;
  heights: ArrayLike<number>;
  surface: ArrayLike<number>;
  fishingSpots: FishingSpot[];
  trashBins: TrashBinPoint[];
  fishStalls: FishStallPoint[];
  colliders: Aabb[];
}

/** Mutable world data shared by the streamer, movement, tap-to-move, NPCs, and the minimap. */
export const worldState: {
  index: WorldIndex | null;
  chunks: Map<string, ChunkRecord>;
  /** Colliders of the 3x3 chunks around the player, rebuilt when that set changes. */
  collision: CollisionWorld & { boxes: Aabb[] };
} = {
  index: null,
  chunks: new Map(),
  collision: { boxes: [], bounds: WORLD_BOUNDS },
};

export const chunkAt = (x: number, z: number): ChunkRecord | undefined =>
  worldState.chunks.get(chunkKey(chunkCoord(x), chunkCoord(z)));

/**
 * Linear scan of streamed chunks to find a fishing spot by id.
 * POIs live in `worldState.chunks[]`, not `worldState.index`.
 */
export function findStreamedFishingSpot(id: string): import('./worldSpec').FishingSpot | undefined {
  for (const chunk of worldState.chunks.values()) {
    const spot = chunk.fishingSpots.find((s) => s.id === id);
    if (spot) return spot;
  }
  return undefined;
}

/** Walkable ground height; 0 where the chunk is not streamed in (only happens far from the player). */
export function groundHeightAt(x: number, z: number): number {
  const chunk = chunkAt(x, z);
  return chunk ? chunkGroundHeight(chunk, x, z) : 0;
}

export function rebuildCollision(cx: number, cz: number): void {
  const boxes = worldState.collision.boxes;
  boxes.length = 0;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const chunk = worldState.chunks.get(chunkKey(cx + dx, cz + dz));
      if (chunk) for (const box of chunk.colliders) boxes.push(box);
    }
  }
}

/** Absolute URL of a baked world file (workers need absolute URLs). */
export const worldUrl = (path: string): string =>
  new URL(`${import.meta.env.BASE_URL}world/${path}`, document.baseURI).href;

let indexPromise: Promise<WorldIndex> | null = null;

/** Fetches public/world/index.json once; the promise is stable so React's use() can suspend on it. */
export function loadWorldIndex(): Promise<WorldIndex> {
  indexPromise ??= fetch(worldUrl('index.json'))
    .then((response) => {
      if (!response.ok) throw new Error(`world index: HTTP ${response.status}`);
      return response.json() as Promise<WorldIndex>;
    })
    .then((index) => {
      configureWorldDimensionsFromIndex(index);
      worldState.index = index;
      return index;
    });
  return indexPromise;
}
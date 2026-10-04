import { chunkKey, inWorld, LOAD_RADIUS, UNLOAD_RADIUS } from './worldSpec';
import type { StreamingPolicy } from '../optimization/streamingPolicy';

export interface ChunkCoord {
  cx: number;
  cz: number;
}

export interface StreamingPlan {
  /** Chunks to request, nearest first. */
  load: (ChunkCoord & { key: string })[];
  unload: string[];
}

const parseKey = (key: string): ChunkCoord => {
  const [cx, cz] = key.split('_').map(Number);
  return { cx: cx ?? 0, cz: cz ?? 0 };
};

export const chunkDistance = (a: ChunkCoord, b: ChunkCoord): number => Math.max(Math.abs(a.cx - b.cx), Math.abs(a.cz - b.cz));

/**
 * Load everything within LOAD_RADIUS (Chebyshev) of the centre chunk, unload beyond UNLOAD_RADIUS.
 * The gap between the two radii is hysteresis: walking back and forth over a border never thrashes.
 */
export function planStreaming(
  center: ChunkCoord,
  loaded: Iterable<string>,
  pending: ReadonlySet<string>,
  policy: Pick<StreamingPolicy, 'loadRadius' | 'unloadRadius'> = { loadRadius: LOAD_RADIUS, unloadRadius: UNLOAD_RADIUS },
): StreamingPlan {
  const loadedSet = new Set(loaded);
  const load: StreamingPlan['load'] = [];
  for (let dz = -policy.loadRadius; dz <= policy.loadRadius; dz++) {
    for (let dx = -policy.loadRadius; dx <= policy.loadRadius; dx++) {
      const cx = center.cx + dx;
      const cz = center.cz + dz;
      const key = chunkKey(cx, cz);
      if (!inWorld(cx, cz) || loadedSet.has(key) || pending.has(key)) continue;
      load.push({ cx, cz, key });
    }
  }
  const priority = (c: ChunkCoord) => chunkDistance(c, center) * 100 + Math.hypot(c.cx - center.cx, c.cz - center.cz);
  load.sort((a, b) => priority(a) - priority(b));
  const unload = [...loadedSet].filter((key) => chunkDistance(parseKey(key), center) > policy.unloadRadius);
  return { load, unload };
}

export const withinRadius = (key: string, center: ChunkCoord, radius: number): boolean =>
  chunkDistance(parseKey(key), center) <= radius;
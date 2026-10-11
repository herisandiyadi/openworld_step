import { importNavMesh, init, NavMeshQuery, type NavMesh } from 'recast-navigation';
import type { Vec2 } from '../game/movement';
import { groundHeightAt, worldUrl } from './worldState';
import { chunkCoord, chunkKey } from './worldSpec';

/**
 * Runtime pathfinding on per-chunk Recast navmeshes baked by tools/world.
 * ChunkStreamer calls loadNavigationTile/unloadNavigationTile with chunk lifecycle events.
 * Until the relevant tile is ready, tap-to-move falls back to a straight line.
 */
interface LoadedTile {
  navMesh: NavMesh;
  query: NavMeshQuery;
}

const tiles = new Map<string, LoadedTile>();
const pending = new Map<string, Promise<void>>();
let directory = 'navmesh';
let pattern = '{cx}_{cz}.bin';
let initPromise: Promise<void> | null = null;

const HALF_EXTENTS = { x: 2, y: 2, z: 2 };

const ensureInit = (): Promise<void> => (initPromise ??= init());

/** Configures the tile source. Actual files are fetched with their chunks. */
export async function loadNavigation(navDirectory: string, filePattern: string, _loadRadius: number): Promise<void> {
  directory = navDirectory;
  pattern = filePattern;
  await ensureInit();
}

const tileFile = (cx: number, cz: number): string =>
  `${directory}/${pattern.replace('{cx}', String(cx)).replace('{cz}', String(cz))}`;

/** Loads one independent navmesh tile; duplicate/in-flight requests are coalesced. */
export function loadNavigationTile(cx: number, cz: number): Promise<void> {
  const key = chunkKey(cx, cz);
  if (tiles.has(key)) return Promise.resolve();
  const existing = pending.get(key);
  if (existing) return existing;
  const request = (async () => {
    await ensureInit();
    const response = await fetch(worldUrl(tileFile(cx, cz)));
    if (!response.ok) throw new Error(`navmesh tile ${key}: HTTP ${response.status}`);
    const { navMesh } = importNavMesh(new Uint8Array(await response.arrayBuffer()));
    tiles.set(key, { navMesh, query: new NavMeshQuery(navMesh) });
  })().finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}

/** Destroys the tile query/data when its visual chunk is unloaded. */
export function unloadNavigationTile(cx: number, cz: number): void {
  const key = chunkKey(cx, cz);
  const tile = tiles.get(key);
  if (!tile) return;
  tile.query.destroy();
  tile.navMesh.destroy();
  tiles.delete(key);
}

export const navigationReady = (): boolean => tiles.size > 0;
export const loadedNavigationTiles = (): ReadonlySet<string> => new Set(tiles.keys());

/** Waypoints from `from` to `to` when both points are in the same loaded tile. */
export function findPath(from: Vec2, to: Vec2): Vec2[] | null {
  const fromKey = chunkKey(chunkCoord(from.x), chunkCoord(from.z));
  if (fromKey !== chunkKey(chunkCoord(to.x), chunkCoord(to.z))) return null;
  const tile = tiles.get(fromKey);
  if (!tile) return null;
  const result = tile.query.computePath(
    { x: from.x, y: groundHeightAt(from.x, from.z), z: from.z },
    { x: to.x, y: groundHeightAt(to.x, to.z), z: to.z },
    { halfExtents: HALF_EXTENTS, maxPathPolys: 1024 },
  );
  if (!result.success || result.path.length < 2) return null;
  return result.path.slice(1).map((point) => ({ x: point.x, z: point.z }));
}

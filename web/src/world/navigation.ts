import { importNavMesh, init, NavMeshQuery } from 'recast-navigation';
import type { Vec2 } from '../game/movement';
import { groundHeightAt, worldUrl } from './worldState';

/**
 * Runtime pathfinding on the navmesh baked by tools/world (Recast/Detour, WASM).
 * Until it is ready, tap-to-move falls back to a straight line.
 */
let query: NavMeshQuery | null = null;
let loading: Promise<void> | null = null;

const HALF_EXTENTS = { x: 2, y: 2, z: 2 };

export function loadNavigation(file: string): Promise<void> {
  loading ??= (async () => {
    await init();
    const response = await fetch(worldUrl(file));
    if (!response.ok) throw new Error(`navmesh: HTTP ${response.status}`);
    const { navMesh } = importNavMesh(new Uint8Array(await response.arrayBuffer()));
    query = new NavMeshQuery(navMesh);
  })();
  return loading;
}

export const navigationReady = (): boolean => query !== null;

/** Waypoints from `from` to `to` (excluding the start), or null when no path exists or navmesh isn't loaded. */
export function findPath(from: Vec2, to: Vec2): Vec2[] | null {
  if (!query) return null;
  const result = query.computePath(
    { x: from.x, y: groundHeightAt(from.x, from.z), z: from.z },
    { x: to.x, y: groundHeightAt(to.x, to.z), z: to.z },
    { halfExtents: HALF_EXTENTS, maxPathPolys: 1024 },
  );
  if (!result.success || result.path.length < 2) return null;
  return result.path.slice(1).map((point) => ({ x: point.x, z: point.z }));
}
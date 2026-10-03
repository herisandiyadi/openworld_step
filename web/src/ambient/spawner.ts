/**
 * Cincin spawn/despawn dan object pool per preset grafis. Murni TypeScript (tanpa three.js):
 * frustum kamera diwakili posisi, arah pandang, dan setengah sudut pandang horizontal.
 */
import { edgeAt, edgePoint, type LaneGraph } from './laneGraph';
import { createVehicle, type TrafficState, type Vehicle } from './trafficSim';

export const SPAWN_MIN = 40;
export const SPAWN_MAX = 110;
export const DESPAWN = 130;
/** Margin sudut supaya spawn tidak muncul tepat di tepi layar saat kamera berputar. */
/** Jarak bebas minimum ke kendaraan lain di edge yang sama saat spawn. */
const SPAWN_CLEAR = 12;
const VIEW_MARGIN = 10 * (Math.PI / 180);

export type GraphicsPreset = 'low' | 'medium' | 'high';
export const VEHICLE_POOL: Record<GraphicsPreset, number> = { low: 8, medium: 14, high: 20 };

export interface CameraView {
  x: number;
  z: number;
  /** Arah pandang horizontal (tidak perlu unit). */
  dirX: number;
  dirZ: number;
  /** Setengah sudut pandang horizontal (radian). */
  halfFov: number;
}

/** Benar kalau (x, z) ada di dalam frustum kamera (dengan margin sudut). */
export function inView(view: CameraView, x: number, z: number): boolean {
  const length = Math.hypot(view.dirX, view.dirZ) || 1;
  const dx = x - view.x;
  const dz = z - view.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 1e-6) return true;
  const cos = (dx * view.dirX + dz * view.dirZ) / (length * distance);
  return cos >= Math.cos(Math.min(Math.PI, view.halfFov + VIEW_MARGIN));
}

const distanceTo = (view: CameraView, x: number, z: number) => Math.hypot(x - view.x, z - view.z);

/** Buang kendaraan di luar DESPAWN; mengembalikan jumlah yang dibuang. */
export function despawnFar(graph: LaneGraph, state: TrafficState, view: CameraView): number {
  const keep = state.vehicles.filter((vehicle) => {
    const point = edgePoint(graph, vehicle.edge, vehicle.s);
    return distanceTo(view, point.x, point.z) <= DESPAWN;
  });
  const removed = state.vehicles.length - keep.length;
  if (removed > 0) {
    for (const vehicle of state.vehicles) {
      if (!keep.includes(vehicle)) {
        for (const [isec, holder] of state.reserved) if (holder === vehicle.id) state.reserved.delete(isec);
      }
    }
    state.vehicles = keep;
  }
  return removed;
}

/** Titik spawn: di lajur, 40-110 m dari kamera, dan di luar frustum. */
export function findSpawnSpot(
  graph: LaneGraph,
  view: CameraView,
  random: () => number,
  occupied: readonly Vehicle[] = [],
  attempts = 200,
): { edge: number; s: number } | undefined {
  const count = graph.data.edges.length;
  for (let i = 0; i < attempts; i++) {
    const edge = Math.floor(random() * count);
    // Hanya di segmen lajur: persimpangan butuh reservasi, jangan spawn di tengahnya.
    if (edgeAt(graph, edge).kind !== 'lane') continue;
    const s = random() * edgeAt(graph, edge).length;
    const point = edgePoint(graph, edge, s);
    const distance = distanceTo(view, point.x, point.z);
    if (distance < SPAWN_MIN || distance > SPAWN_MAX) continue;
    if (inView(view, point.x, point.z)) continue;
    // Jangan spawn menempel kendaraan lain di lajur yang sama.
    if (occupied.some((other) => other.edge === edge && Math.abs(other.s - s) < SPAWN_CLEAR)) continue;
    return { edge, s };
  }
  return undefined;
}

/**
 * Jaga jumlah kendaraan sesuai pool preset: despawn yang jauh, lalu isi lagi di cincin spawn.
 * `nextId` dipakai supaya id tetap unik sepanjang sesi.
 */
export function updateSpawns(
  graph: LaneGraph,
  state: TrafficState,
  view: CameraView,
  preset: GraphicsPreset,
  random: () => number,
  nextId: () => number,
  maxSpeed = 11,
): { spawned: Vehicle[]; despawned: number } {
  const despawned = despawnFar(graph, state, view);
  const spawned: Vehicle[] = [];
  while (state.vehicles.length < VEHICLE_POOL[preset]) {
    const spot = findSpawnSpot(graph, view, random, state.vehicles);
    if (!spot) break;
    const vehicle = createVehicle(graph, nextId(), spot.edge, spot.s, maxSpeed, random);
    state.vehicles.push(vehicle);
    spawned.push(vehicle);
  }
  return { spawned, despawned };
}

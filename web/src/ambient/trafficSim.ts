/**
 * Simulasi lalu lintas 1D di atas graf lajur. Murni TypeScript (tanpa three.js) supaya
 * bisa di-unit-test dan nanti dipindah ke web worker. Posisi tiap kendaraan = (edge, s)
 * dengan s dalam meter di sepanjang edge. Tanpa fisika.
 */
import { edgeAt, edgeHeading, edgePoint, type LaneGraph, nextEdge } from './laneGraph';

/** Simulasi utama 15 Hz; agen jauh (> FAR_DISTANCE dari pemain) cukup 5 Hz. */
export const TICK_HZ_NEAR = 15;
export const TICK_HZ_FAR = 5;
export const FAR_DISTANCE = 60;

/** Panjang kendaraan untuk jarak antar pusat (m). */
export const VEHICLE_LENGTH = 4;
/** Car-following: 2 m + 0.8 detik x kecepatan. */
export const GAP_BASE = 2;
export const GAP_TIME = 0.8;
/** Sisa celah minimum yang dijaga keras supaya tidak pernah tabrakan. */
const MIN_CLEAR = 0.5;
const ACCEL = 3;
const BRAKE = 6;
/** Mulai mencoba reservasi persimpangan dari jarak ini sebelum ujung lajur. */
const RESERVE_LOOKAHEAD = 8;

export interface Vehicle {
  id: number;
  edge: number;
  /** Posisi 1D di sepanjang edge (m). */
  s: number;
  speed: number;
  maxSpeed: number;
  /** Edge berikutnya, dipilih saat masuk edge ini (persimpangan = belokan acak). */
  next: number;
}

export interface TrafficState {
  vehicles: Vehicle[];
  /** indeks persimpangan -> id kendaraan yang memegang reservasi. */
  reserved: Map<number, number>;
}

export const safeGap = (speed: number): number => GAP_BASE + GAP_TIME * speed;

export function createVehicle(graph: LaneGraph, id: number, edge: number, s: number, maxSpeed: number, random: () => number): Vehicle {
  return { id, edge, s, speed: maxSpeed, maxSpeed, next: nextEdge(graph, edge, random) };
}

export const createTraffic = (vehicles: Vehicle[] = []): TrafficState => ({ vehicles, reserved: new Map() });

/** Satu-satunya lajur lanjutan sesudah sebuah belokan (tiap node keluar punya satu lajur). */
const successorLane = (graph: LaneGraph, turn: number): number | undefined => graph.outgoing[edgeAt(graph, turn).b]?.[0];

/** Celah bumper ke kendaraan di depan, menengok sampai satu edge berikutnya. */
function gapAhead(graph: LaneGraph, state: TrafficState, vehicle: Vehicle): number {
  const length = edgeAt(graph, vehicle.edge).length;
  let gap = Number.POSITIVE_INFINITY;
  for (const other of state.vehicles) {
    if (other.id === vehicle.id) continue;
    if (other.edge === vehicle.edge && other.s > vehicle.s) gap = Math.min(gap, other.s - vehicle.s);
    else if (other.edge === vehicle.next) gap = Math.min(gap, length - vehicle.s + other.s);
  }
  return gap - VEHICLE_LENGTH;
}

/** Reservasi persimpangan: satu kendaraan per persimpangan, dan hanya kalau lajur keluarnya lega. */
function intersectionBlocked(graph: LaneGraph, state: TrafficState, vehicle: Vehicle): boolean {
  const turn = edgeAt(graph, vehicle.next);
  if (turn.isec < 0) return false;
  const holder = state.reserved.get(turn.isec);
  if (holder !== undefined) return holder !== vehicle.id;
  if (edgeAt(graph, vehicle.edge).length - vehicle.s > RESERVE_LOOKAHEAD) return true;
  // Hanya kendaraan terdepan di lajurnya yang boleh reservasi, kalau tidak yang di belakang
  // bisa mengunci persimpangan untuk yang di depannya (deadlock).
  if (state.vehicles.some((other) => other.edge === vehicle.edge && other.s > vehicle.s)) return true;
  // Jangan masuk kalau tidak ada tempat mendarat di awal lajur keluar. Syaratnya sependek mungkin
  // (cukup satu badan kendaraan) supaya antrean memanjang tetap bisa jalan dan tidak saling mengunci.
  const jammed = (option: number) => {
    const exitLane = successorLane(graph, option);
    return state.vehicles.some((other) => other.edge === exitLane && other.s < VEHICLE_LENGTH + MIN_CLEAR);
  };
  if (jammed(vehicle.next)) {
    // Arah pilihan macet: ganti ke belokan lain yang lega. Ini yang memutus gridlock melingkar.
    const free = (graph.outgoing[edgeAt(graph, vehicle.edge).b] ?? []).find((option) => !jammed(option));
    if (free === undefined) return true;
    vehicle.next = free;
  }
  state.reserved.set(edgeAt(graph, vehicle.next).isec, vehicle.id);
  return false;
}

/**
 * Satu tick simulasi. dt = 1/15 detik (atau 1/5 untuk agen jauh).
 * `random` dipakai untuk memilih belokan di persimpangan.
 */
export function stepTraffic(graph: LaneGraph, state: TrafficState, dt: number, random: () => number): void {
  for (const vehicle of state.vehicles) {
    const edge = edgeAt(graph, vehicle.edge);
    let gap = gapAhead(graph, state, vehicle);
    if (intersectionBlocked(graph, state, vehicle)) gap = Math.min(gap, edge.length - vehicle.s);

    // Kecepatan aman dari rumus celah: gap >= 2 m + 0.8 detik x kecepatan.
    const allowed = Number.isFinite(gap) ? Math.max(0, (gap - GAP_BASE) / GAP_TIME) : vehicle.maxSpeed;
    const target = Math.min(vehicle.maxSpeed, allowed);
    const rate = target > vehicle.speed ? ACCEL : BRAKE;
    vehicle.speed = Math.max(0, vehicle.speed + Math.max(-rate * dt, Math.min(rate * dt, target - vehicle.speed)));
    // Pagar keras: jangan pernah menutup celah sampai habis dalam satu tick.
    if (Number.isFinite(gap)) vehicle.speed = Math.min(vehicle.speed, Math.max(0, (gap - MIN_CLEAR) / dt));

    vehicle.s += vehicle.speed * dt;
    if (vehicle.s < edge.length) continue;

    // Pindah ke edge berikutnya, bawa sisa jaraknya.
    if (edge.isec >= 0 && state.reserved.get(edge.isec) === vehicle.id) state.reserved.delete(edge.isec);
    vehicle.s -= edge.length;
    vehicle.edge = vehicle.next;
    vehicle.next = nextEdge(graph, vehicle.edge, random);
    const entered = edgeAt(graph, vehicle.edge);
    if (entered.isec >= 0) state.reserved.set(entered.isec, vehicle.id);
  }
}

/** Posisi dan arah hadap dunia untuk render/interpolasi. */
export const vehiclePose = (graph: LaneGraph, vehicle: Vehicle): { x: number; z: number; dirX: number; dirZ: number } => {
  const point = edgePoint(graph, vehicle.edge, vehicle.s);
  const heading = edgeHeading(graph, vehicle.edge, vehicle.s);
  return { x: point.x, z: point.z, dirX: heading.x, dirZ: heading.z };
};

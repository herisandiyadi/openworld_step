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

/**
 * Lampu lalu lintas (B4): benar kalau kendaraan di lajur `edge` harus menunggu sebelum
 * memasuki persimpangan lewat belokan `turn`. Pemanggil mengisinya dengan `signalBlocks`
 * dari trafficLights.ts; tanpa itu semua persimpangan memakai reservasi saja.
 */
export type SignalGate = (edge: number, turn: number) => boolean;

/** Reservasi persimpangan: satu kendaraan per persimpangan, dan hanya kalau lajur keluarnya lega. */
function intersectionBlocked(graph: LaneGraph, state: TrafficState, vehicle: Vehicle, gate?: SignalGate): boolean {
  const turn = edgeAt(graph, vehicle.next);
  if (turn.isec < 0) return false;
  const holder = state.reserved.get(turn.isec);
  if (holder !== undefined) return holder !== vehicle.id;
  // Lampu merah/kuning: berhenti di garis, reservasi tidak diambil.
  if (gate?.(vehicle.edge, vehicle.next)) return true;
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

export interface StepOptions {
  /** Lampu lalu lintas; lihat SignalGate. */
  gate?: SignalGate;
  /** Kendaraan yang maju di tick ini (pembagian 15/5 Hz dekat/jauh). */
  active?: (vehicle: Vehicle) => boolean;
  /** Celah tambahan ke penghalang bukan kendaraan ambient, mis. pemain (B8). */
  obstacleGap?: (vehicle: Vehicle) => number;
}

/**
 * Satu tick simulasi. dt = 1/15 detik (atau 1/5 untuk agen jauh).
 * `random` dipakai untuk memilih belokan di persimpangan.
 */
export function stepTraffic(graph: LaneGraph, state: TrafficState, dt: number, random: () => number, options: StepOptions = {}): void {
  const { gate, active, obstacleGap } = options;
  for (const vehicle of state.vehicles) {
    if (active && !active(vehicle)) continue;
    const edge = edgeAt(graph, vehicle.edge);
    let gap = gapAhead(graph, state, vehicle);
    if (obstacleGap) gap = Math.min(gap, obstacleGap(vehicle));
    if (intersectionBlocked(graph, state, vehicle, gate)) gap = Math.min(gap, edge.length - vehicle.s);

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

/** Rasio tick dekat per tick jauh (15 Hz / 5 Hz). */
const FAR_EVERY = TICK_HZ_NEAR / TICK_HZ_FAR;

/**
 * Satu tick 15 Hz dengan pembagian dekat/jauh: kendaraan dekat maju tiap tick dengan dt 1/15,
 * kendaraan jauh hanya tiap tick ke-3 dengan dt 1/5. `tick` adalah nomor tick yang terus naik.
 */
export function stepTrafficTiered(
  graph: LaneGraph,
  state: TrafficState,
  tick: number,
  random: () => number,
  isNear: (vehicle: Vehicle) => boolean,
  options: StepOptions = {},
): void {
  stepTraffic(graph, state, 1 / TICK_HZ_NEAR, random, { ...options, active: isNear });
  if (tick % FAR_EVERY === 0) stepTraffic(graph, state, 1 / TICK_HZ_FAR, random, { ...options, active: (vehicle) => !isNear(vehicle) });
}

/** Setengah lebar lajur yang dianggap terhalang oleh pemain. */
const PLAYER_LATERAL = 2.2;
/** Kendaraan mulai mengerem untuk pemain dari jarak ini (NEXT_FEATURES 3.2). */
export const PLAYER_BRAKE_DISTANCE = 6;

/**
 * Celah ke pemain di depan kendaraan (m), atau tak hingga kalau pemain tidak di jalurnya.
 * Murni: pemain cukup diwakili titik + radius.
 */
export function playerGap(graph: LaneGraph, vehicle: Vehicle, player: { x: number; z: number; radius: number }): number {
  const pose = vehiclePose(graph, vehicle);
  const dx = player.x - pose.x;
  const dz = player.z - pose.z;
  const forward = dx * pose.dirX + dz * pose.dirZ;
  const lateral = Math.abs(dx * pose.dirZ - dz * pose.dirX);
  if (forward < 0 || forward > PLAYER_BRAKE_DISTANCE + VEHICLE_LENGTH || lateral > PLAYER_LATERAL + player.radius) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, forward - VEHICLE_LENGTH / 2 - player.radius);
}

/** Posisi dan arah hadap dunia untuk render/interpolasi. */
export const vehiclePose = (graph: LaneGraph, vehicle: Vehicle): { x: number; z: number; dirX: number; dirZ: number } => {
  const point = edgePoint(graph, vehicle.edge, vehicle.s);
  const heading = edgeHeading(graph, vehicle.edge, vehicle.s);
  return { x: point.x, z: point.z, dirX: heading.x, dirZ: heading.z };
};

/** Lompatan lebih jauh dari ini antar tick dianggap teleport (spawn ulang), jadi tidak di-lerp. */
const SNAP_DISTANCE = 10;

type Pose = { x: number; z: number; dirX: number; dirZ: number };

/** Interpolasi pose render antar tick: `alpha` = sisa akumulator / panjang tick (0..1). */
export function lerpPose(prev: Pose | undefined, next: Pose, alpha: number): Pose {
  if (!prev || Math.hypot(next.x - prev.x, next.z - prev.z) > SNAP_DISTANCE) return next;
  const k = Math.min(1, Math.max(0, alpha));
  return {
    x: prev.x + (next.x - prev.x) * k,
    z: prev.z + (next.z - prev.z) * k,
    dirX: prev.dirX + (next.dirX - prev.dirX) * k,
    dirZ: prev.dirZ + (next.dirZ - prev.dirZ) * k,
  };
}

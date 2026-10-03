/**
 * Simulasi pejalan kaki di atas graf trotoar (`walkNodes`/`walkEdges` di lanes.json).
 * Murni TypeScript (tanpa three.js/React) supaya bisa di-unit-test dan dipindah ke web worker.
 *
 * Posisi tiap pejalan = (edge, s) dengan s meter dari ujung `from`. Graf trotoar tak berarah,
 * jadi tiap agen menyimpan arah jalannya sendiri (`from`/`to` = indeks node).
 * Agen tetap di garis tengah trotoar; garis itu sendiri sudah dibake >= 1.8 m dari gedung
 * (uji di pedestrianSim.test.ts), jadi tidak ada agen yang bisa masuk collider gedung.
 */
import type { LaneNode, LanesData, WalkEdge } from './laneGraph';
import { type CameraView, DESPAWN, type GraphicsPreset, inView, SPAWN_MAX, SPAWN_MIN } from './spawner';

/** Simulasi utama 15 Hz, sama dengan trafficSim. */
export const TICK_HZ = 15;
export const WALK_SPEED = 1.3;
/** Jarak antar pusat agen yang dijaga di trotoar (m). */
export const PED_GAP = 0.8;
/** Pejalan menjauh dari pemain dalam radius ini. */
export const PLAYER_AVOID = 1.2;
/** Jumlah pejalan kaki per preset grafis (NEXT_FEATURES 3.4). */
export const PED_POOL: Record<GraphicsPreset, number> = { low: 10, medium: 18, high: 26 };
/** Jarak maksimal "Tanya" ke pejalan kaki, dan jarak label nama (NEXT_FEATURES 3.7). */
export const PED_TALK_DISTANCE = 3;
export const PED_LABEL_DISTANCE = 6;
/** Lama berhenti sebelum menyeberang, dan jeda saat menunggu jalur bersih (detik). */
const CROSS_WAIT_MAX = 20;

export interface WalkGraph {
  nodes: readonly LaneNode[];
  edges: readonly WalkEdge[];
  /** Indeks edge yang menyentuh tiap node. */
  incident: number[][];
}

export function buildWalkGraph(data: Pick<LanesData, 'walkNodes' | 'walkEdges'>): WalkGraph {
  const incident = data.walkNodes.map(() => [] as number[]);
  data.walkEdges.forEach((edge, index) => {
    incident[edge.a]?.push(index);
    incident[edge.b]?.push(index);
  });
  return { nodes: data.walkNodes, edges: data.walkEdges, incident };
}

/** 'linger' = baru selesai chat: masih berdiri menghadap pemain sebentar, lalu jalan lagi. */
export type PedState = 'walk' | 'wait' | 'cross' | 'sit' | 'talk' | 'linger';
/** Lama 'linger' setelah chat ditutup (detik). */
export const LINGER_TIME = 1.5;

export interface Pedestrian {
  id: number;
  /** Indeks warga di pool residents (dipakai chat C8); -1 kalau belum dipasangkan. */
  residentIndex: number;
  edge: number;
  /** Node awal dan tujuan dari edge ini; arah jalan = from -> to. */
  from: number;
  to: number;
  /** Posisi 1D (m) diukur dari `from`. */
  s: number;
  speed: number;
  maxSpeed: number;
  state: PedState;
  /** Lama di state sekarang (detik); dipakai untuk batas antre dan durasi duduk. */
  timer: number;
}

export interface PedWorld {
  peds: Pedestrian[];
  /** Pemain, supaya pejalan menghindar dan kendaraan di zebra terdeteksi. */
  player: { x: number; z: number };
  /** Kendaraan yang sedang di jalan (posisi dunia), untuk cek zebra cross aman. */
  vehicles: readonly { x: number; z: number; speed: number }[];
  /** Lampu pejalan hijau di zebra (lihat trafficLights.pedestrianGate); kalau tidak diisi, zebra dinilai dari kendaraan saja. */
  pedGreen?: (edge: number, time: number) => boolean;
  /** Jam dalam game (dayClock.t), untuk kepadatan spawn. */
  t: number;
  /** Jam lampu lalu lintas (detik, signalClock.time) yang dibaca pedGreen. */
  signalTime?: number;
}

const nodeOf = (graph: WalkGraph, index: number): LaneNode => {
  const node = graph.nodes[index];
  if (!node) throw new Error(`walk node ${index} tidak ada`);
  return node;
};

export const walkEdgeAt = (graph: WalkGraph, index: number): WalkEdge => {
  const edge = graph.edges[index];
  if (!edge) throw new Error(`walk edge ${index} tidak ada`);
  return edge;
};

/** Posisi dunia pejalan. Edge trotoar selalu lurus, jadi cukup interpolasi linear. */
export function pedPose(graph: WalkGraph, ped: Pedestrian): { x: number; z: number; dirX: number; dirZ: number } {
  const a = nodeOf(graph, ped.from);
  const b = nodeOf(graph, ped.to);
  const length = walkEdgeAt(graph, ped.edge).length || 1;
  const k = Math.min(1, Math.max(0, ped.s / length));
  const dx = (b.x - a.x) / length;
  const dz = (b.z - a.z) / length;
  return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, dirX: dx, dirZ: dz };
}

export function createPedestrian(
  graph: WalkGraph,
  id: number,
  edge: number,
  s: number,
  random: () => number,
  residentIndex = -1,
): Pedestrian {
  const walk = walkEdgeAt(graph, edge);
  const forward = random() < 0.5;
  const maxSpeed = WALK_SPEED * (0.85 + random() * 0.3);
  return {
    id,
    residentIndex,
    edge,
    from: forward ? walk.a : walk.b,
    to: forward ? walk.b : walk.a,
    s: Math.min(s, walk.length),
    speed: maxSpeed,
    maxSpeed,
    state: walk.cross ? 'cross' : 'walk',
    timer: 0,
  };
}

export const createPedWorld = (peds: Pedestrian[] = []): PedWorld => ({
  peds,
  player: { x: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY },
  vehicles: [],
  t: 0.5,
});

/** Edge trotoar berikutnya: acak di antara edge yang menyentuh node tujuan, hindari balik badan. */
function pickNextEdge(graph: WalkGraph, ped: Pedestrian, random: () => number): number {
  const options = graph.incident[ped.to] ?? [];
  if (options.length === 0) throw new Error(`walk node ${ped.to} tidak punya edge`);
  const forward = options.filter((index) => index !== ped.edge);
  const pool = forward.length > 0 ? forward : options;
  return pool[Math.floor(random() * pool.length)] as number;
}

/** Jarak ke pejalan terdekat di depan pada edge yang sama dan arah yang sama. */
function gapAhead(world: PedWorld, ped: Pedestrian): number {
  let gap = Number.POSITIVE_INFINITY;
  for (const other of world.peds) {
    if (other.id === ped.id || other.edge !== ped.edge || other.from !== ped.from) continue;
    if (other.s > ped.s) gap = Math.min(gap, other.s - ped.s);
  }
  return gap;
}

/**
 * Zebra cross boleh dilewati kalau lampu pejalan hijau (kalau ada lampunya) dan tidak ada
 * kendaraan bergerak dalam 8 m dari titik masuk zebra.
 */
function crossingClear(graph: WalkGraph, world: PedWorld, ped: Pedestrian, entry: LaneNode): boolean {
  if (world.pedGreen && !world.pedGreen(ped.edge, world.signalTime ?? 0)) return false;
  const span = walkEdgeAt(graph, ped.edge).length;
  const exit = nodeOf(graph, ped.to);
  const midX = (entry.x + exit.x) / 2;
  const midZ = (entry.z + exit.z) / 2;
  const reach = span / 2 + 4;
  return !world.vehicles.some((vehicle) => vehicle.speed > 0.2 && Math.hypot(vehicle.x - midX, vehicle.z - midZ) < reach);
}

/** Dorongan menjauh dari pemain: pejalan melambat kalau pemain tepat di depannya. */
function playerBlocks(world: PedWorld, pose: { x: number; z: number; dirX: number; dirZ: number }): boolean {
  const dx = world.player.x - pose.x;
  const dz = world.player.z - pose.z;
  const distance = Math.hypot(dx, dz);
  if (!Number.isFinite(distance) || distance > PLAYER_AVOID) return false;
  // Hanya kalau pemain ada di setengah depan arah jalan.
  return dx * pose.dirX + dz * pose.dirZ > 0;
}

/**
 * Satu tick simulasi (dt = 1/15 detik). `random` memilih arah di persimpangan trotoar.
 * Agen ber-state 'talk', 'linger', atau 'sit' tidak bergerak (dipakai chat warga C8 dan bangku C10).
 */
export function stepPedestrians(graph: WalkGraph, world: PedWorld, dt: number, random: () => number): void {
  for (const ped of world.peds) {
    ped.timer += dt;
    if (ped.state === 'talk' || ped.state === 'sit') {
      ped.speed = 0;
      continue;
    }
    if (ped.state === 'linger') {
      ped.speed = 0;
      if (ped.timer < LINGER_TIME) continue;
      ped.state = walkEdgeAt(graph, ped.edge).cross ? 'cross' : 'walk';
      ped.timer = 0;
    }

    const edge = walkEdgeAt(graph, ped.edge);
    const pose = pedPose(graph, ped);

    // Antre di mulut zebra: berhenti sampai jalur bersih, dengan batas waktu supaya tidak deadlock.
    if (ped.state === 'wait') {
      ped.speed = 0;
      if (crossingClear(graph, world, ped, nodeOf(graph, ped.from)) || ped.timer > CROSS_WAIT_MAX) {
        ped.state = 'cross';
        ped.timer = 0;
      } else {
        continue;
      }
    }

    const gap = gapAhead(world, ped);
    const target = gap < PED_GAP || playerBlocks(world, pose) ? 0 : ped.maxSpeed;
    // Percepatan halus; pejalan kaki tidak butuh model sedetail kendaraan.
    ped.speed += Math.max(-4 * dt, Math.min(4 * dt, target - ped.speed));
    ped.speed = Math.max(0, ped.speed);
    if (Number.isFinite(gap)) ped.speed = Math.min(ped.speed, Math.max(0, (gap - PED_GAP / 2) / dt));

    ped.s += ped.speed * dt;
    if (ped.s < edge.length) continue;

    // Sampai di node: pilih edge berikutnya. Kalau itu zebra, antre dulu.
    ped.s -= edge.length;
    const next = pickNextEdge(graph, ped, random);
    const walk = walkEdgeAt(graph, next);
    ped.from = ped.to;
    ped.to = walk.a === ped.from ? walk.b : walk.a;
    ped.edge = next;
    ped.s = Math.min(ped.s, walk.length);
    ped.timer = 0;
    if (walk.cross) {
      ped.state = crossingClear(graph, world, ped, nodeOf(graph, ped.from)) ? 'cross' : 'wait';
      if (ped.state === 'wait') ped.s = 0;
    } else {
      ped.state = 'walk';
    }
  }
}

/**
 * Jaga jumlah pejalan sesuai pool preset: buang yang > DESPAWN m (kecuali sedang chat),
 * lalu isi lagi di cincin 40-110 m di luar pandangan kamera. Tiap pejalan baru mengambil
 * warga yang sedang tidak aktif dari pool `residentCount` (NEXT_FEATURES 3.7).
 */
export function updatePedSpawns(
  graph: WalkGraph,
  world: PedWorld,
  view: CameraView,
  target: number,
  residentCount: number,
  random: () => number,
  nextId: () => number,
): void {
  world.peds = world.peds.filter((ped) => {
    if (ped.state === 'talk' || ped.state === 'linger') return true;
    const pose = pedPose(graph, ped);
    return Math.hypot(pose.x - view.x, pose.z - view.z) <= DESPAWN;
  });
  const used = new Set(world.peds.map((ped) => ped.residentIndex));
  for (let attempt = 0; world.peds.length < target && attempt < 200; attempt++) {
    const edge = Math.floor(random() * graph.edges.length);
    const walk = walkEdgeAt(graph, edge);
    if (walk.cross) continue;
    const s = random() * walk.length;
    const a = nodeOf(graph, walk.a);
    const b = nodeOf(graph, walk.b);
    const k = s / (walk.length || 1);
    const x = a.x + (b.x - a.x) * k;
    const z = a.z + (b.z - a.z) * k;
    const distance = Math.hypot(x - view.x, z - view.z);
    if (distance < SPAWN_MIN || distance > SPAWN_MAX || inView(view, x, z)) continue;
    if (world.peds.some((ped) => ped.edge === edge && Math.abs(ped.s - s) < PED_GAP * 2)) continue;
    let resident = -1;
    for (let r = 0; r < residentCount; r++) {
      const pick = (Math.floor(random() * residentCount) + r) % residentCount;
      if (!used.has(pick)) {
        resident = pick;
        break;
      }
    }
    if (resident >= 0) used.add(resident);
    world.peds.push(createPedestrian(graph, nextId(), edge, s, random, resident));
  }
}

/** Pejalan terdekat yang punya warga, dalam `maxDistance` m dari (x, z). */
export function nearestPed(graph: WalkGraph, world: PedWorld, x: number, z: number, maxDistance: number): Pedestrian | null {
  let best: Pedestrian | null = null;
  let bestDistance = maxDistance;
  for (const ped of world.peds) {
    if (ped.residentIndex < 0) continue;
    const pose = pedPose(graph, ped);
    const distance = Math.hypot(pose.x - x, pose.z - z);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = ped;
    }
  }
  return best;
}

/**
 * Mulai/selesai chat: warga berhenti (state 'talk', tidak di-despawn), lalu 'linger' sebentar
 * dan lanjut beraktivitas. Agen di zebra kembali ke 'cross', bukan antre lagi di tengah jalan.
 */
export function setTalking(world: PedWorld, residentIndex: number, talking: boolean): void {
  for (const ped of world.peds) {
    if (ped.residentIndex !== residentIndex) continue;
    if (talking) ped.state = 'talk';
    else if (ped.state === 'talk') ped.state = 'linger';
    ped.timer = 0;
  }
}

/**
 * Siklus lampu lalu lintas (B4). Periode 12 detik dibagi dua arah: 6 detik per arah,
 * 4 detik hijau lalu 2 detik kuning, jadi tepat satu arah hijau pada satu waktu.
 * Murni TypeScript tanpa three.js supaya bisa di-unit-test; renderer hanya membaca `lampAt`
 * untuk menyalakan node `lamp_red/lamp_yellow/lamp_green`, dan simulasi memakai `signalBlocks`.
 */
import { chunkCoord, districtOf } from '../world/worldSpec';
import { edgeAt, type LaneGraph } from './laneGraph';
import type { WalkGraph } from './pedestrianSim';

export const CYCLE_SECONDS = 12;
export const YELLOW_SECONDS = 2;
/** Dua arah bergantian: sumbu 0 = timur-barat (X), sumbu 1 = utara-selatan (Z). */
export const AXIS_COUNT = 2;
export const SLOT_SECONDS = CYCLE_SECONDS / AXIS_COUNT;
export const GREEN_SECONDS = SLOT_SECONDS - YELLOW_SECONDS;

export type LampState = 'red' | 'yellow' | 'green';

/** Nama node muka lampu di `prop_trafficlight_01`. */
export const LAMP_NODES: Record<LampState, string> = { red: 'lamp_red', yellow: 'lamp_yellow', green: 'lamp_green' };

/** Beda fase antar persimpangan supaya tidak semua berganti serempak. */
export const phaseOffset = (isec: number): number => (isec * 5) % CYCLE_SECONDS;

/** Warna lampu untuk sebuah arah di persimpangan `isec` pada detik `time`. */
export function lampAt(isec: number, axis: number, time: number): LampState {
  const t = (((time + phaseOffset(isec)) % CYCLE_SECONDS) + CYCLE_SECONDS) % CYCLE_SECONDS;
  const slot = Math.floor(t / SLOT_SECONDS);
  if (slot !== ((axis % AXIS_COUNT) + AXIS_COUNT) % AXIS_COUNT) return 'red';
  return t - slot * SLOT_SECONDS < GREEN_SECONDS ? 'green' : 'yellow';
}

/** Sumbu sebuah lajur dari arah node awal ke node akhir. */
export function edgeAxis(graph: LaneGraph, index: number): number {
  const edge = edgeAt(graph, index);
  const a = graph.data.nodes[edge.a];
  const b = graph.data.nodes[edge.b];
  if (!a || !b) return 0;
  return Math.abs(b.x - a.x) >= Math.abs(b.z - a.z) ? 0 : 1;
}

/** Hanya Pusat Kota berlampu; kawasan lain tetap pakai reservasi "siapa duluan". */
export function isSignalised(graph: LaneGraph, isec: number): boolean {
  const point = graph.data.intersections[isec];
  return point !== undefined && districtOf(chunkCoord(point.x), chunkCoord(point.z)) === 'downtown';
}

/** Daftar persimpangan berlampu (indeks ke `intersections`). */
export const signalisedIntersections = (graph: LaneGraph): number[] =>
  graph.data.intersections.flatMap((_, isec) => (isSignalised(graph, isec) ? [isec] : []));

/**
 * Benar kalau kendaraan di lajur `edge` tidak boleh masuk persimpangan lewat belokan `turn`.
 * Kuning ikut menahan: kendaraan yang sudah memegang reservasi tetap menyelesaikan belokannya
 * (dicek di trafficSim sebelum memanggil ini).
 */
export function signalBlocks(graph: LaneGraph, time: number, edge: number, turn: number): boolean {
  const isec = edgeAt(graph, turn).isec;
  if (isec < 0 || !isSignalised(graph, isec)) return false;
  return lampAt(isec, edgeAxis(graph, edge), time) !== 'green';
}

/** Jam lampu bersama (detik), ditulis AmbientLayer tiap tick supaya pejalan kaki sefase dengan kendaraan. */
export const signalClock = { time: 0 };

/**
 * Gerbang zebra untuk pedestrianSim: `(walkEdge, time) => boolean` benar kalau pejalan boleh masuk.
 * Lampu pejalan hijau = lampu kendaraan di jalan yang diseberangi merah (kuning masih menahan).
 * Zebra di persimpangan tak berlampu selalu boleh; di sana pedestrianSim menilai dari kendaraan saja.
 */
export function pedestrianGate(graph: LaneGraph, walk: WalkGraph): (edge: number, time: number) => boolean {
  // Petakan zebra ke persimpangan terdekat (titik tengahnya di dalam kotak persimpangan) sekali saja.
  const zebra = new Map<number, { isec: number; axis: number }>();
  const signalised = signalisedIntersections(graph);
  walk.edges.forEach((edge, index) => {
    const a = walk.nodes[edge.a];
    const b = walk.nodes[edge.b];
    if (!edge.cross || !a || !b) return;
    const midX = (a.x + b.x) / 2;
    const midZ = (a.z + b.z) / 2;
    let best = -1;
    let bestDistance = edge.length;
    for (const isec of signalised) {
      const point = graph.data.intersections[isec];
      const distance = point ? Math.hypot(point.x - midX, point.z - midZ) : Infinity;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = isec;
      }
    }
    // Zebra searah X menyeberangi jalan utara-selatan (sumbu 1), dan sebaliknya.
    if (best >= 0) zebra.set(index, { isec: best, axis: Math.abs(b.x - a.x) >= Math.abs(b.z - a.z) ? 1 : 0 });
  });
  return (edge, time) => {
    const signal = zebra.get(edge);
    return !signal || lampAt(signal.isec, signal.axis, time) === 'red';
  };
}

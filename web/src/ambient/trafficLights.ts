/**
 * Siklus lampu lalu lintas (B4). Periode 12 detik dibagi dua arah: 6 detik per arah,
 * 4 detik hijau lalu 2 detik kuning, jadi tepat satu arah hijau pada satu waktu.
 * Murni TypeScript tanpa three.js supaya bisa di-unit-test; renderer hanya membaca `lampAt`
 * untuk menyalakan node `lamp_red/lamp_yellow/lamp_green`, dan simulasi memakai `signalBlocks`.
 */
import { chunkCoord, districtOf } from '../world/worldSpec';
import { edgeAt, type LaneGraph, type LaneNode } from './laneGraph';

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

/** Radius pencarian persimpangan berlampu untuk lampu penyeberangan (m). */
export const PED_LIGHT_RANGE = 25;
/** Tiang lampu di sudut persimpangan (m dari titik tengah) kalau tidak ada data trotoar. */
export const POLE_CORNER = 5.5;

/**
 * Persimpangan berlampu terdekat dari titik (x, z) dalam radius `range`, atau -1 kalau tidak ada.
 * Seri dimenangkan indeks terkecil supaya hasilnya deterministik.
 */
export function nearestSignal(graph: LaneGraph, signals: readonly number[], x: number, z: number, range = PED_LIGHT_RANGE): number {
  let best = -1;
  let bestDistance = range;
  for (const isec of signals) {
    const point = graph.data.intersections[isec];
    if (!point) continue;
    const distance = Math.hypot(point.x - x, point.z - z);
    if (distance <= range && distance < bestDistance) {
      bestDistance = distance;
      best = isec;
    }
  }
  return best;
}

/**
 * Lampu penyeberangan untuk zebra di (x, z) yang menyeberangi jalan bersumbu `axis`:
 * pejalan boleh menyeberang kalau lampu persimpangan berlampu terdekat untuk sumbu itu merah.
 * Tanpa persimpangan berlampu dalam radius, kembalikan true (pejalan menilai dari kendaraan saja).
 */
export function pedGreenAt(
  graph: LaneGraph,
  signals: readonly number[],
  x: number,
  z: number,
  axis: number,
  time: number,
  range = PED_LIGHT_RANGE,
): boolean {
  const isec = nearestSignal(graph, signals, x, z, range);
  return isec < 0 || lampAt(isec, axis, time) === 'red';
}

/**
 * Titik tiang lampu untuk sebuah persimpangan: pakai yang sudah dibake (`data.poles`) kalau ada,
 * kalau tidak ambil node trotoar terdekat dari sudut (-POLE_CORNER, -POLE_CORNER) supaya tiang
 * berdiri di trotoar, bukan di tengah jalan atau di dalam bangunan.
 */
export function poleAt(graph: LaneGraph, isec: number): LaneNode {
  const point = graph.data.intersections[isec];
  if (!point) return { x: 0, z: 0 };
  const baked = graph.data.poles?.[isec];
  if (baked) return baked;
  const target = { x: point.x - POLE_CORNER, z: point.z - POLE_CORNER };
  let best = target;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const walk of graph.data.walkNodes) {
    const distance = Math.hypot(walk.x - target.x, walk.z - target.z);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = walk;
    }
  }
  return best;
}

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

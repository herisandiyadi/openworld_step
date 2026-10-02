/**
 * Perjalanan bus yang benar-benar mengantar pemain (R&D: "bis terlihat mengantarkan user ke tujuan").
 * Murni TypeScript tanpa three.js/React supaya bisa di-unit-test, mengikuti gaya busRoute.ts.
 *
 * Kenapa tidak memakai stepBus() apa adanya: bus kota itu berputar terus dan jeda haltenya 4 detik,
 * sedangkan saat membawa pemain kita butuh (a) jarak tempuh yang terukur supaya ada indikator progres,
 * (b) jaminan berhenti di tujuan, dan (c) waktu tempuh yang tidak menyiksa. Jadi fase perjalanan
 * memakai integrator sendiri di atas data rute yang sama; begitu perjalanan selesai bus kembali
 * dijalankan oleh stepBus().
 *
 * Kenapa titik naik/turun diproyeksikan ke rute, bukan dicari di `route.stops`: halte tempat pemain
 * berdiri (dan kadang halte tujuan, karena busDestinations membuang halte saat ini) belum tentu salah
 * satu halte rute. Memproyeksikan posisi halte ke rute membuat bus berhenti di titik terdekat di jalan,
 * jadi tidak ada kombinasi halte yang bikin perjalanan mustahil.
 */
import { edgeAt, edgePoint, type LaneGraph } from './laneGraph';
import type { BusRoute } from './busRoute';

/** Kecepatan bus saat mengangkut pemain (m/s); lebih cepat dari BUS_SPEED supaya tidak menyiksa. */
export const RIDE_SPEED = 18;
/** Jeda di halte perantara saat mengangkut pemain (detik). */
export const RIDE_PAUSE = 1.2;
/** Lama pintu terbuka saat pemain naik dan turun (detik). */
export const BOARD_TIME = 1.4;
/** Bus muncul sejauh ini sebelum halte supaya terlihat "datang" lalu berhenti (m). */
export const APPROACH = 28;
/** Batas aman: lewat ini perjalanan dianggap bermasalah dan jatuh ke fast travel lama (detik). */
export const RIDE_TIMEOUT = 150;
/** Toleransi penempatan di halte (m). */
const SNAP = 0.05;

export type RidePhase = 'menunggu' | 'naik' | 'jalan' | 'turun' | 'selesai' | 'gagal';

/** Posisi di sepanjang rute: indeks leg + posisi 1D pada edge leg itu. */
export interface RoutePoint {
  leg: number;
  s: number;
}

export interface BusRide {
  phase: RidePhase;
  /** Halte tujuan (id halte dunia, bukan indeks rute). */
  toStopId: string;
  board: RoutePoint;
  target: RoutePoint;
  /** Jarak tempuh dari titik naik ke titik turun (m). */
  total: number;
  travelled: number;
  elapsed: number;
  /** Sisa waktu berhenti/pintu terbuka (detik). */
  timer: number;
  /** Halte perantara di sepanjang perjalanan, berurutan menurut jarak dari titik naik. */
  mid: { id: string; at: number }[];
  midIndex: number;
}

const legEdge = (route: BusRoute, leg: number): number => route.edges[((leg % route.edges.length) + route.edges.length) % route.edges.length] as number;
const legLength = (graph: LaneGraph, route: BusRoute, leg: number): number => edgeAt(graph, legEdge(route, leg)).length;

/** Panjang satu putaran rute (m). */
export function routeLength(graph: LaneGraph, route: BusRoute): number {
  let total = 0;
  for (let leg = 0; leg < route.edges.length; leg++) total += legLength(graph, route, leg);
  return total;
}

/**
 * Jarak titik dari awal rute (leg 0, s 0) sepanjang arah jalan.
 * Dipakai supaya semua jarak bisa dihitung sebagai selisih skalar, bukan penelusuran leg.
 */
export function routeOffset(graph: LaneGraph, route: BusRoute, point: RoutePoint): number {
  let offset = point.s;
  for (let leg = 0; leg < point.leg && leg < route.edges.length; leg++) offset += legLength(graph, route, leg);
  return offset;
}

/** Jarak maju (searah rute) dari `from` ke `to`; rute tertutup jadi hasilnya selalu >= 0. */
export function forwardDistance(graph: LaneGraph, route: BusRoute, from: RoutePoint, to: RoutePoint): number {
  const loop = routeLength(graph, route);
  if (loop <= 0) return 0;
  const delta = routeOffset(graph, route, to) - routeOffset(graph, route, from);
  return ((delta % loop) + loop) % loop;
}

/** Majukan posisi bus sejauh `dist` m di sepanjang rute (membungkus ke leg berikutnya). */
export function advanceAlongRoute(graph: LaneGraph, route: BusRoute, point: RoutePoint, dist: number): void {
  if (route.edges.length === 0) return;
  point.s += dist;
  let length = legLength(graph, route, point.leg);
  // Batas iterasi = satu putaran penuh: leg bisa sangat pendek (belokan), jadi loop harus berhenti pasti.
  for (let guard = 0; guard <= route.edges.length && point.s >= length; guard++) {
    point.s -= length;
    point.leg = (point.leg + 1) % route.edges.length;
    length = legLength(graph, route, point.leg);
  }
  if (point.s < 0) point.s = 0;
}

/** Mundurkan posisi di rute (dipakai untuk memunculkan bus sebelum halte). */
export function retreatAlongRoute(graph: LaneGraph, route: BusRoute, point: RoutePoint, dist: number): void {
  if (route.edges.length === 0) return;
  point.s -= dist;
  for (let guard = 0; guard <= route.edges.length && point.s < 0; guard++) {
    point.leg = (point.leg - 1 + route.edges.length) % route.edges.length;
    point.s += legLength(graph, route, point.leg);
  }
  if (point.s < 0) point.s = 0;
}

/** Jumlah sampel per leg saat memproyeksikan halte ke rute; leg terpanjang ~60 m, jadi galat < 4 m lalu dihaluskan. */
const PROJECT_SAMPLES = 10;

/**
 * Titik rute terdekat dari sebuah posisi dunia. Memakai edgePoint (API publik laneGraph) supaya
 * modul ini tetap bebas dari detail internal graf.
 */
export function projectOnRoute(graph: LaneGraph, route: BusRoute, x: number, z: number): RoutePoint & { distance: number } {
  let best = { leg: 0, s: 0, distance: Number.POSITIVE_INFINITY };
  for (let leg = 0; leg < route.edges.length; leg++) {
    const edge = legEdge(route, leg);
    const length = edgeAt(graph, edge).length;
    for (let i = 0; i <= PROJECT_SAMPLES; i++) {
      const s = (i / PROJECT_SAMPLES) * length;
      const point = edgePoint(graph, edge, s);
      const distance = Math.hypot(point.x - x, point.z - z);
      if (distance < best.distance) best = { leg, s, distance };
    }
  }
  return best;
}

export interface RideStop {
  id: string;
  x: number;
  z: number;
}

/**
 * Siapkan perjalanan: bus ditempatkan APPROACH meter sebelum halte pemain supaya terlihat datang.
 * Mengembalikan null kalau rute kosong atau tujuannya tidak bisa dicapai — pemanggil wajib
 * jatuh ke fast travel lama supaya pemain tidak pernah terjebak.
 */
export function startBusRide(graph: LaneGraph, route: BusRoute, bus: RoutePoint, from: RideStop, to: RideStop): BusRide | null {
  if (route.edges.length === 0) return null;
  const board = projectOnRoute(graph, route, from.x, from.z);
  const target = projectOnRoute(graph, route, to.x, to.z);
  const total = forwardDistance(graph, route, board, target);
  if (!Number.isFinite(total) || total < 1) return null;

  const mid = route.stops
    .map((stop) => ({ id: stop.id, at: forwardDistance(graph, route, board, { leg: stop.leg, s: stop.s }) }))
    // Halte yang terlalu dekat titik naik/turun dilewati: berhenti dua kali di tempat yang sama terasa macet.
    .filter((stop) => stop.at > 15 && stop.at < total - 15)
    .sort((a, b) => a.at - b.at);

  bus.leg = board.leg;
  bus.s = board.s;
  retreatAlongRoute(graph, route, bus, APPROACH);
  return {
    phase: 'menunggu',
    toStopId: to.id,
    board: { leg: board.leg, s: board.s },
    target: { leg: target.leg, s: target.s },
    total,
    travelled: 0,
    elapsed: 0,
    timer: 0,
    mid,
    midIndex: 0,
  };
}

/** Satu langkah perjalanan. `bus` dipakai langsung sebagai posisi bus yang dirender. */
export function stepBusRide(graph: LaneGraph, route: BusRoute, bus: RoutePoint, ride: BusRide, dt: number): void {
  if (ride.phase === 'selesai' || ride.phase === 'gagal') return;
  ride.elapsed += dt;
  // Jaring pengaman: rute aneh atau frame yang sangat lambat tidak boleh menahan pemain selamanya.
  if (ride.elapsed > RIDE_TIMEOUT) {
    ride.phase = 'gagal';
    return;
  }

  if (ride.phase === 'menunggu') {
    const remaining = forwardDistance(graph, route, bus, ride.board);
    const step = Math.min(RIDE_SPEED * dt, remaining);
    advanceAlongRoute(graph, route, bus, step);
    if (remaining - step <= SNAP) {
      bus.leg = ride.board.leg;
      bus.s = ride.board.s;
      ride.phase = 'naik';
      ride.timer = BOARD_TIME;
    }
    return;
  }

  if (ride.phase === 'naik' || ride.phase === 'turun') {
    ride.timer -= dt;
    if (ride.timer > 0) return;
    ride.timer = 0;
    ride.phase = ride.phase === 'naik' ? 'jalan' : 'selesai';
    return;
  }

  // phase 'jalan'
  if (ride.timer > 0) {
    ride.timer = Math.max(0, ride.timer - dt);
    return;
  }
  let step = Math.min(RIDE_SPEED * dt, ride.total - ride.travelled);
  const next = ride.mid[ride.midIndex];
  if (next && ride.travelled + step >= next.at) {
    step = Math.max(0, next.at - ride.travelled);
    ride.midIndex++;
    ride.timer = RIDE_PAUSE;
  }
  advanceAlongRoute(graph, route, bus, step);
  ride.travelled += step;
  if (ride.travelled >= ride.total - SNAP) {
    bus.leg = ride.target.leg;
    bus.s = ride.target.s;
    ride.phase = 'turun';
    ride.timer = BOARD_TIME;
  }
}

/** Progres 0..1 untuk indikator HUD. */
export const rideProgress = (ride: BusRide): number => (ride.total <= 0 ? 1 : Math.min(1, Math.max(0, ride.travelled / ride.total)));

/** Id halte berikutnya (halte perantara, atau halte tujuan di penggal terakhir). */
export const rideNextStopId = (ride: BusRide): string => ride.mid[ride.midIndex]?.id ?? ride.toStopId;

/** Perkiraan sisa waktu (detik), termasuk jeda halte yang belum dilewati. */
export function rideEtaSeconds(ride: BusRide): number {
  const left = Math.max(0, ride.total - ride.travelled);
  const pauses = Math.max(0, ride.mid.length - ride.midIndex) * RIDE_PAUSE;
  const doors = ride.phase === 'menunggu' ? BOARD_TIME * 2 : BOARD_TIME;
  return left / RIDE_SPEED + pauses + doors;
}

/** True selama pemain ada di dalam bus (kontrol jalan kaki dimatikan). */
export const rideOnBoard = (ride: BusRide): boolean => ride.phase === 'naik' || ride.phase === 'jalan' || ride.phase === 'turun';

/**
 * Kursi pemain di ruang model veh_bus (forward = -Z). Sisi kanan (+X) supaya tidak menghalangi
 * pintu di sisi kiri; y = tinggi lantai bus (bodi mulai di 0.45). Masih di dalam bodi (lebar 2.5 m).
 */
export const BUS_SEAT = { x: 0.55, y: 0.5, z: 1.2 } as const;
/** Titik turun darurat (tombol Turun di tengah jalan): di luar pintu depan, sisi kiri = sisi trotoar. */
export const BUS_EXIT = { x: -2.4, z: -3.2 } as const;

/** Ubah titik lokal bus ke dunia; rotasi sama dengan addVehicle (heading = atan2(-dirX, -dirZ)). */
export function busLocalToWorld(pose: { x: number; z: number; dirX: number; dirZ: number }, local: { x: number; z: number }): { x: number; z: number; heading: number } {
  const heading = Math.atan2(-pose.dirX, -pose.dirZ);
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  return { x: pose.x + local.x * cos + local.z * sin, z: pose.z - local.x * sin + local.z * cos, heading };
}

/** Halte rute berikutnya dari posisi bus, untuk melanjutkan putaran bus kota setelah mengantar. */
export function nextRouteStop(graph: LaneGraph, route: BusRoute, bus: RoutePoint): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  route.stops.forEach((stop, index) => {
    const distance = forwardDistance(graph, route, bus, stop);
    // Halte tempat bus sedang berdiri tidak dihitung, kalau tidak bus berhenti dua kali.
    if (distance > 0.5 && distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

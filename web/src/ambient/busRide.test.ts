import { describe, expect, it } from 'vitest';
import { bakeLanes } from '../../tools/world/lanes';
import { busDestinations } from '../game/busRoutes';
import { motoRiderPose, MOTO_RIDER, riderTint, RIDER_TINTS } from '../game/riderSpec';
import { generateWorld } from '../world/worldGen';
import {
  BOARD_TIME,
  forwardDistance,
  RIDE_TIMEOUT,
  rideEtaSeconds,
  rideNextStopId,
  rideOnBoard,
  rideProgress,
  routeLength,
  startBusRide,
  stepBusRide,
} from './busRide';
import { busPose, planBusRoute } from './busRoute';
import { buildLaneGraph } from './laneGraph';

const graph = buildLaneGraph(bakeLanes());
const stops = generateWorld(1337).index.busStops;
const route = planBusRoute(graph, stops);
const DT = 1 / 15;

/** Jalankan perjalanan sampai selesai/gagal; batas tick supaya uji sendiri tidak bisa loop selamanya. */
function runRide(fromId: string, toId: string) {
  const from = stops.find((stop) => stop.id === fromId);
  const to = stops.find((stop) => stop.id === toId);
  if (!from || !to) throw new Error('halte tidak ada');
  const bus = { leg: 0, s: 0 };
  const ride = startBusRide(graph, route, bus, from, to);
  if (!ride) throw new Error('perjalanan gagal dibuat');
  const phases = new Set<string>();
  const nextStops = new Set<string>();
  let maxTick = 0;
  for (let tick = 0; tick < (RIDE_TIMEOUT + 10) / DT; tick++) {
    stepBusRide(graph, route, bus, ride, DT);
    phases.add(ride.phase);
    if (ride.phase === 'jalan') nextStops.add(rideNextStopId(ride));
    maxTick = tick;
    if (ride.phase === 'selesai' || ride.phase === 'gagal') break;
  }
  return { ride, bus, from, to, phases, nextStops, seconds: (maxTick + 1) * DT };
}

describe('perjalanan bus mengantar pemain', () => {
  const ids = busDestinations(stops, null).map((d) => d.stop.id);

  it('mencapai halte tujuan dalam waktu wajar untuk semua pasangan halte, dan selalu berhenti', () => {
    let longest = 0;
    for (const fromId of ids) {
      for (const toId of ids) {
        if (fromId === toId) continue;
        const { ride, bus, to, phases, seconds } = runRide(fromId, toId);
        expect(ride.phase, `${fromId} -> ${toId}`).toBe('selesai');
        // Urutan pengalaman: bus datang, pemain naik, bus jalan, pemain turun.
        for (const phase of ['menunggu', 'naik', 'jalan', 'turun']) expect(phases.has(phase)).toBe(true);
        expect(rideProgress(ride)).toBe(1);
        // Bus benar-benar berhenti dekat halte tujuan (lajur berjarak beberapa meter dari trotoar).
        const pose = busPose(graph, route, { ...bus, wait: 0, nextStop: 0 });
        expect(Math.hypot(pose.x - to.x, pose.z - to.z)).toBeLessThan(15);
        longest = Math.max(longest, seconds);
      }
    }
    // "Jangan menyiksa": perjalanan terjauh tetap di bawah ~2 menit.
    expect(longest).toBeLessThan(120);
  });

  it('berhenti di halte perantara dan menampilkan nama halte berikutnya', () => {
    const [first, , third] = ids;
    if (!first || !third) throw new Error('halte kurang');
    const { ride, nextStops } = runRide(first, third);
    expect(ride.mid.length).toBeGreaterThan(0);
    expect(nextStops.has(third)).toBe(true);
    for (const mid of ride.mid) expect(nextStops.has(mid.id)).toBe(true);
  });

  it('ETA turun seiring perjalanan dan pemain di dalam bus hanya saat naik/jalan/turun', () => {
    const [a, b] = ids;
    const from = stops.find((stop) => stop.id === a);
    const to = stops.find((stop) => stop.id === b);
    if (!from || !to) throw new Error('halte tidak ada');
    const bus = { leg: 0, s: 0 };
    const ride = startBusRide(graph, route, bus, from, to);
    if (!ride) throw new Error('perjalanan gagal dibuat');
    expect(rideOnBoard(ride)).toBe(false);
    const eta0 = rideEtaSeconds(ride);
    for (let i = 0; i < 200 && ride.phase !== 'jalan'; i++) stepBusRide(graph, route, bus, ride, DT);
    expect(rideOnBoard(ride)).toBe(true);
    for (let i = 0; i < 60; i++) stepBusRide(graph, route, bus, ride, DT);
    expect(rideEtaSeconds(ride)).toBeLessThan(eta0);
  });

  it('fallback: rute kosong atau halte yang sama -> null (pemanggil pakai fast travel lama)', () => {
    const [a, b] = stops;
    if (!a || !b) throw new Error('halte kurang');
    expect(startBusRide(graph, { edges: [], stops: [] }, { leg: 0, s: 0 }, a, b)).toBeNull();
    expect(startBusRide(graph, route, { leg: 0, s: 0 }, a, a)).toBeNull();
  });

  it('timeout: perjalanan yang macet jatuh ke fase gagal, tidak menahan pemain selamanya', () => {
    const [a, b] = ids;
    const from = stops.find((stop) => stop.id === a);
    const to = stops.find((stop) => stop.id === b);
    if (!from || !to) throw new Error('halte tidak ada');
    const ride = startBusRide(graph, route, { leg: 0, s: 0 }, from, to);
    if (!ride) throw new Error('perjalanan gagal dibuat');
    // dt nol = bus tidak pernah maju; elapsed dipaksa lewat batas lewat satu langkah besar.
    stepBusRide(graph, route, { leg: 0, s: 0 }, ride, RIDE_TIMEOUT + 1);
    expect(ride.phase).toBe('gagal');
  });

  it('jarak maju di rute tertutup selalu dalam [0, panjang rute)', () => {
    const loop = routeLength(graph, route);
    expect(loop).toBeGreaterThan(0);
    for (const stop of route.stops) {
      const d = forwardDistance(graph, route, { leg: 0, s: 0 }, stop);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThan(loop);
    }
    expect(BOARD_TIME).toBeGreaterThan(0);
  });
});

describe('pengendara motor warga', () => {
  it('memakai pose motor apa adanya (menghadap arah jalan) dan pinggulnya di atas jok', () => {
    for (const [dirX, dirZ] of [[0, -1], [1, 0], [0, 1], [-Math.SQRT1_2, Math.SQRT1_2]] as const) {
      const pose = motoRiderPose({ x: 10, z: -4, dirX, dirZ }, 2);
      // Heading 0 = -Z: arah hadap (-sin, -cos) harus sama dengan arah jalan.
      expect(-Math.sin(pose.heading)).toBeCloseTo(dirX, 6);
      expect(-Math.cos(pose.heading)).toBeCloseTo(dirZ, 6);
      expect(pose.x).toBe(10);
      expect(pose.z).toBe(-4);
      expect(pose.hipY).toBeCloseTo(2 + MOTO_RIDER.seatY, 6);
      // Jok ada di belakang pivot motor, jadi pinggul tergeser berlawanan arah jalan.
      expect((pose.hipX - 10) * dirX + (pose.hipZ + 4) * dirZ).toBeCloseTo(-MOTO_RIDER.seatZ, 6);
    }
  });

  it('warna pengendara stabil per kendaraan dan bervariasi', () => {
    expect(riderTint(5)).toBe(riderTint(5));
    expect(new Set([0, 1, 2, 3, 4, 5, 6].map(riderTint)).size).toBe(RIDER_TINTS.length);
    expect(RIDER_TINTS).toContain(riderTint(-3));
  });
});

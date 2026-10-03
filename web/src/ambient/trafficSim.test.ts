import { describe, expect, it } from 'vitest';
import { bakeLanes } from '../../tools/world/lanes';
import { mulberry32 } from '../world/worldGen';
import { buildLaneGraph, edgeAt } from './laneGraph';
import { createTraffic, createVehicle, lerpPose, safeGap, stepTraffic, stepTrafficTiered, TICK_HZ_NEAR, VEHICLE_LENGTH, vehiclePose } from './trafficSim';

const graph = buildLaneGraph(bakeLanes());

/** Isi lajur dengan kendaraan berjarak aman, mulai dari segmen lajur. */
function seedTraffic(count: number, seed: number) {
  const random = mulberry32(seed);
  const lanes = graph.data.edges.flatMap((edge, index) => (edge.kind === 'lane' ? [index] : []));
  const vehicles = [];
  for (let i = 0; i < count; i++) {
    // Dua kendaraan per segmen lajur, berjarak aman, supaya car-following ikut teruji.
    const edge = lanes[Math.floor(i / 2) % lanes.length] as number;
    vehicles.push(createVehicle(graph, i, edge, 2 + (i % 2) * 14, 8 + random() * 6, random));
  }
  return { state: createTraffic(vehicles), random };
}

describe('simulasi lalu lintas', () => {
  it('rumus jarak aman 2 m + 0.8 detik x kecepatan', () => {
    expect(safeGap(0)).toBe(2);
    expect(safeGap(10)).toBe(10);
  });

  it('10.000 tick tanpa tabrakan dan tanpa deadlock', () => {
    const { state, random } = seedTraffic(160, 42);
    const dt = 1 / TICK_HZ_NEAR;
    const stalled = new Map<number, number>();
    let maxStall = 0;
    let minGap = Number.POSITIVE_INFINITY;
    let isecViolations = 0;
    for (let tick = 0; tick < 10_000; tick++) {
      stepTraffic(graph, state, dt, random);
      // Tabrakan: dua kendaraan di edge yang sama, atau di edge berurutan, lebih dekat dari panjang kendaraan.
      for (const a of state.vehicles) {
        for (const b of state.vehicles) {
          if (a === b) continue;
          if (a.edge === b.edge && b.s >= a.s) minGap = Math.min(minGap, b.s - a.s);
          if (b.edge === a.next) minGap = Math.min(minGap, edgeAt(graph, a.edge).length - a.s + b.s);
        }
        // Di dalam persimpangan hanya pemegang reservasi.
        const isec = edgeAt(graph, a.edge).isec;
        if (isec >= 0 && state.reserved.get(isec) !== a.id) isecViolations++;
        const idle = a.speed < 0.05 ? (stalled.get(a.id) ?? 0) + 1 : 0;
        stalled.set(a.id, idle);
        maxStall = Math.max(maxStall, idle);
      }
    }
    expect(minGap).toBeGreaterThanOrEqual(VEHICLE_LENGTH);
    expect(isecViolations).toBe(0);
    // Deadlock = ada kendaraan yang berhenti terus. Batas 60 detik.
    expect(maxStall).toBeLessThan(60 * TICK_HZ_NEAR);
    const pose = vehiclePose(graph, state.vehicles[0] ?? createVehicle(graph, 0, 0, 0, 10, random));
    expect(Math.hypot(pose.dirX, pose.dirZ)).toBeCloseTo(1, 3);
  }, 120_000);

  it('mobil di belakang mengerem saat ada mobil berhenti di depan', () => {
    const random = mulberry32(1);
    const lane = graph.data.edges.findIndex((edge) => edge.kind === 'lane');
    const front = createVehicle(graph, 1, lane, 18, 0, random);
    const back = createVehicle(graph, 2, lane, 0, 12, random);
    back.speed = 0;
    const state = createTraffic([front, back]);
    for (let tick = 0; tick < 300; tick++) stepTraffic(graph, state, 1 / TICK_HZ_NEAR, random);
    expect(front.s - back.s).toBeGreaterThanOrEqual(VEHICLE_LENGTH + 2 - 0.01);
    expect(back.speed).toBeLessThan(0.1);
  });

  it('kendaraan jauh maju 5 Hz, kendaraan dekat 15 Hz, jarak tempuh sama', () => {
    const random = mulberry32(3);
    const lanes = graph.data.edges.flatMap((edge, index) => (edge.kind === 'lane' && edge.length > 20 ? [index] : []));
    const near = createVehicle(graph, 1, lanes[0] as number, 0, 6, random);
    const far = createVehicle(graph, 2, lanes[1] as number, 0, 6, random);
    const state = createTraffic([near, far]);
    const moves: number[] = [];
    for (let tick = 1; tick <= 6; tick++) {
      const before = far.s;
      stepTrafficTiered(graph, state, tick, random, (vehicle) => vehicle === near);
      moves.push(far.s - before);
    }
    expect(moves.filter((move) => move > 0).length).toBe(2);
    expect(near.s).toBeCloseTo(far.s, 5);
  });
});

describe('interpolasi pose kendaraan antar tick', () => {
  const prev = { x: 0, z: 0, dirX: 1, dirZ: 0 };
  const next = { x: 2, z: 0, dirX: 0, dirZ: 1 };

  it('lerp linear sesuai sisa akumulator dan dijepit 0..1', () => {
    expect(lerpPose(prev, next, 0)).toEqual(prev);
    expect(lerpPose(prev, next, 0.5)).toEqual({ x: 1, z: 0, dirX: 0.5, dirZ: 0.5 });
    expect(lerpPose(prev, next, 2)).toEqual(next);
  });

  it('tanpa pose sebelumnya atau setelah teleport langsung memakai pose baru', () => {
    expect(lerpPose(undefined, next, 0.3)).toBe(next);
    expect(lerpPose(prev, { ...next, x: 50 }, 0.3).x).toBe(50);
  });
});

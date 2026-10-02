import { describe, expect, it } from 'vitest';
import { bakeLanes } from '../../tools/world/lanes';
import { mulberry32 } from '../world/worldGen';
import { buildLaneGraph, edgeAt } from './laneGraph';
import { AXIS_COUNT, CYCLE_SECONDS, edgeAxis, GREEN_SECONDS, lampAt, signalBlocks, signalisedIntersections, YELLOW_SECONDS } from './trafficLights';
import { createTraffic, createVehicle, playerGap, stepTraffic, TICK_HZ_NEAR, VEHICLE_LENGTH, vehiclePose } from './trafficSim';

const graph = buildLaneGraph(bakeLanes());

describe('siklus lampu lalu lintas', () => {
  it('tepat satu arah hijau pada satu waktu', () => {
    for (let step = 0; step < 240; step++) {
      const time = step * 0.05;
      const green = [0, 1].filter((axis) => lampAt(3, axis, time) === 'green');
      expect(green.length).toBeLessThanOrEqual(1);
    }
  });

  it('tidak ada arah yang terlewat dalam satu periode, dan kuning 2 detik', () => {
    const seen = new Map<number, Set<string>>();
    for (let step = 0; step < CYCLE_SECONDS * 100; step++) {
      const time = step / 100;
      for (let axis = 0; axis < AXIS_COUNT; axis++) {
        const set = seen.get(axis) ?? new Set<string>();
        set.add(lampAt(7, axis, time));
        seen.set(axis, set);
      }
    }
    for (let axis = 0; axis < AXIS_COUNT; axis++) {
      expect(seen.get(axis)).toEqual(new Set(['red', 'yellow', 'green']));
    }
    // Durasi: hijau 4 detik lalu kuning 2 detik, sisanya merah.
    const duration = (axis: number, want: string) => {
      let count = 0;
      for (let step = 0; step < CYCLE_SECONDS * 1000; step++) if (lampAt(0, axis, step / 1000) === want) count++;
      return count / 1000;
    };
    expect(duration(0, 'yellow')).toBeCloseTo(YELLOW_SECONDS, 1);
    expect(duration(0, 'green')).toBeCloseTo(GREEN_SECONDS, 1);
    expect(duration(1, 'red')).toBeCloseTo(CYCLE_SECONDS - YELLOW_SECONDS - GREEN_SECONDS, 1);
  });

  it('hanya persimpangan Pusat Kota yang berlampu', () => {
    const signalised = signalisedIntersections(graph);
    expect(signalised.length).toBeGreaterThan(0);
    expect(signalised.length).toBeLessThan(graph.data.intersections.length);
  });

  it('kendaraan berhenti di lampu merah lalu jalan lagi saat hijau', () => {
    const isec = signalisedIntersections(graph)[0] as number;
    // Lajur yang masuk ke persimpangan berlampu ini.
    const turn = graph.data.edges.findIndex((edge) => edge.isec === isec);
    const lane = graph.data.edges.findIndex((edge) => edge.kind === 'lane' && edge.b === (edgeAt(graph, turn).a as number));
    expect(lane).toBeGreaterThanOrEqual(0);

    const random = mulberry32(5);
    const vehicle = createVehicle(graph, 1, lane, edgeAt(graph, lane).length - 20, 10, random);
    const state = createTraffic([vehicle]);
    const dt = 1 / TICK_HZ_NEAR;
    // Waktu beku saat merah: kendaraan berhenti sebelum garis dan tidak masuk persimpangan.
    let red = 0;
    while (lampAt(isec, edgeAxis(graph, lane), red) !== 'red') red += 0.1;
    for (let tick = 0; tick < 300; tick++) stepTraffic(graph, state, dt, random, { gate: (edge, next) => signalBlocks(graph, red, edge, next) });
    expect(vehicle.edge).toBe(lane);
    expect(vehicle.speed).toBeLessThan(0.1);
    expect(edgeAt(graph, lane).length - vehicle.s).toBeLessThan(VEHICLE_LENGTH);

    // Lampu dibuka: kendaraan melewati persimpangan.
    for (let tick = 0; tick < 300; tick++) stepTraffic(graph, state, dt, random);
    expect(vehicle.edge).not.toBe(lane);
  });
});

describe('interaksi dengan pemain', () => {
  it('kendaraan berhenti sebelum menabrak pemain yang berdiri di lajurnya', () => {
    const random = mulberry32(9);
    const lane = graph.data.edges.findIndex((edge) => edge.kind === 'lane' && edge.length > 20);
    const vehicle = createVehicle(graph, 1, lane, 0, 10, random);
    const state = createTraffic([vehicle]);
    const ahead = { ...vehiclePose(graph, createVehicle(graph, 2, lane, 18, 0, random)), radius: 0.4 };
    const player = { x: ahead.x, z: ahead.z, radius: ahead.radius };
    for (let tick = 0; tick < 300; tick++) {
      stepTraffic(graph, state, 1 / TICK_HZ_NEAR, random, { obstacleGap: (v) => playerGap(graph, v, player) });
    }
    expect(vehicle.speed).toBeLessThan(0.1);
    expect(18 - vehicle.s).toBeGreaterThan(VEHICLE_LENGTH / 2 + player.radius);
    // Pemain di samping lajur tidak menghalangi.
    expect(playerGap(graph, vehicle, { x: player.x + 30, z: player.z + 30, radius: 0.4 })).toBe(Number.POSITIVE_INFINITY);
  });
});

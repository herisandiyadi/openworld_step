import { describe, expect, it } from 'vitest';
import { bakeLanes } from '../../tools/world/lanes';
import { mulberry32 } from '../world/worldGen';
import { buildLaneGraph, edgePoint } from './laneGraph';
import { type CameraView, DESPAWN, inView, SPAWN_MAX, SPAWN_MIN, updateSpawns, VEHICLE_POOL, vehiclePoolFor } from './spawner';
import { createTraffic, createVehicle } from './trafficSim';

const graph = buildLaneGraph(bakeLanes());
const DEG = Math.PI / 180;

describe('spawner', () => {
  it('tidak pernah spawn di dalam frustum kamera dan selalu di cincin 40-110 m', () => {
    const random = mulberry32(99);
    let id = 0;
    for (let trial = 0; trial < 200; trial++) {
      const angle = random() * Math.PI * 2;
      const view: CameraView = {
        x: (random() - 0.5) * 300,
        z: (random() - 0.5) * 300,
        dirX: Math.sin(angle),
        dirZ: Math.cos(angle),
        halfFov: (30 + random() * 30) * DEG,
      };
      const state = createTraffic();
      const { spawned } = updateSpawns(graph, state, view, 'high', random, () => id++);
      for (const vehicle of spawned) {
        const point = edgePoint(graph, vehicle.edge, vehicle.s);
        const distance = Math.hypot(point.x - view.x, point.z - view.z);
        expect(inView(view, point.x, point.z)).toBe(false);
        expect(distance).toBeGreaterThanOrEqual(SPAWN_MIN);
        expect(distance).toBeLessThanOrEqual(SPAWN_MAX);
      }
      expect(state.vehicles.length).toBeLessThanOrEqual(VEHICLE_POOL.high);
    }
  });

  it('mengisi pool sesuai preset dan despawn di luar 130 m', () => {
    const random = mulberry32(5);
    let id = 0;
    const view: CameraView = { x: 0, z: 0, dirX: 0, dirZ: -1, halfFov: 35 * DEG };
    for (const preset of ['low', 'medium', 'high'] as const) {
      const state = createTraffic();
      updateSpawns(graph, state, view, preset, random, () => id++);
      expect(state.vehicles.length).toBeGreaterThanOrEqual(VEHICLE_POOL[preset] - 2);
    }
    expect(VEHICLE_POOL).toEqual({ low: 8, medium: 16, high: 24 });

    const state = createTraffic();
    const far = graph.data.edges.findIndex((edge, index) => {
      const point = edgePoint(graph, index, edge.length / 2);
      return Math.hypot(point.x, point.z) > DESPAWN + 10;
    });
    state.vehicles.push(createVehicle(graph, 999, far, 1, 10, random));
    const { despawned } = updateSpawns(graph, state, view, 'low', random, () => id++);
    expect(despawned).toBe(1);
    expect(state.vehicles.some((vehicle) => vehicle.id === 999)).toBe(false);
  });

  it('pool kendaraan dibatasi quality tier render supaya budget HP low-end aman', () => {
    expect(vehiclePoolFor('high', 'high')).toBe(VEHICLE_POOL.high);
    expect(vehiclePoolFor('high', 'medium')).toBe(VEHICLE_POOL.medium);
    expect(vehiclePoolFor('high', 'low')).toBe(VEHICLE_POOL.low);
    expect(vehiclePoolFor('low', 'high')).toBe(VEHICLE_POOL.low);
    for (const quality of ['low', 'medium', 'high'] as const) expect(vehiclePoolFor('high', quality)).toBeLessThanOrEqual(VEHICLE_POOL.high);
  });

  it('updateSpawns menghormati batas quality tier', () => {
    const random = mulberry32(7);
    let id = 0;
    const view: CameraView = { x: 0, z: 0, dirX: 0, dirZ: -1, halfFov: 35 * DEG };
    const state = createTraffic();
    updateSpawns(graph, state, view, 'high', random, () => id++, 11, 'low');
    expect(state.vehicles.length).toBe(VEHICLE_POOL.low);
  });
});

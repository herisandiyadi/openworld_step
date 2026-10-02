import { describe, expect, it } from 'vitest';
import { bakeLanes } from '../../tools/world/lanes';
import { busDestinations } from '../game/busRoutes';
import { generateWorld } from '../world/worldGen';
import { BUS_PAUSE, busPose, createBus, planBusRoute, stepBus } from './busRoute';
import { buildLaneGraph, edgeAt } from './laneGraph';

const graph = buildLaneGraph(bakeLanes());
const stops = generateWorld(1337).index.busStops;
const route = planBusRoute(graph, stops);

describe('rute bus kota', () => {
  it('rute tertutup yang tersambung dan sama dengan halte menu fast travel', () => {
    expect(route.stops.map((stop) => stop.id)).toEqual(busDestinations(stops, null).map((d) => d.stop.id));
    route.edges.forEach((edge, i) => {
      const next = route.edges[(i + 1) % route.edges.length] as number;
      expect(edgeAt(graph, next).a).toBe(edgeAt(graph, edge).b);
    });
  });

  it('berhenti 4 detik di tiap halte dan melewati semua halte berurutan', () => {
    const bus = createBus();
    const dt = 1 / 15;
    const visited: string[] = [];
    let stopped = 0;
    for (let tick = 0; tick < 15 * 60 * 20 && visited.length < route.stops.length + 1; tick++) {
      const before = bus.wait;
      stepBus(graph, route, bus, dt);
      if (bus.wait > 0) stopped += dt;
      if (before === 0 && bus.wait === BUS_PAUSE) {
        const previous = (bus.nextStop + route.stops.length - 1) % route.stops.length;
        visited.push(route.stops[previous]?.id ?? '');
      }
    }
    const ids = route.stops.map((stop) => stop.id);
    // Putaran kedua dimulai lagi dari halte pertama.
    expect(visited).toEqual([...ids, ids[0]]);
    expect(stopped).toBeGreaterThanOrEqual(BUS_PAUSE * ids.length - 0.5);
    const pose = busPose(graph, route, bus);
    expect(Math.hypot(pose.dirX, pose.dirZ)).toBeCloseTo(1, 3);
  });
});

/**
 * Rute bus kota (B9): satu bus mengelilingi halte-halte fast travel secara berulang,
 * berhenti 4 detik di tiap halte. Murni TypeScript tanpa three.js supaya bisa di-unit-test.
 * Halte yang dipakai sama dengan menu fast travel (`game/busRoutes.ts`), jadi bus benar-benar
 * melewati tujuan yang bisa dipilih pemain.
 */
import { busDestinations } from '../game/busRoutes';
import type { BusStop } from '../world/worldSpec';
import { edgeAt, edgeHeading, edgePoint, type LaneGraph, nearestEdge } from './laneGraph';

/** Jeda di tiap halte (detik). */
export const BUS_PAUSE = 4;
export const BUS_SPEED = 9;
/** Bus berhenti di lajur, jadi halte dianggap tercapai di titik terdekatnya pada lajur. */
export interface BusStopOnRoute {
  id: string;
  /** Indeks leg (posisi di `edges`) tempat bus berhenti. */
  leg: number;
  /** Posisi 1D di sepanjang edge leg itu (m). */
  s: number;
}

export interface BusRoute {
  /** Urutan edge yang dilewati; bus kembali ke edges[0] setelah leg terakhir. */
  edges: number[];
  stops: BusStopOnRoute[];
}

export interface BusState {
  leg: number;
  s: number;
  /** Sisa waktu berhenti di halte (detik). */
  wait: number;
  /** Indeks halte berikutnya di `route.stops`. */
  nextStop: number;
}

/** Jalur edge terpendek dari `from` ke `to` (BFS pada graf lajur, termasuk belokan). */
export function findEdgePath(graph: LaneGraph, from: number, to: number): number[] {
  if (from === to) return [from];
  const previous = new Map<number, number>([[from, -1]]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head] as number;
    for (const next of graph.outgoing[edgeAt(graph, current).b] ?? []) {
      if (previous.has(next)) continue;
      previous.set(next, current);
      if (next === to) {
        const path = [next];
        for (let step = current; step >= 0; step = previous.get(step) ?? -1) path.unshift(step);
        return path;
      }
      queue.push(next);
    }
  }
  return [];
}

/** Rute tertutup yang melewati halte-halte menu fast travel, berurutan lalu balik ke awal. */
export function planBusRoute(graph: LaneGraph, stops: readonly BusStop[]): BusRoute {
  const chosen = busDestinations(stops, null).map((destination) => destination.stop);
  const edges: number[] = [];
  const route: BusStopOnRoute[] = [];
  if (chosen.length === 0) return { edges, stops: route };

  const hits = chosen.map((stop) => ({ stop, hit: nearestEdge(graph, stop.x, stop.z) }));
  for (let i = 0; i < hits.length; i++) {
    const current = hits[i] as (typeof hits)[number];
    const next = hits[(i + 1) % hits.length] as (typeof hits)[number];
    // Leg pertama dimulai di edge halte pertama; berikutnya menyambung tanpa mengulang edge.
    const path = findEdgePath(graph, current.hit.edge, next.hit.edge);
    if (path.length === 0) continue;
    if (edges.length === 0) edges.push(path[0] as number);
    route.push({ id: current.stop.id, leg: edges.length - 1, s: current.hit.s });
    for (const edge of path.slice(1, i + 1 === hits.length ? -1 : undefined)) edges.push(edge);
  }
  return { edges, stops: route };
}

export const createBus = (): BusState => ({ leg: 0, s: 0, wait: 0, nextStop: 0 });

const legEdge = (route: BusRoute, leg: number): number => route.edges[leg % route.edges.length] as number;

/** Satu tick bus: berhenti di halte selama BUS_PAUSE, selain itu melaju BUS_SPEED. */
export function stepBus(graph: LaneGraph, route: BusRoute, bus: BusState, dt: number, speed = BUS_SPEED): void {
  if (route.edges.length === 0) return;
  if (bus.wait > 0) {
    bus.wait = Math.max(0, bus.wait - dt);
    return;
  }
  bus.s += speed * dt;

  const target = route.stops[bus.nextStop];
  if (target && bus.leg === target.leg && bus.s >= target.s) {
    bus.s = target.s;
    bus.wait = BUS_PAUSE;
    bus.nextStop = (bus.nextStop + 1) % route.stops.length;
    return;
  }

  let length = edgeAt(graph, legEdge(route, bus.leg)).length;
  while (bus.s >= length) {
    bus.s -= length;
    bus.leg = (bus.leg + 1) % route.edges.length;
    // Satu putaran penuh: halte berikutnya kembali ke halte pertama.
    if (bus.leg === 0) bus.nextStop = 0;
    length = edgeAt(graph, legEdge(route, bus.leg)).length;
  }
}

/** Posisi dan arah hadap dunia bus. */
export function busPose(graph: LaneGraph, route: BusRoute, bus: BusState): { x: number; z: number; dirX: number; dirZ: number } {
  const edge = legEdge(route, bus.leg);
  const point = edgePoint(graph, edge, bus.s);
  const heading = edgeHeading(graph, edge, bus.s);
  return { x: point.x, z: point.z, dirX: heading.x, dirZ: heading.z };
}

import { describe, expect, it } from 'vitest';
import { bakeLanes } from '../../tools/world/lanes';
import { generateWorld } from '../world/worldGen';
import { BLOCK_PITCH, ROAD_WIDTH } from '../world/worldSpec';
import { buildLaneGraph, edgeAt, edgePoint, LANE_OFFSET, nearestEdge, nextEdge } from './laneGraph';

const data = bakeLanes();
const graph = buildLaneGraph(data);
const buildings = generateWorld(1337).chunks.flatMap((chunk) => chunk.buildings);
const mulberry = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe('bake graf lajur', () => {
  it('menghasilkan graf yang tidak kosong dan deterministik', () => {
    expect(data.edges.length).toBeGreaterThan(100);
    expect(data.intersections.length).toBeGreaterThan(10);
    expect(JSON.stringify(bakeLanes())).toBe(JSON.stringify(data));
  });

  it('semua edge terhubung dan tidak ada jalan buntu', () => {
    for (const edge of data.edges) {
      expect(graph.outgoing[edge.b]?.length ?? 0).toBeGreaterThan(0);
      expect(graph.outgoing[edge.a]?.length ?? 0).toBeGreaterThan(0);
      expect(edge.length).toBeGreaterThan(0.5);
    }
    // Setiap node dipakai sebagai ujung awal maupun ujung akhir oleh paling tidak satu edge.
    const incoming = new Set(data.edges.map((edge) => edge.b));
    const outgoing = new Set(data.edges.map((edge) => edge.a));
    expect(outgoing.size).toBe(data.nodes.length);
    expect(incoming.size).toBe(data.nodes.length);
  });

  it('seluruh graf bisa dijangkau dari satu edge', () => {
    const seen = new Set<number>([0]);
    const queue = [0];
    while (queue.length > 0) {
      const index = queue.pop() as number;
      for (const next of graph.outgoing[edgeAt(graph, index).b] ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    expect(seen.size).toBe(data.edges.length);
  });

  it('menempatkan lajur 2 m dari garis tengah jalan di sisi kiri', () => {
    const laneEdge = data.edges.find((edge) => edge.kind === 'lane');
    if (!laneEdge) throw new Error('tidak ada segmen lajur');
    const a = data.nodes[laneEdge.a];
    const b = data.nodes[laneEdge.b];
    if (!a || !b) throw new Error('node hilang');
    // Lajur sejajar garis tengah jalan (kelipatan BLOCK_PITCH), berjarak LANE_OFFSET ke kiri.
    const offAxis = a.x === b.x ? a.x : a.z;
    const toCenterLine = Math.abs((((offAxis + BLOCK_PITCH / 2) % BLOCK_PITCH) + BLOCK_PITCH) % BLOCK_PITCH - BLOCK_PITCH / 2);
    expect(toCenterLine).toBeCloseTo(LANE_OFFSET, 6);
    // Dua arah: tiap jalan punya lajur di kedua sisi garis tengah.
    const signs = new Set(
      data.edges
        .filter((edge) => edge.kind === 'lane')
        .map((edge) => {
          const from = data.nodes[edge.a];
          const to = data.nodes[edge.b];
          return from && to ? Math.sign(to.x - from.x) + 2 * Math.sign(to.z - from.z) : 0;
        }),
    );
    expect(signs.size).toBe(4);
  });

  it('tidak ada edge yang menembus gedung dan semua tetap di badan jalan', () => {
    const half = ROAD_WIDTH / 2;
    let inBuilding = 0;
    let offRoad = 0;
    for (let index = 0; index < data.edges.length; index++) {
      const edge = edgeAt(graph, index);
      const steps = Math.max(2, Math.ceil(edge.length));
      for (let k = 0; k <= steps; k++) {
        const point = edgePoint(graph, index, (edge.length * k) / steps);
        if (buildings.some((box) => point.x > box.minX && point.x < box.maxX && point.z > box.minZ && point.z < box.maxZ)) {
          inBuilding++;
        }
        const lx = Math.abs((((point.x + BLOCK_PITCH / 2) % BLOCK_PITCH) + BLOCK_PITCH) % BLOCK_PITCH - BLOCK_PITCH / 2);
        const lz = Math.abs((((point.z + BLOCK_PITCH / 2) % BLOCK_PITCH) + BLOCK_PITCH) % BLOCK_PITCH - BLOCK_PITCH / 2);
        if (Math.min(lx, lz) > half + 1e-6) offRoad++;
      }
    }
    expect(inBuilding).toBe(0);
    expect(offRoad).toBe(0);
  });

  it('membake graf trotoar dan zebra cross (C1)', () => {
    expect(data.walkEdges.filter((edge) => edge.cross).length).toBeGreaterThan(data.intersections.length * 3);
    expect(data.walkEdges.some((edge) => !edge.cross)).toBe(true);
    const degree = data.walkNodes.map(() => 0);
    for (const edge of data.walkEdges) {
      degree[edge.a] = (degree[edge.a] ?? 0) + 1;
      degree[edge.b] = (degree[edge.b] ?? 0) + 1;
    }
    expect(Math.min(...degree)).toBeGreaterThanOrEqual(2);
    for (const edge of data.walkEdges) expect(edge.length).toBeGreaterThan(0.5);
  });
});

describe('query graf lajur', () => {
  it('mencari edge terdekat dan mengubah posisi 1D ke dunia', () => {
    for (let index = 0; index < data.edges.length; index += 37) {
      const edge = edgeAt(graph, index);
      const mid = edgePoint(graph, index, edge.length / 2);
      const hit = nearestEdge(graph, mid.x, mid.z);
      expect(hit.distance).toBeLessThan(0.5);
      const back = edgePoint(graph, hit.edge, hit.s);
      expect(Math.hypot(back.x - mid.x, back.z - mid.z)).toBeLessThan(0.6);
    }
  });

  it('ujung edge sama dengan posisi node-nya', () => {
    const edge = edgeAt(graph, 0);
    const a = data.nodes[edge.a];
    const b = data.nodes[edge.b];
    expect(edgePoint(graph, 0, 0)).toEqual(a);
    const end = edgePoint(graph, 0, edge.length);
    expect(Math.hypot(end.x - (b?.x ?? 0), end.z - (b?.z ?? 0))).toBeLessThan(0.01);
  });

  it('memilih edge berikutnya yang nyambung dan bisa bervariasi di persimpangan', () => {
    const random = mulberry(7);
    const laneIndex = data.edges.findIndex((edge) => edge.kind === 'lane');
    const picks = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const next = nextEdge(graph, laneIndex, random);
      expect(edgeAt(graph, next).a).toBe(edgeAt(graph, laneIndex).b);
      picks.add(edgeAt(graph, next).kind);
    }
    expect(picks.size).toBeGreaterThan(1);
  });
});

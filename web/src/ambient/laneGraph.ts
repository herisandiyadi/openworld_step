/**
 * Kontrak data dan query runtime untuk graf lajur (`public/world/lanes.json`).
 * Murni TypeScript tanpa three.js supaya bisa di-unit-test dan dipindah ke web worker.
 * Satuan meter, +Y up. Lalu lintas Indonesia: lajur kiri, ofset 2 m dari garis tengah jalan.
 */
import { CHUNK_SIZE, HALF_WORLD, WORLD_CHUNKS } from '../world/worldSpec';

/** Jarak lajur dari garis tengah jalan. */
export const LANE_OFFSET = 2;

/** `lane` = segmen antar persimpangan, sisanya adalah belokan di dalam persimpangan. */
export type LaneEdgeKind = 'lane' | 'straight' | 'left' | 'right';

export interface LaneNode {
  x: number;
  z: number;
}

export interface LaneEdge {
  /** Indeks node awal dan akhir di `LanesData.nodes`. */
  a: number;
  b: number;
  kind: LaneEdgeKind;
  /** Panjang kurva (m), dipakai sebagai sumbu posisi 1D oleh simulasi. */
  length: number;
  /** Indeks persimpangan yang dipakai edge ini, atau -1 untuk segmen lajur biasa. */
  isec: number;
  /** Titik kontrol Bezier kuadratik; tidak ada berarti edge lurus. */
  cx?: number;
  cz?: number;
}

/** Graf trotoar: tak berarah, `cross` menandai zebra cross yang menyeberangi jalan. */
export interface WalkEdge {
  a: number;
  b: number;
  length: number;
  cross: boolean;
}

/** Isi `public/world/lanes.json`. */
export interface LanesData {
  version: number;
  nodes: LaneNode[];
  edges: LaneEdge[];
  /** Titik tengah tiap persimpangan; indeksnya dipakai untuk reservasi. */
  intersections: LaneNode[];
  walkNodes: LaneNode[];
  walkEdges: WalkEdge[];
}

export interface LaneGraph {
  data: LanesData;
  /** Edge yang keluar dari tiap node. */
  outgoing: number[][];
  /** Bucket per chunk -> indeks edge, untuk pencarian edge terdekat. */
  grid: Map<number, number[]>;
}

/** Jumlah titik sampel per edge untuk panjang, proyeksi, dan pencarian terdekat. */
const SAMPLES = 6;

const bucketOf = (x: number, z: number): number => {
  const bx = Math.min(WORLD_CHUNKS - 1, Math.max(0, Math.floor((x + HALF_WORLD) / CHUNK_SIZE)));
  const bz = Math.min(WORLD_CHUNKS - 1, Math.max(0, Math.floor((z + HALF_WORLD) / CHUNK_SIZE)));
  return bz * WORLD_CHUNKS + bx;
};

export function buildLaneGraph(data: LanesData): LaneGraph {
  const outgoing = data.nodes.map(() => [] as number[]);
  const grid = new Map<number, number[]>();
  data.edges.forEach((edge, index) => {
    outgoing[edge.a]?.push(index);
    const a = data.nodes[edge.a];
    const b = data.nodes[edge.b];
    if (!a || !b) throw new Error(`edge ${index} menunjuk node yang tidak ada`);
    const key = bucketOf((a.x + b.x) / 2, (a.z + b.z) / 2);
    const bucket = grid.get(key);
    if (bucket) bucket.push(index);
    else grid.set(key, [index]);
  });
  return { data, outgoing, grid };
}

const node = (graph: LaneGraph, index: number): LaneNode => {
  const value = graph.data.nodes[index];
  if (!value) throw new Error(`node ${index} tidak ada`);
  return value;
};

export const edgeAt = (graph: LaneGraph, index: number): LaneEdge => {
  const edge = graph.data.edges[index];
  if (!edge) throw new Error(`edge ${index} tidak ada`);
  return edge;
};

/** Titik pada edge untuk parameter kurva t (0..1). */
function pointAtT(graph: LaneGraph, index: number, t: number): LaneNode {
  const edge = edgeAt(graph, index);
  const a = node(graph, edge.a);
  const b = node(graph, edge.b);
  if (edge.cx === undefined || edge.cz === undefined) {
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
  }
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * edge.cx + t * t * b.x,
    z: u * u * a.z + 2 * u * t * edge.cz + t * t * b.z,
  };
}

/**
 * Konversi posisi 1D di sepanjang edge (meter) ke koordinat dunia XZ.
 * ponytail: untuk belokan, t dianggap sebanding dengan panjang busur (galat < 3% pada radius ini);
 * ganti dengan tabel arclength kalau belokan terasa tidak rata.
 */
export const edgePoint = (graph: LaneGraph, index: number, s: number): LaneNode =>
  pointAtT(graph, index, Math.min(1, Math.max(0, s / edgeAt(graph, index).length)));

/** Arah hadap (unit) di posisi 1D s. */
export function edgeHeading(graph: LaneGraph, index: number, s: number): LaneNode {
  const length = edgeAt(graph, index).length;
  const step = Math.min(0.5, length / 8);
  const back = edgePoint(graph, index, Math.max(0, Math.min(length - step, s - step / 2)));
  const front = edgePoint(graph, index, Math.max(step, Math.min(length, s + step / 2)));
  const dx = front.x - back.x;
  const dz = front.z - back.z;
  const len = Math.hypot(dx, dz) || 1;
  return { x: dx / len, z: dz / len };
}

/** Jarak titik ke edge plus posisi 1D terdekatnya. */
function projectOnEdge(graph: LaneGraph, index: number, x: number, z: number): { s: number; distance: number } {
  const edge = edgeAt(graph, index);
  const steps = edge.cx === undefined ? 1 : SAMPLES;
  let best = { s: 0, distance: Number.POSITIVE_INFINITY };
  let from = pointAtT(graph, index, 0);
  for (let i = 0; i < steps; i++) {
    const to = pointAtT(graph, index, (i + 1) / steps);
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const lengthSq = dx * dx + dz * dz || 1;
    const t = Math.min(1, Math.max(0, ((x - from.x) * dx + (z - from.z) * dz) / lengthSq));
    const distance = Math.hypot(x - (from.x + dx * t), z - (from.z + dz * t));
    if (distance < best.distance) best = { s: ((i + t) / steps) * edge.length, distance };
    from = to;
  }
  return best;
}

/** Edge terdekat dari sebuah titik. Mencari di 3x3 bucket dulu, lalu seluruh graf. */
export function nearestEdge(graph: LaneGraph, x: number, z: number): { edge: number; s: number; distance: number } {
  const candidates: number[] = [];
  const bx = Math.floor((x + HALF_WORLD) / CHUNK_SIZE);
  const bz = Math.floor((z + HALF_WORLD) / CHUNK_SIZE);
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const bucket = graph.grid.get((bz + dz) * WORLD_CHUNKS + bx + dx);
      if (bucket) candidates.push(...bucket);
    }
  }
  const search = candidates.length > 0 ? candidates : graph.data.edges.map((_, index) => index);
  let best = { edge: -1, s: 0, distance: Number.POSITIVE_INFINITY };
  for (const index of search) {
    const hit = projectOnEdge(graph, index, x, z);
    if (hit.distance < best.distance) best = { edge: index, s: hit.s, distance: hit.distance };
  }
  if (best.edge < 0) throw new Error('graf lajur kosong');
  return best;
}

/** Edge berikutnya, dipilih acak di persimpangan. Graf dibake tanpa jalan buntu. */
export function nextEdge(graph: LaneGraph, index: number, random: () => number): number {
  const options = graph.outgoing[edgeAt(graph, index).b] ?? [];
  const pick = options[Math.floor(random() * options.length)];
  if (pick === undefined) throw new Error(`edge ${index} berujung di jalan buntu`);
  return pick;
}

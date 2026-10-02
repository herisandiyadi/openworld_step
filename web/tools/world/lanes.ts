/**
 * Bake graf lajur dan trotoar dari tata letak jalan kota (lihat worldGen: jalan di kelipatan
 * BLOCK_PITCH, lebar ROAD_WIDTH). Hasilnya ditulis ke public/world/lanes.json oleh build.ts.
 * Lalu lintas Indonesia: lajur kiri, jadi lajur arah +X ada di z = garis tengah - LANE_OFFSET.
 */
import { LANE_OFFSET, type LaneEdge, type LaneNode, type LanesData, type WalkEdge } from '../../src/ambient/laneGraph';
import { BLOCK_PITCH, HALF_WORLD, ROAD_WIDTH, SIDEWALK_WIDTH, WORLD_DATA_VERSION, WORLD_SIZE } from '../../src/world/worldSpec';

/** Setengah lebar kotak persimpangan: belokan terjadi di dalam kotak ini. */
const ISEC_HALF = ROAD_WIDTH / 2;
/** Garis tengah trotoar, diukur dari garis tengah jalan. */
const WALK_OFFSET = ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2;
/** Garis tengah jalan yang dipakai: hanya yang di dalam dunia (tepi dunia dilewati). */
const LINES = Array.from({ length: WORLD_SIZE / BLOCK_PITCH - 1 }, (_, k) => -HALF_WORLD + (k + 1) * BLOCK_PITCH);

/** Empat arah mata angin sebagai langkah di grid persimpangan. */
const DIRS = [
  { di: 1, dj: 0, x: 1, z: 0 },
  { di: -1, dj: 0, x: -1, z: 0 },
  { di: 0, dj: 1, x: 0, z: 1 },
  { di: 0, dj: -1, x: 0, z: -1 },
] as const;
type Dir = (typeof DIRS)[number];

/** Kiri dari arah d (sumbu Y ke atas): left = up x forward. */
const leftOf = (d: Dir): Dir => DIRS.find((other) => other.x === d.z && other.z === -d.x) as Dir;
const rightOf = (d: Dir): Dir => DIRS.find((other) => other.x === -d.z && other.z === d.x) as Dir;

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Lajur untuk arah d: ofset LANE_OFFSET ke kiri dari garis tengah.
 * Titik pada jarak `along` dari pusat persimpangan di sepanjang arah jalan.
 */
function lanePoint(x: number, z: number, d: Dir, along: number): LaneNode {
  const left = leftOf(d);
  return {
    x: round2(x + d.x * along + left.x * LANE_OFFSET),
    z: round2(z + d.z * along + left.z * LANE_OFFSET),
  };
}

/** Panjang kurva Bezier kuadratik, disampel. */
function bezierLength(a: LaneNode, c: LaneNode, b: LaneNode): number {
  let length = 0;
  let from = a;
  for (let i = 1; i <= 8; i++) {
    const t = i / 8;
    const u = 1 - t;
    const to = { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, z: u * u * a.z + 2 * u * t * c.z + t * t * b.z };
    length += Math.hypot(to.x - from.x, to.z - from.z);
    from = to;
  }
  return length;
}

export function bakeLanes(): LanesData {
  const nodes: LaneNode[] = [];
  const nodeIds = new Map<string, number>();
  const nodeId = (point: LaneNode): number => {
    const key = `${point.x},${point.z}`;
    const found = nodeIds.get(key);
    if (found !== undefined) return found;
    nodes.push(point);
    nodeIds.set(key, nodes.length - 1);
    return nodes.length - 1;
  };
  const edges: LaneEdge[] = [];
  const intersections: LaneNode[] = [];
  const isecId = new Map<string, number>();
  const count = LINES.length;
  const inGrid = (i: number, j: number) => i >= 0 && j >= 0 && i < count && j < count;
  const at = (i: number, j: number) => ({ x: LINES[i] as number, z: LINES[j] as number });

  for (let j = 0; j < count; j++) {
    for (let i = 0; i < count; i++) {
      const center = at(i, j);
      isecId.set(`${i},${j}`, intersections.length);
      intersections.push(center);
    }
  }

  for (let j = 0; j < count; j++) {
    for (let i = 0; i < count; i++) {
      const center = at(i, j);
      const isec = isecId.get(`${i},${j}`) as number;
      for (const d of DIRS) {
        // Node masuk hanya dibuat kalau ada persimpangan sebelumnya (tidak ada lajur dari luar dunia),
        // node keluar hanya kalau ada persimpangan berikutnya. Jadi tidak ada jalan buntu.
        if (!inGrid(i - d.di, j - d.dj)) continue;
        const entry = nodeId(lanePoint(center.x, center.z, d, -ISEC_HALF));
        for (const [kind, out] of [
          ['straight', d],
          ['left', leftOf(d)],
          ['right', rightOf(d)],
        ] as const) {
          if (!inGrid(i + out.di, j + out.dj)) continue;
          const exit = nodeId(lanePoint(center.x, center.z, out, ISEC_HALF));
          const a = nodes[entry] as LaneNode;
          const b = nodes[exit] as LaneNode;
          if (kind === 'straight') {
            edges.push({ a: entry, b: exit, kind, length: round2(Math.hypot(b.x - a.x, b.z - a.z)), isec });
            continue;
          }
          // Titik kontrol = perpotongan garis lajur masuk dan lajur keluar.
          const control = { x: d.x === 0 ? a.x : b.x, z: d.z === 0 ? a.z : b.z };
          edges.push({
            a: entry,
            b: exit,
            kind,
            length: round2(bezierLength(a, control, b)),
            isec,
            cx: control.x,
            cz: control.z,
          });
        }
      }
    }
  }

  // Segmen lajur antar persimpangan, dibuat untuk tiap pasangan tetangga supaya tiap node keluar
  // (termasuk di tepi dunia) selalu punya lanjutan: tidak ada jalan buntu.
  for (let j = 0; j < count; j++) {
    for (let i = 0; i < count; i++) {
      const center = at(i, j);
      for (const d of DIRS) {
        if (!inGrid(i + d.di, j + d.dj)) continue;
        const next = at(i + d.di, j + d.dj);
        const from = nodeId(lanePoint(center.x, center.z, d, ISEC_HALF));
        const to = nodeId(lanePoint(next.x, next.z, d, -ISEC_HALF));
        const a = nodes[from] as LaneNode;
        const b = nodes[to] as LaneNode;
        edges.push({ a: from, b: to, kind: 'lane', length: round2(Math.hypot(b.x - a.x, b.z - a.z)), isec: -1 });
      }
    }
  }

  // C1: cincin trotoar per blok (garis tengah trotoar) plus zebra cross di tiap persimpangan.
  const walkNodes: LaneNode[] = [];
  const walkIds = new Map<string, number>();
  const walkId = (point: LaneNode): number => {
    const key = `${point.x},${point.z}`;
    const found = walkIds.get(key);
    if (found !== undefined) return found;
    walkNodes.push(point);
    walkIds.set(key, walkNodes.length - 1);
    return walkNodes.length - 1;
  };
  const walkEdges: WalkEdge[] = [];
  const corner = (i: number, j: number, sx: number, sz: number) =>
    walkId({ x: round2(at(i, j).x + sx * WALK_OFFSET), z: round2(at(i, j).z + sz * WALK_OFFSET) });
  const addWalk = (a: number, b: number, cross: boolean) => {
    const p = walkNodes[a] as LaneNode;
    const q = walkNodes[b] as LaneNode;
    walkEdges.push({ a, b, length: round2(Math.hypot(q.x - p.x, q.z - p.z)), cross });
  };
  for (let j = 0; j < count; j++) {
    for (let i = 0; i < count; i++) {
      // Zebra cross: menyeberangi jalan di keempat sisi persimpangan.
      addWalk(corner(i, j, -1, -1), corner(i, j, 1, -1), true);
      addWalk(corner(i, j, -1, 1), corner(i, j, 1, 1), true);
      addWalk(corner(i, j, -1, -1), corner(i, j, -1, 1), true);
      addWalk(corner(i, j, 1, -1), corner(i, j, 1, 1), true);
      // Sisi blok antara persimpangan ini dan tetangga timur/selatan.
      if (inGrid(i + 1, j)) {
        addWalk(corner(i, j, 1, -1), corner(i + 1, j, -1, -1), false);
        addWalk(corner(i, j, 1, 1), corner(i + 1, j, -1, 1), false);
      }
      if (inGrid(i, j + 1)) {
        addWalk(corner(i, j, -1, 1), corner(i, j + 1, -1, -1), false);
        addWalk(corner(i, j, 1, 1), corner(i, j + 1, 1, -1), false);
      }
    }
  }

  // Tiang lampu lalu lintas: sudut trotoar barat-laut tiap persimpangan, jadi tidak pernah di jalan.
  const poles: LaneNode[] = intersections.map((center) => ({
    x: round2(center.x - WALK_OFFSET),
    z: round2(center.z - WALK_OFFSET),
  }));

  return { version: WORLD_DATA_VERSION, nodes, edges, intersections, walkNodes, walkEdges, poles };
}

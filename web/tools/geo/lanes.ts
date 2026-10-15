/**
 * OSM -> lanes.json (graf lalu lintas + graf trotoar).
 *
 * Tanpa ini dataset geo hanya punya aspal dan bangunan: tidak ada pejalan kaki maupun
 * kendaraan, karena PedestrianLayer/AmbientLayer berhenti saat walkEdges kosong.
 * Dunia prosedural pun lanes-nya kosong, jadi pemain tidak pernah melihat NPC di sana.
 *
 * Skema keluaran mengikuti LanesData (src/ambient/laneGraph.ts) versi 3.
 */
import type { OsmData } from './osm';

export interface LaneNodeOut { x: number; z: number; }
export interface LaneEdgeOut { a: number; b: number; kind: 'drive' | 'walk'; length: number; isec: number; }
export interface WalkEdgeOut { a: number; b: number; length: number; cross: boolean; }
export interface LanesOut {
  version: number;
  nodes: LaneNodeOut[];
  edges: LaneEdgeOut[];
  intersections: LaneNodeOut[];
  walkNodes: LaneNodeOut[];
  walkEdges: WalkEdgeOut[];
}

/** Jenis jalan yang boleh dilewati kendaraan. */
const DRIVE = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary',
  'residential', 'living_street', 'service', 'unclassified', 'busway',
]);
/** Jenis jalan yang boleh dilewati pejalan kaki. */
const WALKABLE = new Set([...DRIVE, 'pedestrian', 'footway', 'path', 'steps', 'cycleway', 'corridor']);

const SNAP_METERS = 0.75;

export interface BuildLanesOptions {
  /** Jarak (m) dua node dianggap sama; menyatukan ujung way yang bertemu. */
  snap?: number;
  /** Batas node supaya graf tidak meledak pada bbox besar. */
  maxNodes?: number;
}

export function buildLanesFromOsm(
  data: OsmData,
  toX: (lon: number) => number,
  toZ: (lat: number) => number,
  halfWorld: number,
  opts: BuildLanesOptions = {},
): LanesOut {
  const snap = opts.snap ?? SNAP_METERS;
  const maxNodes = opts.maxNodes ?? 6000;

  const nodes: LaneNodeOut[] = [];
  const walkNodes: LaneNodeOut[] = [];
  const edges: LaneEdgeOut[] = [];
  const walkEdges: WalkEdgeOut[] = [];

  // Gabungkan node yang berimpit supaya way yang bertemu benar-benar tersambung
  // (OSM memakai node id berbeda untuk titik yang sama secara geometris).
  const cell = snap * 2;
  const driveIndex = new Map<string, number>();
  const walkIndex = new Map<string, number>();
  const keyOf = (x: number, z: number) => `${Math.round(x / cell)}:${Math.round(z / cell)}`;

  const intern = (
    list: LaneNodeOut[],
    index: Map<string, number>,
    x: number,
    z: number,
  ): number => {
    const key = keyOf(x, z);
    const existing = index.get(key);
    if (existing !== undefined) return existing;
    const i = list.length;
    list.push({ x, z });
    index.set(key, i);
    return i;
  };

  for (const way of data.ways) {
    const highway = way.tags.highway;
    if (!highway) continue;
    const drivable = DRIVE.has(highway);
    const walkable = WALKABLE.has(highway);
    if (!drivable && !walkable) continue;

    const pts: [number, number][] = [];
    for (const ref of way.nodes) {
      const node = data.nodes.get(ref);
      if (!node) continue;
      const x = toX(node.lon);
      const z = toZ(node.lat);
      if (Math.abs(x) > halfWorld || Math.abs(z) > halfWorld) continue;
      pts.push([x, z]);
    }
    if (pts.length < 2) continue;

    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i] as [number, number];
      const [bx, bz] = pts[i + 1] as [number, number];
      const length = Math.hypot(bx - ax, bz - az);
      if (length < 0.5) continue; // segmen sepele
      if (walkNodes.length < maxNodes && walkable) {
        const a = intern(walkNodes, walkIndex, ax, az);
        const b = intern(walkNodes, walkIndex, bx, bz);
        if (a !== b) walkEdges.push({ a, b, length, cross: false });
      }
      if (nodes.length < maxNodes && drivable) {
        const a = intern(nodes, driveIndex, ax, az);
        const b = intern(nodes, driveIndex, bx, bz);
        if (a !== b) edges.push({ a, b, kind: 'drive', length, isec: -1 });
      }
    }
  }

  // Persimpangan: node drive dengan derajat >= 3. Dipakai simulasi untuk reservasi.
  const degree = new Map<number, number>();
  for (const e of edges) {
    degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
    degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
  }
  const isecIndexOf = new Map<number, number>();
  const intersections: LaneNodeOut[] = [];
  for (const [nodeIndex, deg] of degree) {
    if (deg < 3) continue;
    const node = nodes[nodeIndex];
    if (!node) continue;
    isecIndexOf.set(nodeIndex, intersections.length);
    intersections.push({ x: node.x, z: node.z });
  }
  for (const e of edges) {
    const isec = isecIndexOf.get(e.a) ?? isecIndexOf.get(e.b);
    if (isec !== undefined) e.isec = isec;
  }

  // Zebra cross: edge trotoar yang menghubungkan dua sisi persimpangan. Ditandai supaya
  // pejalan kaki menyeberang di tempat yang benar, bukan sembarang titik.
  const crossCell = 12;
  for (const we of walkEdges) {
    const a = walkNodes[we.a];
    const b = walkNodes[we.b];
    if (!a || !b) continue;
    if (Math.hypot(b.x - a.x, b.z - a.z) > crossCell) continue;
    for (const isec of intersections) {
      const near = (p: LaneNodeOut) => Math.hypot(p.x - isec.x, p.z - isec.z) < crossCell;
      if (near(a) && near(b)) {
        we.cross = true;
        break;
      }
    }
  }

  return { version: 3, nodes, edges, intersections, walkNodes, walkEdges };
}

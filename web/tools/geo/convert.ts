/**
 * OSM -> surface raster + buildings AABB. Jalur 1: dataset sendiri, tidak menyentuh
 * worldGen.ts / konstanta world prosedural. Satuan meter, +X timur, utara = -Z, origin pusat bbox.
 */
import {
  CHUNK_SIZE,
  type Building,
  type ChunkData,
  chunkKey,
  GRID_CELLS,
  GRID_STEP,
  GRID_VERTS,
  LOAD_RADIUS,
  SURFACE,
  type WorldIndex,
  WORLD_DATA_VERSION,
} from '../../src/world/worldSpec';
import { footprintToBuilding } from './buildings';
import { parseOsmXml, type OsmData } from './osm';

export interface GeoBbox { w: number; s: number; e: number; n: number; }

export interface ConvertOptions {
  xml: string;
  bbox: GeoBbox;
  name: string;
  worldChunks: number;
  chunkSize: number;
  /** Tinggi bangunan default (m) kalau OSM tidak memberi height/levels. */
  buildingHeightDefault?: number;
}

export const ROAD_HALF: Record<string, number> = {
  motorway: 7, trunk: 6, primary: 5, secondary: 4, tertiary: 3.5,
  residential: 2.5, living_street: 2, service: 1.5, pedestrian: 3,
  footway: 1.2, path: 1, steps: 1, cycleway: 1.2, corridor: 1, busway: 3.5,
  construction: 2,
};
const LINK_SUFFIX = '_link';
export function roadHalfFor(highway: string): number {
  if (ROAD_HALF[highway] !== undefined) return ROAD_HALF[highway] as number;
  if (highway.endsWith(LINK_SUFFIX)) {
    const base = highway.slice(0, -LINK_SUFFIX.length);
    return (ROAD_HALF[base] ?? 3) * 0.7;
  }
  return 2;
}

const ROAD_LIKE = new Set(Object.keys(ROAD_HALF));
const METERS_PER_DEG_LAT = 111_320;

export interface GeoWorld {
  index: WorldIndex;
  /** Semua chunk (baris-major, cz lalu cx), siap ditulis ke chunks/<key>.json */
  chunks: ChunkData[];
  buildings: Building[];
  surface: Uint8Array;
  worldSize: number;
  halfWorld: number;
  stats: { buildings: number; roadWays: number; waterWays: number; greenWays: number; outside: number };
}

function polygonArea(points: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, z1] = points[i] as [number, number];
    const [x2, z2] = points[(i + 1) % points.length] as [number, number];
    a += x1 * z2 - x2 * z1;
  }
  return Math.abs(a) / 2;
}

const isClosed = (refs: string[]) => refs.length >= 4 && refs[0] === refs[refs.length - 1];

/** Proyeksi lon/lat -> meter lokal (utara = -Z) yang dipakai converter dan assembler. */
export function geoProjection(bbox: GeoBbox): { toX: (lon: number) => number; toZ: (lat: number) => number } {
  const midLat = (bbox.s + bbox.n) / 2;
  const mPerDegLon = METERS_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180);
  const centerLon = (bbox.w + bbox.e) / 2;
  const centerLat = (bbox.s + bbox.n) / 2;
  return {
    toX: (lon: number) => (lon - centerLon) * mPerDegLon,
    toZ: (lat: number) => -(lat - centerLat) * METERS_PER_DEG_LAT,
  };
}

const isOpenArea = (t: Record<string, string>) =>
  t.natural === 'water' || t.natural === 'sand' || t.natural === 'wood' || t.natural === 'scrub' ||
  t.waterway !== undefined || t.landuse !== undefined ||
  ['park', 'garden', 'pitch', 'playground', 'common'].includes(t.leisure ?? '') ||
  t.amenity === 'parking' || t.place === 'square' || t.highway === 'pedestrian';

/** Stamp a capsule (segment dengan radius) dengan sampling tiap GRID_STEP/2 m, supaya segmen panjang tidak terlewat. */
function stampSegment(
  stamp: (x: number, z: number, r: number, value: number, onlyIf?: (v: number) => boolean) => void,
  a: [number, number],
  b: [number, number],
  radius: number,
  value: number,
  onlyIf?: (v: number) => boolean,
): void {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const steps = Math.max(1, Math.ceil(len / (GRID_STEP / 2)));
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    stamp(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, radius, value, onlyIf);
  }
}

export function convertOsmToWorld(opts: ConvertOptions): GeoWorld {
  const { bbox, worldChunks, chunkSize } = opts;
  const data: OsmData = parseOsmXml(opts.xml);
  const { toX, toZ } = geoProjection(bbox);

  const worldSize = worldChunks * chunkSize;
  const halfWorld = worldSize / 2;
  const cells = worldSize / GRID_STEP;
  const surface = new Uint8Array(cells * cells).fill(SURFACE.grass);
  const cellOf = (x: number, z: number): [number, number] => [
    Math.floor((x + halfWorld) / GRID_STEP),
    Math.floor((z + halfWorld) / GRID_STEP),
  ];
  const stamp = (x: number, z: number, r: number, value: number, onlyIf?: (v: number) => boolean) => {
    const [ci, cj] = cellOf(x, z);
    const rc = Math.ceil(r / GRID_STEP) + 1;
    for (let j = cj - rc; j <= cj + rc; j++) {
      for (let i = ci - rc; i <= ci + rc; i++) {
        if (i < 0 || j < 0 || i >= cells || j >= cells) continue;
        const wx = (i + 0.5) * GRID_STEP - halfWorld;
        const wz = (j + 0.5) * GRID_STEP - halfWorld;
        if (Math.hypot(wx - x, wz - z) > r) continue;
        const at = j * cells + i;
        if (onlyIf && !onlyIf(surface[at] as number)) continue;
        surface[at] = value;
      }
    }
  };
  const stampPoly = (pts: [number, number][], value: number, onlyIf?: (v: number) => boolean) => {
    if (pts.length < 3) return;
    let minI = cells, maxI = -1, minJ = cells, maxJ = -1;
    for (const [x, z] of pts) {
      const [i, j] = cellOf(x, z);
      minI = Math.min(minI, i); maxI = Math.max(maxI, i);
      minJ = Math.min(minJ, j); maxJ = Math.max(maxJ, j);
    }
    minI = Math.max(0, minI - 1); minJ = Math.max(0, minJ - 1);
    maxI = Math.min(cells - 1, maxI + 1); maxJ = Math.min(cells - 1, maxJ + 1);
    for (let j = minJ; j <= maxJ; j++) {
      for (let i = minI; i <= maxI; i++) {
        const wx = (i + 0.5) * GRID_STEP - halfWorld;
        const wz = (j + 0.5) * GRID_STEP - halfWorld;
        if (!pointInPolygon(wx, wz, pts)) continue;
        const at = j * cells + i;
        if (onlyIf && !onlyIf(surface[at] as number)) continue;
        surface[at] = value;
      }
    }
  };

  const stats = { buildings: 0, roadWays: 0, waterWays: 0, greenWays: 0, outside: 0 };
  const coordOf = (ref: string): [number, number] | null => {
    const node = data.nodes.get(ref);
    if (!node) return null;
    return [toX(node.lon), toZ(node.lat)];
  };

  // --- Layer 1: area tertutup (air, hijau, pasir, plaza, parkir) di bawah jalan ---
  for (const way of data.ways) {
    const t = way.tags;
    if (!isClosed(way.nodes) || !isOpenArea(t)) continue;
    const pts: [number, number][] = [];
    let inside = 0;
    for (const ref of way.nodes) {
      const c = coordOf(ref);
      if (!c) continue;
      pts.push(c);
      if (Math.abs(c[0]) <= halfWorld && Math.abs(c[1]) <= halfWorld) inside++;
    }
    if (pts.length < 3) continue;
    if (inside === 0) { stats.outside++; continue; }
    const area = polygonArea(pts);
    if (area > (worldSize * worldSize) / 2) continue; // poligon tak wajar, buang
    if (t.natural === 'water' || t.waterway) { stampPoly(pts, SURFACE.water); stats.waterWays++; }
    else if (t.natural === 'sand' || t.landuse === 'beach') stampPoly(pts, SURFACE.plaza);
    else if (t.leisure || t.landuse === 'grass' || t.landuse === 'forest' || t.landuse === 'meadow' ||
             t.landuse === 'recreation_ground' || t.landuse === 'village_green' || t.landuse === 'cemetery' || t.natural === 'wood') {
      stampPoly(pts, SURFACE.grass); stats.greenWays++;
    }
    else if (t.highway === 'pedestrian' || t.place === 'square') stampPoly(pts, SURFACE.plaza);
    else if (t.amenity === 'parking') stampPoly(pts, SURFACE.plaza);
    else stampPoly(pts, SURFACE.plaza);
  }

  // --- Layer 2: jalan (disc stamping per segmen, lebar per kelas) ---
  for (const way of data.ways) {
    const hw = way.tags.highway;
    if (!hw || !ROAD_LIKE.has(hw) && !(hw.endsWith(LINK_SUFFIX) && ROAD_HALF[hw.slice(0, -LINK_SUFFIX.length)])) continue;
    stats.roadWays++;
    const half = roadHalfFor(hw);
    let prev: [number, number] | null = null;
    let insideAny = false;
    for (const ref of way.nodes) {
      const c = coordOf(ref);
      if (!c) { prev = null; continue; }
      if (prev) {
        stampSegment(stamp, prev, c, half, SURFACE.road, (v) => v !== SURFACE.water);
        if (Math.abs(c[0]) <= halfWorld && Math.abs(c[1]) <= halfWorld) insideAny = true;
      }
      prev = c;
    }
    if (!insideAny) stats.outside++;
  }

  // --- Layer 3: trotoar di sepanjang jalan mobil (bukan footway), di atas lahan basah ---
  for (const way of data.ways) {
    const hw = way.tags.highway;
    if (!hw) continue;
    const vehHalf = ROAD_HALF[hw];
    if (!vehHalf || vehHalf < 2) continue;
    const swHalf = vehHalf + 2;
    let prev: [number, number] | null = null;
    for (const ref of way.nodes) {
      const c = coordOf(ref);
      if (!c) { prev = null; continue; }
      if (prev) stampSegment(stamp, prev, c, swHalf, SURFACE.sidewalk, (v) => v === SURFACE.grass || v === SURFACE.plaza);
      prev = c;
    }
  }

  return { index: null as unknown as WorldIndex, chunks: [], buildings: [], surface, worldSize, halfWorld, stats };
}

/** Tahap penuh: parse + raster + bangunan + chunk + index dalam satu panggilan. */
export function buildGeoWorld(opts: ConvertOptions): GeoWorld {
  const data = parseOsmXml(opts.xml);
  const { toX, toZ } = geoProjection(opts.bbox);
  const raster = convertOsmToWorld(opts);
  return assembleGeoWorld(raster, opts, data, toX, toZ);
}
/** Pass bangunan + assembly chunk + index. Panggil setelah raster selesai. */
export function assembleGeoWorld(
  raster: { surface: Uint8Array; worldSize: number; halfWorld: number; stats: { buildings: number; roadWays: number; waterWays: number; greenWays: number; outside: number } },
  opts: ConvertOptions,
  data: OsmData,
  toX: (lon: number) => number,
  toZ: (lat: number) => number,
): GeoWorld {
  const { worldChunks, chunkSize } = opts;
  if (chunkSize !== CHUNK_SIZE) throw new Error(`chunkSize harus ${CHUNK_SIZE} (kontrak ChunkData)`);
  const halfWorld = raster.halfWorld;
  const worldSize = raster.worldSize;
  const ground = () => 0; // datar; DEM menyusul
  const coordOf = (ref: string): [number, number] | null => {
    const node = data.nodes.get(ref);
    return node ? [toX(node.lon), toZ(node.lat)] : null;
  };

  // --- Layer 4: bangunan ---
  const buildings: Building[] = [];
  const isClosed = (refs: string[]) => refs.length >= 4 && refs[0] === refs[refs.length - 1];
  for (const way of data.ways) {
    if (!way.tags.building || !isClosed(way.nodes)) continue;
    const pts: [number, number][] = [];
    let inside = 0;
    for (const ref of way.nodes) {
      const c = coordOf(ref);
      if (!c) continue;
      pts.push(c);
      if (Math.abs(c[0]) <= halfWorld && Math.abs(c[1]) <= halfWorld) inside++;
    }
    if (pts.length < 3 || inside === 0) continue;
    const building = footprintToBuilding({ id: way.id, tags: way.tags, pts, ground }, opts.buildingHeightDefault ?? 8);
    if (building) buildings.push(building);
  }
  raster.stats.buildings = buildings.length;

  // --- Titik spawn: sel walkable terdekat dari pusat ---
  const cells = worldSize / GRID_STEP;
  const cellSurface = (i: number, j: number) => raster.surface[j * cells + i] as number;
  const walkable = (v: number) => v === SURFACE.road || v === SURFACE.sidewalk || v === SURFACE.plaza || v === SURFACE.grass;
  let spawn = { x: 0, z: 0 };
  outer: for (let r = 0; r < cells / 2; r++) {
    for (let j = cells / 2 - r; j <= cells / 2 + r; j++) {
      for (let i = cells / 2 - r; i <= cells / 2 + r; i++) {
        if (i < 0 || j < 0 || i >= cells || j >= cells) continue;
        if (walkable(cellSurface(i, j))) {
          spawn = { x: (i + 0.5) * GRID_STEP - halfWorld, z: (j + 0.5) * GRID_STEP - halfWorld };
          break outer;
        }
      }
    }
  }

  // --- Assembly chunk ---
  const perChunkCells = chunkSize / GRID_STEP; // 32 sel per chunk
  const chunks: ChunkData[] = [];
  for (let cz = 0; cz < worldChunks; cz++) {
    for (let cx = 0; cx < worldChunks; cx++) {
      const originX = cx * chunkSize - halfWorld;
      const originZ = cz * chunkSize - halfWorld;
      const baseI = cx * perChunkCells;
      const baseJ = cz * perChunkCells;
      const surface: number[] = [];
      let waterMinI = Infinity, waterMaxI = -Infinity, waterMinJ = Infinity, waterMaxJ = -Infinity;
      for (let j = 0; j < GRID_CELLS; j++) {
        for (let i = 0; i < GRID_CELLS; i++) {
          const v = cellSurface(baseI + i, baseJ + j);
          surface.push(v);
          if (v === SURFACE.water) {
            waterMinI = Math.min(waterMinI, i); waterMaxI = Math.max(waterMaxI, i);
            waterMinJ = Math.min(waterMinJ, j); waterMaxJ = Math.max(waterMaxJ, j);
          }
        }
      }
      const chunk: ChunkData = {
        version: WORLD_DATA_VERSION,
        cx, cz,
        district: 'downtown',
        heights: new Array(GRID_VERTS * GRID_VERTS).fill(0),
        surface,
        buildings: [],
        props: [],
        colliders: [],
        seats: [],
        water: [],
        fishingSpots: [],
        trashBins: [],
        fishStalls: [],
      };
      for (const building of buildings) {
        const bcx = (building.minX + building.maxX) / 2;
        const bcz = (building.minZ + building.maxZ) / 2;
        if (bcx >= originX && bcx < originX + chunkSize && bcz >= originZ && bcz < originZ + chunkSize) {
          chunk.buildings.push(building);
          chunk.colliders.push({ minX: building.minX, maxX: building.maxX, minZ: building.minZ, maxZ: building.maxZ });
        }
      }
      if (waterMaxI >= 0) {
        chunk.water.push({
          id: `water_${cx}_${cz}`,
          kind: 'lake',
          bounds: {
            minX: originX + waterMinI * GRID_STEP,
            maxX: originX + (waterMaxI + 1) * GRID_STEP,
            minZ: originZ + waterMinJ * GRID_STEP,
            maxZ: originZ + (waterMaxJ + 1) * GRID_STEP,
          },
          noNav: true,
        });
      }
      chunks.push(chunk);
    }
  }

  const index: WorldIndex = {
    version: WORLD_DATA_VERSION,
    worldVersion: `geo-${opts.name}-v1`,
    chunkSize,
    worldChunks,
    worldSize,
    gridStep: GRID_STEP,
    bounds: { minX: -halfWorld, maxX: halfWorld, minZ: -halfWorld, maxZ: halfWorld },
    spawn,
    npcs: [],
    busStops: [],
    busRoutes: [],
    districts: [{ id: 'downtown', name: 'Little Tokyo Block M' }],
    seats: [],
    chunks: chunks.map((chunk) => ({
      cx: chunk.cx, cz: chunk.cz, district: chunk.district,
      file: `chunks/${chunkKey(chunk.cx, chunk.cz)}.json`,
      navmesh: `navmesh/${chunkKey(chunk.cx, chunk.cz)}.bin`,
    })),
    waterBodies: chunks.flatMap((chunk) => chunk.water),
    navmesh: { format: 'recast-tile-v1', directory: 'navmesh', pattern: '{cx}_{cz}.bin', loadRadius: LOAD_RADIUS },
    map: { file: 'map.png', pixelsPerMeter: 1, width: worldSize, height: worldSize },
    exploration: { version: 2, cellSize: 8, width: worldSize / 8, height: worldSize / 8, originX: -halfWorld, originZ: -halfWorld },
    legacy: { chunkOffset: { x: Math.floor((worldChunks - 8) / 2), z: Math.floor((worldChunks - 8) / 2) }, worldChunks: 8, bounds: { minX: -256, maxX: 256, minZ: -256, maxZ: 256 } },
  };
  return { index, chunks, buildings, surface: raster.surface, worldSize, halfWorld, stats: raster.stats };
}

function pointInPolygon(x: number, z: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i] as [number, number];
    const [xj, zj] = poly[j] as [number, number];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

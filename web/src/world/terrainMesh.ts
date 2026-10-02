import {
  type ChunkGround,
  chunkOrigin,
  GRID_CELLS,
  GRID_STEP,
  GRID_VERTS,
  isRaisedSurface,
  SIDEWALK_RAISE,
  SURFACE_COLORS,
  type SurfaceId,
} from './worldSpec';

/** Flat-shaded, vertex-coloured terrain buffers for one chunk (built in the chunk worker). */
export interface TerrainBuffers {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
}

type Vec3 = [number, number, number];
type Rgb = [number, number, number];

const CURB_COLOR = '#a9a69f';

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function linearRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [toLinear(((n >> 16) & 255) / 255), toLinear(((n >> 8) & 255) / 255), toLinear((n & 255) / 255)];
}

const SURFACE_RGB = Object.fromEntries(Object.entries(SURFACE_COLORS).map(([id, hex]) => [id, linearRgb(hex)])) as Record<
  string,
  Rgb
>;
const CURB_RGB = linearRgb(CURB_COLOR);

/** Cheap deterministic per-cell shade jitter so large flat areas don't look plastic. */
function jitter(x: number, z: number): number {
  const h = Math.imul(Math.floor(x) * 73856093 ^ Math.floor(z) * 19349663, 0x27d4eb2d) >>> 0;
  return 0.94 + (h / 4294967296) * 0.1;
}

class TriangleSink {
  private positions: number[] = [];
  private normals: number[] = [];
  private colors: number[] = [];

  /** Adds a triangle, flipping its winding if needed so the normal faces `facing`. */
  push(a: Vec3, b: Vec3, c: Vec3, color: Rgb, facing: Vec3): void {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    let second = b;
    let third = c;
    if (nx * facing[0] + ny * facing[1] + nz * facing[2] < 0) {
      second = c;
      third = b;
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const length = Math.hypot(nx, ny, nz) || 1;
    for (const vertex of [a, second, third]) {
      this.positions.push(vertex[0], vertex[1], vertex[2]);
      this.normals.push(nx / length, ny / length, nz / length);
      this.colors.push(color[0], color[1], color[2]);
    }
  }

  toBuffers(): TerrainBuffers {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      colors: new Float32Array(this.colors),
    };
  }
}

const UP: Vec3 = [0, 1, 0];

/**
 * Each 2 m cell is two triangles split along the (i,j)-(i+1,j+1) diagonal, the same split used by
 * sampleChunkHeight, so ground queries match the rendered surface exactly. Raised cells (sidewalks,
 * lots) get vertical curb faces toward neighbouring road cells.
 */
export function buildTerrainBuffers(chunk: ChunkGround): TerrainBuffers {
  const sink = new TriangleSink();
  const originX = chunkOrigin(chunk.cx);
  const originZ = chunkOrigin(chunk.cz);
  const heightAt = (i: number, j: number) => (chunk.heights[j * GRID_VERTS + i] ?? 0) / 100;
  const surfaceOf = (i: number, j: number) => chunk.surface[j * GRID_CELLS + i] ?? 0;
  const raiseOf = (i: number, j: number) => (isRaisedSurface(surfaceOf(i, j)) ? SIDEWALK_RAISE : 0);

  for (let j = 0; j < GRID_CELLS; j++) {
    for (let i = 0; i < GRID_CELLS; i++) {
      const x0 = originX + i * GRID_STEP;
      const z0 = originZ + j * GRID_STEP;
      const x1 = x0 + GRID_STEP;
      const z1 = z0 + GRID_STEP;
      const raise = raiseOf(i, j);
      const p00: Vec3 = [x0, heightAt(i, j) + raise, z0];
      const p10: Vec3 = [x1, heightAt(i + 1, j) + raise, z0];
      const p01: Vec3 = [x0, heightAt(i, j + 1) + raise, z1];
      const p11: Vec3 = [x1, heightAt(i + 1, j + 1) + raise, z1];
      const base = SURFACE_RGB[surfaceOf(i, j) as SurfaceId] ?? CURB_RGB;
      const shade = jitter(x0, z0);
      const color: Rgb = [base[0] * shade, base[1] * shade, base[2] * shade];
      sink.push(p00, p11, p10, color, UP);
      sink.push(p00, p01, p11, color, UP);

      if (raise === 0) continue;
      // Curbs on the four sides where the neighbour (inside this chunk) is lower.
      const sides: { di: number; dj: number; a: [number, number]; b: [number, number]; facing: Vec3 }[] = [
        { di: 1, dj: 0, a: [i + 1, j], b: [i + 1, j + 1], facing: [1, 0, 0] },
        { di: -1, dj: 0, a: [i, j], b: [i, j + 1], facing: [-1, 0, 0] },
        { di: 0, dj: 1, a: [i, j + 1], b: [i + 1, j + 1], facing: [0, 0, 1] },
        { di: 0, dj: -1, a: [i, j], b: [i + 1, j], facing: [0, 0, -1] },
      ];
      for (const side of sides) {
        const ni = i + side.di;
        const nj = j + side.dj;
        if (ni < 0 || nj < 0 || ni >= GRID_CELLS || nj >= GRID_CELLS) continue;
        const drop = raise - raiseOf(ni, nj);
        if (drop <= 0) continue;
        const [ai, aj] = side.a;
        const [bi, bj] = side.b;
        const ax = originX + ai * GRID_STEP;
        const az = originZ + aj * GRID_STEP;
        const bx = originX + bi * GRID_STEP;
        const bz = originZ + bj * GRID_STEP;
        const aTop = heightAt(ai, aj) + raise;
        const bTop = heightAt(bi, bj) + raise;
        const aLow: Vec3 = [ax, aTop - drop, az];
        const bLow: Vec3 = [bx, bTop - drop, bz];
        const aHigh: Vec3 = [ax, aTop, az];
        const bHigh: Vec3 = [bx, bTop, bz];
        sink.push(aLow, aHigh, bLow, CURB_RGB, side.facing);
        sink.push(bLow, aHigh, bHigh, CURB_RGB, side.facing);
      }
    }
  }
  return sink.toBuffers();
}
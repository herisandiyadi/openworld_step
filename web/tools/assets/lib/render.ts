import { type Vec3, add, cross, deg, dot, length, normalize, scale, sub } from './math';
import { linearToSrgbByte } from './palette';
import { type Bounds, type Triangle, boundsOf } from './evaluate';

const SUPERSAMPLE = 2;
const LIGHT = normalize([0.45, 0.85, 0.35]);
const BACKGROUND: Vec3 = [0.78, 0.84, 0.9];

export interface View {
  yawDeg: number;
  elevationDeg: number;
  label?: string;
}

/** Ground disc, origin cross (pivot) and a -Z arrow (forward), all at y = 0. */
function helperTriangles(bounds: Bounds): Triangle[] {
  const extent = Math.max(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2], 0.6);
  const r = extent * 0.75;
  const ground: Vec3 = [0.55, 0.58, 0.55];
  const tris: Triangle[] = [];
  const segments = 24;
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    tris.push({ a: [0, -0.002, 0], b: [Math.cos(a1) * r, -0.002, Math.sin(a1) * r], c: [Math.cos(a0) * r, -0.002, Math.sin(a0) * r], color: ground, emissive: [0, 0, 0] });
  }
  const w = extent * 0.02;
  const l = extent * 0.12;
  const red: Vec3 = [0.8, 0.05, 0.05];
  tris.push({ a: [-l, 0.001, -w], b: [l, 0.001, -w], c: [l, 0.001, w], color: red, emissive: red });
  tris.push({ a: [-l, 0.001, -w], b: [l, 0.001, w], c: [-l, 0.001, w], color: red, emissive: red });
  tris.push({ a: [-w, 0.001, -l], b: [w, 0.001, -l], c: [w, 0.001, l], color: red, emissive: red });
  tris.push({ a: [-w, 0.001, -l], b: [w, 0.001, l], c: [-w, 0.001, l], color: red, emissive: red });
  const blue: Vec3 = [0.05, 0.25, 0.9];
  tris.push({ a: [0, 0.001, -r * 0.98], b: [-r * 0.08, 0.001, -r * 0.8], c: [r * 0.08, 0.001, -r * 0.8], color: blue, emissive: blue });
  return tris;
}

/** Orthographic flat-shaded z-buffer render of `triangles` into an RGB tile. */
export function renderTile(triangles: Triangle[], view: View, size: number, fit: Bounds = boundsOf(triangles)): Uint8Array {
  const s = size * SUPERSAMPLE;
  const center: Vec3 = scale(add(fit.min, fit.max), 0.5);
  const radius = Math.max(length(sub(fit.max, fit.min)) / 2, 0.1);
  const yaw = deg(view.yawDeg);
  const elevation = deg(view.elevationDeg);
  const eyeDir: Vec3 = [Math.sin(yaw) * Math.cos(elevation), Math.sin(elevation), Math.cos(yaw) * Math.cos(elevation)];
  const forward = scale(eyeDir, -1);
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const pixelsPerMeter = (s * 0.46) / radius;

  const color = new Float32Array(s * s * 3);
  const depth = new Float32Array(s * s).fill(Infinity);
  for (let i = 0; i < s * s; i++) color.set(BACKGROUND, i * 3);

  const project = (p: Vec3): Vec3 => {
    const d = sub(p, center);
    return [s / 2 + dot(d, right) * pixelsPerMeter, s / 2 - dot(d, up) * pixelsPerMeter, dot(d, forward)];
  };

  for (const tri of [...helperTriangles(fit), ...triangles]) {
    let normal = normalize(cross(sub(tri.b, tri.a), sub(tri.c, tri.a)));
    if (length(normal) === 0) continue;
    if (dot(normal, forward) > 0) normal = scale(normal, -1);
    const light = 0.42 + 0.62 * Math.max(0, dot(normal, LIGHT));
    const shaded: Vec3 = [
      Math.min(1, tri.color[0] * light + tri.emissive[0]),
      Math.min(1, tri.color[1] * light + tri.emissive[1]),
      Math.min(1, tri.color[2] * light + tri.emissive[2]),
    ];

    const a = project(tri.a);
    const b = project(tri.b);
    const c = project(tri.c);
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(area) < 1e-9) continue;
    const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
    const maxX = Math.min(s - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
    const maxY = Math.min(s - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
        const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * a[2] + w1 * b[2] + w2 * c[2];
        const index = y * s + x;
        if (z >= (depth[index] ?? Infinity)) continue;
        depth[index] = z;
        color.set(shaded, index * 3);
      }
    }
  }

  const out = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      for (let k = 0; k < 3; k++) {
        let sum = 0;
        for (let sy = 0; sy < SUPERSAMPLE; sy++) {
          for (let sx = 0; sx < SUPERSAMPLE; sx++) sum += color[((y * SUPERSAMPLE + sy) * s + x * SUPERSAMPLE + sx) * 3 + k] ?? 0;
        }
        out[(y * size + x) * 3 + k] = linearToSrgbByte(sum / (SUPERSAMPLE * SUPERSAMPLE));
      }
    }
  }
  return out;
}

/** Lays tiles out on a grid (row-major). */
export function composeSheet(tiles: Uint8Array[], tileSize: number, columns: number): { width: number; height: number; rgb: Uint8Array } {
  const rows = Math.ceil(tiles.length / columns);
  const width = tileSize * columns;
  const height = tileSize * rows;
  const rgb = new Uint8Array(width * height * 3).fill(255);
  tiles.forEach((tile, i) => {
    const ox = (i % columns) * tileSize;
    const oy = Math.floor(i / columns) * tileSize;
    for (let y = 0; y < tileSize; y++) rgb.set(tile.subarray(y * tileSize * 3, (y + 1) * tileSize * 3), ((oy + y) * width + ox) * 3);
  });
  return { width, height, rgb };
}
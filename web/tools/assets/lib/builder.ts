import { type Quat, type Vec3, add, dot, length, mulberry32, normalize, quatFromEuler, quatFromTo, rotateVec, scale, sub } from './math';
import type { Rgb } from './palette';

export interface PartOptions {
  /** Translation applied after rotation (model space). */
  at?: Vec3;
  /** Euler rotation in radians (XYZ). Ignored when `quat` is given. */
  rot?: Vec3;
  quat?: Quat;
  color: Rgb;
  /** Joint index for rigid skinning. */
  bone?: number;
}

interface Transform {
  q: Quat;
  t: Vec3;
}

const toTransform = (options: PartOptions): Transform => ({
  q: options.quat ?? quatFromEuler(options.rot ?? [0, 0, 0]),
  t: options.at ?? [0, 0, 0],
});

const apply = (xf: Transform, p: Vec3): Vec3 => add(rotateVec(xf.q, p), xf.t);

/** Newell's method: robust polygon normal, oriented by vertex winding (CCW = front). */
function polygonNormal(points: Vec3[]): Vec3 | null {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i] as Vec3;
    const b = points[(i + 1) % points.length] as Vec3;
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const n: Vec3 = [nx, ny, nz];
  return length(n) < 1e-10 ? null : normalize(n);
}

const centroid = (points: Vec3[]): Vec3 => scale(points.reduce<Vec3>((acc, p) => add(acc, p), [0, 0, 0]), 1 / points.length);

/**
 * Accumulates flat-shaded, vertex-coloured low-poly geometry. Every face gets its own vertices so
 * normals stay faceted; windings are auto-oriented outward from a provided interior point.
 */
export class MeshBuilder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly colors: number[] = [];
  readonly joints: number[] = [];
  readonly indices: number[] = [];

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  get triangleCount(): number {
    return this.indices.length / 3;
  }

  polygon(points: Vec3[], inside: Vec3, options: PartOptions): void {
    const xf = toTransform(options);
    const world = points.map((p) => apply(xf, p));
    let normal = polygonNormal(world);
    if (!normal) return;
    if (dot(normal, sub(centroid(world), apply(xf, inside))) < 0) {
      world.reverse();
      normal = scale(normal, -1);
    }
    const base = this.vertexCount;
    for (const p of world) {
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(normal[0], normal[1], normal[2]);
      this.colors.push(options.color[0], options.color[1], options.color[2]);
      this.joints.push(options.bone ?? 0);
    }
    for (let i = 1; i < world.length - 1; i++) this.indices.push(base, base + i, base + i + 1);
  }

  /** Axis-aligned (before rotation) box centred on `at`. */
  box(size: Vec3, options: PartOptions): void {
    const [hx, hy, hz] = [size[0] / 2, size[1] / 2, size[2] / 2];
    const c = (sx: number, sy: number, sz: number): Vec3 => [sx * hx, sy * hy, sz * hz];
    const faces: Vec3[][] = [
      [c(1, -1, -1), c(1, 1, -1), c(1, 1, 1), c(1, -1, 1)],
      [c(-1, -1, -1), c(-1, -1, 1), c(-1, 1, 1), c(-1, 1, -1)],
      [c(-1, 1, -1), c(-1, 1, 1), c(1, 1, 1), c(1, 1, -1)],
      [c(-1, -1, -1), c(1, -1, -1), c(1, -1, 1), c(-1, -1, 1)],
      [c(-1, -1, 1), c(1, -1, 1), c(1, 1, 1), c(-1, 1, 1)],
      [c(-1, -1, -1), c(-1, 1, -1), c(1, 1, -1), c(1, -1, -1)],
    ];
    for (const face of faces) this.polygon(face, [0, 0, 0], options);
  }

  /** Thin box spanning two points (used for frame tubes, poles, arms). */
  bar(from: Vec3, to: Vec3, thickness: number, options: Omit<PartOptions, 'at' | 'rot' | 'quat'>): void {
    const dir = sub(to, from);
    this.box([thickness, length(dir), thickness], {
      ...options,
      at: scale(add(from, to), 0.5),
      quat: quatFromTo([0, 1, 0], dir),
    });
  }

  /** Cylinder/cone frustum along local +Y with its origin at the bottom centre. */
  frustum(
    shape: { radiusBottom: number; radiusTop: number; height: number; segments: number; capTop?: boolean; capBottom?: boolean },
    options: PartOptions,
  ): void {
    const { radiusBottom, radiusTop, height, segments } = shape;
    const inside: Vec3 = [0, height / 2, 0];
    const ring = (radius: number, y: number) =>
      Array.from({ length: segments }, (_, i): Vec3 => {
        const angle = (i / segments) * Math.PI * 2;
        return [Math.cos(angle) * radius, y, Math.sin(angle) * radius];
      });
    const bottom = ring(radiusBottom, 0);
    const top = ring(radiusTop, height);
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      const b0 = bottom[i] as Vec3;
      const b1 = bottom[j] as Vec3;
      if (radiusTop <= 0) this.polygon([b0, b1, [0, height, 0]], inside, options);
      else this.polygon([b0, b1, top[j] as Vec3, top[i] as Vec3], inside, options);
    }
    if (shape.capBottom !== false) this.polygon([...bottom].reverse(), inside, options);
    if (shape.capTop !== false && radiusTop > 0) this.polygon(top, inside, options);
  }

  /** Faceted blob (icosphere), optionally subdivided once and jittered for an organic look. */
  blob(shape: { radius: number; stretch?: Vec3; subdivide?: boolean; jitter?: number; seed?: number }, options: PartOptions): void {
    const t = (1 + Math.sqrt(5)) / 2;
    const vertices: Vec3[] = (
      [
        [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
        [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
      ] as Vec3[]
    ).map(normalize);
    let faces: [number, number, number][] = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];

    if (shape.subdivide) {
      const cache = new Map<string, number>();
      const midpoint = (a: number, b: number): number => {
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        const cached = cache.get(key);
        if (cached !== undefined) return cached;
        vertices.push(normalize(scale(add(vertices[a] as Vec3, vertices[b] as Vec3), 0.5)));
        cache.set(key, vertices.length - 1);
        return vertices.length - 1;
      };
      faces = faces.flatMap(([a, b, c]) => {
        const ab = midpoint(a, b);
        const bc = midpoint(b, c);
        const ca = midpoint(c, a);
        return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]] as [number, number, number][];
      });
    }

    const random = mulberry32(shape.seed ?? 1);
    const jitter = shape.jitter ?? 0;
    const stretch = shape.stretch ?? [1, 1, 1];
    const shaped = vertices.map((v): Vec3 => {
      const r = shape.radius * (1 + (random() * 2 - 1) * jitter);
      return [v[0] * r * stretch[0], v[1] * r * stretch[1], v[2] * r * stretch[2]];
    });
    for (const [a, b, c] of faces) this.polygon([shaped[a] as Vec3, shaped[b] as Vec3, shaped[c] as Vec3], [0, 0, 0], options);
  }

  /** Torus whose axle is the local X axis (wheels, tyres). */
  torus(shape: { radius: number; tube: number; radialSegments: number; tubularSegments: number }, options: PartOptions): void {
    const { radius, tube, radialSegments, tubularSegments } = shape;
    const ringCenter = (theta: number): Vec3 => [0, Math.cos(theta) * radius, Math.sin(theta) * radius];
    const point = (theta: number, phi: number): Vec3 => {
      const dir: Vec3 = [0, Math.cos(theta), Math.sin(theta)];
      return add(ringCenter(theta), add(scale(dir, Math.cos(phi) * tube), [Math.sin(phi) * tube, 0, 0]));
    };
    for (let i = 0; i < radialSegments; i++) {
      const t0 = (i / radialSegments) * Math.PI * 2;
      const t1 = ((i + 1) / radialSegments) * Math.PI * 2;
      for (let j = 0; j < tubularSegments; j++) {
        const p0 = (j / tubularSegments) * Math.PI * 2;
        const p1 = ((j + 1) / tubularSegments) * Math.PI * 2;
        this.polygon([point(t0, p0), point(t1, p0), point(t1, p1), point(t0, p1)], ringCenter((t0 + t1) / 2), options);
      }
    }
  }
}
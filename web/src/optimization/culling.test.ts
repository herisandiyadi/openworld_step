import { describe, expect, it } from 'vitest';
import {
  type Box,
  type Plane,
  boxInFrustum,
  isOccluded,
  propCullDistance,
  selectOccluders,
  smallPropVisible,
} from './culling';

const box = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): Box => ({
  minX,
  minY,
  minZ,
  maxX,
  maxY,
  maxZ,
});

// "Frustum" kotak sumbu-sejajar [-10, 10]^3; konvensi three.js: titik di dalam bila n·p + d >= 0.
const cubeFrustum: Plane[] = [
  { nx: 1, ny: 0, nz: 0, d: 10 },
  { nx: -1, ny: 0, nz: 0, d: 10 },
  { nx: 0, ny: 1, nz: 0, d: 10 },
  { nx: 0, ny: -1, nz: 0, d: 10 },
  { nx: 0, ny: 0, nz: 1, d: 10 },
  { nx: 0, ny: 0, nz: -1, d: 10 },
];

describe('boxInFrustum', () => {
  it('kotak di dalam terlihat, kotak jauh di luar dibuang', () => {
    expect(boxInFrustum(box(-1, -1, -1, 1, 1, 1), cubeFrustum)).toBe(true);
    expect(boxInFrustum(box(20, 0, 0, 30, 1, 1), cubeFrustum)).toBe(false);
  });

  it('kotak yang memotong batas tetap dianggap terlihat (konservatif)', () => {
    expect(boxInFrustum(box(9, 0, 0, 15, 1, 1), cubeFrustum)).toBe(true);
  });

  it('tanpa plane berarti tidak ada culling', () => {
    expect(boxInFrustum(box(1000, 0, 0, 1001, 1, 1), [])).toBe(true);
  });
});

describe('distance culling props kecil', () => {
  it('ambang naik seiring tier', () => {
    expect(propCullDistance('low')).toBeLessThan(propCullDistance('medium'));
    expect(propCullDistance('medium')).toBeLessThan(propCullDistance('high'));
  });

  it('prop di dalam ambang terlihat, di luar dibuang; batas tepat masih terlihat', () => {
    const limit = propCullDistance('medium');
    expect(smallPropVisible(limit - 1, 'medium')).toBe(true);
    expect(smallPropVisible(limit, 'medium')).toBe(true);
    expect(smallPropVisible(limit + 0.01, 'medium')).toBe(false);
  });

  it('jarak tidak valid dianggap tidak terlihat', () => {
    expect(smallPropVisible(Number.NaN, 'high')).toBe(false);
  });
});

describe('occlusion bangunan besar', () => {
  const tall = box(10, 0, -5, 20, 40, 5);
  const short = box(10, 0, -5, 20, 3, 5);

  it('hanya bangunan tinggi dan lebar yang jadi occluder', () => {
    const picked = selectOccluders([tall, short], { minHeight: 12, minFootprint: 50 });
    expect(picked).toEqual([tall]);
  });

  it('target pendek di balik bangunan tinggi tersembunyi dari mata setinggi pejalan kaki', () => {
    const eye = { x: 0, y: 1.7, z: 0 };
    const target = box(30, 0, -1, 32, 6, 1);
    expect(isOccluded(target, [tall], eye)).toBe(true);
  });

  it('target lebih tinggi dari occluder tetap terlihat', () => {
    const eye = { x: 0, y: 1.7, z: 0 };
    expect(isOccluded(box(30, 0, -1, 32, 60, 1), [tall], eye)).toBe(false);
  });

  it('target yang tidak di belakang occluder tetap terlihat', () => {
    const eye = { x: 0, y: 1.7, z: 0 };
    expect(isOccluded(box(-32, 0, -1, -30, 6, 1), [tall], eye)).toBe(false);
  });

  it('mata di atas occluder (kamera tinggi) tidak pernah mengoklusi', () => {
    const eye = { x: 0, y: 80, z: 0 };
    expect(isOccluded(box(30, 0, -1, 32, 6, 1), [tall], eye)).toBe(false);
  });

  it('target yang sebagian keluar dari bayangan occluder tetap terlihat', () => {
    const eye = { x: 0, y: 1.7, z: 0 };
    // Lebar target melewati sisi occluder (z = ±5 diproyeksikan ke x=30 jadi ±15).
    expect(isOccluded(box(30, 0, 10, 32, 6, 30), [tall], eye)).toBe(false);
  });
});

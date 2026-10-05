import { describe, expect, it } from 'vitest';
import { AOI_INTERVAL_MS, aoiTier, cellIndex, dueUpdates, GRID_CELLS, SpatialGrid } from '../src/aoi.js';

describe('grid spasial 64 m', () => {
  it('8 × 8 sel untuk peta 512 m, koordinat dijepit', () => {
    expect(GRID_CELLS).toBe(8);
    expect(cellIndex(-256)).toBe(0);
    expect(cellIndex(-193)).toBe(0);
    expect(cellIndex(-192)).toBe(1);
    expect(cellIndex(255.9)).toBe(7);
    expect(cellIndex(256)).toBe(7);
    expect(cellIndex(9999)).toBe(7);
  });

  it('queryRadius hanya mengembalikan entri dalam radius', () => {
    const grid = new SpatialGrid();
    grid.insert({ id: 1, x: 0, z: 0 });
    grid.insert({ id: 2, x: 100, z: 0 });
    grid.insert({ id: 3, x: 200, z: 0 });
    grid.insert({ id: 4, x: -250, z: -250 });
    expect(grid.queryRadius(0, 0, 120).map((e) => e.id).sort()).toEqual([1, 2]);
    expect(grid.queryRadius(0, 0, 250).map((e) => e.id).sort()).toEqual([1, 2, 3]);
    expect(grid.size).toBe(4);
  });
});

describe('frekuensi AOI', () => {
  it('tier sesuai jarak', () => {
    expect(aoiTier(0)).toBe('near');
    expect(aoiTier(120)).toBe('near');
    expect(aoiTier(121)).toBe('mid');
    expect(aoiTier(250)).toBe('mid');
    expect(aoiTier(251)).toBe('far');
  });

  /** Simulasi 2 detik tick 15 Hz; hitung berapa update tiap subjek diterima. */
  function simulate(subjects: { id: number; x: number; z: number }[]): Map<number, number> {
    const lastSent = new Map<number, number>();
    const counts = new Map<number, number>();
    for (let tick = 0; tick < 30; tick++) {
      const now = 1000 + tick * (1000 / 15);
      for (const update of dueUpdates({ x: 0, z: 0 }, subjects, lastSent, now)) counts.set(update.id, (counts.get(update.id) ?? 0) + 1);
    }
    return counts;
  }

  it('pemain dekat menerima 15 Hz, pemain jauh TIDAK menerima frekuensi tinggi', () => {
    const counts = simulate([
      { id: 1, x: 50, z: 0 }, // dekat
      { id: 2, x: 200, z: 0 }, // menengah
      { id: 3, x: 0, z: 255 }, // jauh (> 250 m)
    ]);
    // 30 tick dalam 2 detik: dekat = setiap tick.
    expect(counts.get(1)).toBe(30);
    // 3 Hz → 6-7 kali dalam 2 detik.
    expect(counts.get(2)).toBeGreaterThanOrEqual(6);
    expect(counts.get(2)).toBeLessThanOrEqual(7);
    // Jauh: hanya posisi kasar tiap 2 detik (sekali di jendela ini).
    expect(counts.get(3)).toBe(1);
    expect(AOI_INTERVAL_MS.far).toBe(2000);
  });
});

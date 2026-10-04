import { describe, expect, it } from 'vitest';
import { activationFor, shouldTickNow, updateRateFor } from './activation';
import { streamingPolicyFor } from './streamingPolicy';
import { chunkKey } from '../world/worldSpec';

const policy = streamingPolicyFor('medium');
const loaded = ['4_4', '5_4', '4_5', '6_4', '7_4', '2_4'];

describe('activationFor', () => {
  it('agen aktif hanya di chunk dekat player, sisanya pasif', () => {
    const result = activationFor({ cx: 4, cz: 4 }, loaded, policy);
    expect(result.active).toContain('4_4');
    expect(result.active).toContain('5_4');
    expect(result.active).not.toContain('7_4');
    expect(result.passive).toContain('7_4');
    expect([...result.active, ...result.passive].sort()).toEqual([...loaded].sort());
  });

  it('lampu aktif lebih jauh daripada NPC/kendaraan', () => {
    const result = activationFor({ cx: 4, cz: 4 }, loaded, policy);
    expect(result.lights.length).toBeGreaterThanOrEqual(result.agents.length);
    for (const key of result.agents) expect(result.lights).toContain(key);
  });

  it('chunk player selalu aktif walau daftar loaded berisi satu chunk', () => {
    const result = activationFor({ cx: 0, cz: 0 }, [chunkKey(0, 0)], policy);
    expect(result.active).toEqual([chunkKey(0, 0)]);
    expect(result.agents).toEqual([chunkKey(0, 0)]);
  });

  it('key tidak valid tidak membuat crash dan masuk passive', () => {
    const result = activationFor({ cx: 4, cz: 4 }, ['rusak'], policy);
    expect(result.passive).toEqual(['rusak']);
  });
});

describe('updateRateFor', () => {
  it('objek dekat update penuh, makin jauh makin jarang', () => {
    expect(updateRateFor(0, 'high')).toBe(1);
    expect(updateRateFor(60, 'high')).toBeLessThan(1);
    expect(updateRateFor(200, 'high')).toBeLessThan(updateRateFor(60, 'high'));
  });

  it('tier rendah menurunkan rate lebih cepat', () => {
    expect(updateRateFor(40, 'low')).toBeLessThanOrEqual(updateRateFor(40, 'medium'));
    expect(updateRateFor(40, 'medium')).toBeLessThanOrEqual(updateRateFor(40, 'high'));
  });

  it('rate selalu di (0,1] dan aman untuk jarak tidak valid', () => {
    for (const d of [-5, 0, 1e9, Number.NaN]) {
      const rate = updateRateFor(d, 'medium');
      expect(rate).toBeGreaterThan(0);
      expect(rate).toBeLessThanOrEqual(1);
    }
  });
});

describe('shouldTickNow', () => {
  it('membagi beban: rate 1/4 hanya tick tiap 4 frame per slot', () => {
    const ticks = [0, 1, 2, 3, 4, 5, 6, 7].filter((frame) => shouldTickNow(frame, 0, 0.25));
    expect(ticks).toEqual([0, 4]);
  });

  it('slot berbeda tick di frame berbeda (stagger)', () => {
    expect(shouldTickNow(1, 1, 0.25)).toBe(true);
    expect(shouldTickNow(1, 0, 0.25)).toBe(false);
  });

  it('rate penuh selalu tick', () => {
    expect(shouldTickNow(7, 3, 1)).toBe(true);
  });
});

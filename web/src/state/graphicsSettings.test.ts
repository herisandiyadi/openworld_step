import { describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/preferences', () => ({ Preferences: { get: vi.fn(), set: vi.fn(() => Promise.resolve()), remove: vi.fn() } }));

const { BRIGHTNESS_RANGE, DEFAULT_GRAPHICS, DENSITY_LABELS, normalizeGraphics, resumeRendererState } = await import('./graphicsSettings');
const { VEHICLE_POOL } = await import('../ambient/spawner');

describe('preset kepadatan', () => {
  it('nilai tidak sah jatuh ke default', () => {
    expect(normalizeGraphics({ density: 'high' }).density).toBe('high');
    expect(normalizeGraphics(null)).toEqual(DEFAULT_GRAPHICS);
    expect(normalizeGraphics({ density: 'ramai' as never })).toEqual(DEFAULT_GRAPHICS);
  });

  it('tiap preset punya label Indonesia dan pool kendaraan', () => {
    for (const preset of ['low', 'medium', 'high'] as const) {
      expect(DENSITY_LABELS[preset]).toBeTruthy();
      expect(VEHICLE_POOL[preset]).toBeGreaterThan(0);
    }
    expect(VEHICLE_POOL.low).toBeLessThan(VEHICLE_POOL.high);
  });
});

describe('opsi tampilan (VISUAL_UPGRADE §8)', () => {
  it('default eksplisit: kualitas sedang, kecerahan netral, gerak normal', () => {
    expect(DEFAULT_GRAPHICS).toEqual({ density: 'medium', quality: 'medium', brightness: 1, reducedMotion: false });
  });

  it('kualitas tidak sah jatuh ke default, yang sah dipertahankan', () => {
    expect(normalizeGraphics({ quality: 'high' }).quality).toBe('high');
    expect(normalizeGraphics({ quality: 'ultra' as never }).quality).toBe('medium');
  });

  it('kecerahan di-clamp ke rentang dan NaN jatuh ke default', () => {
    expect(normalizeGraphics({ brightness: 9 }).brightness).toBe(BRIGHTNESS_RANGE.max);
    expect(normalizeGraphics({ brightness: -1 }).brightness).toBe(BRIGHTNESS_RANGE.min);
    expect(normalizeGraphics({ brightness: Number.NaN }).brightness).toBe(1);
    expect(normalizeGraphics({ brightness: 1.2 }).brightness).toBeCloseTo(1.2);
    expect(BRIGHTNESS_RANGE.min).toBeLessThan(1);
    expect(BRIGHTNESS_RANGE.max).toBeGreaterThan(1);
  });

  it('reduced motion hanya menerima boolean', () => {
    expect(normalizeGraphics({ reducedMotion: true }).reducedMotion).toBe(true);
    expect(normalizeGraphics({ reducedMotion: 'yes' as never }).reducedMotion).toBe(false);
  });

  it('reduced motion mengikuti preferensi OS bila belum pernah disimpan', () => {
    expect(normalizeGraphics(null, { prefersReducedMotion: true }).reducedMotion).toBe(true);
    expect(normalizeGraphics({ reducedMotion: false }, { prefersReducedMotion: true }).reducedMotion).toBe(false);
  });
});

describe('resume renderer setelah pause/background', () => {
  it('preferensi pemain yang tersimpan menang atas state runtime yang di-reset', () => {
    const saved = normalizeGraphics({ quality: 'high', brightness: 1.2, reducedMotion: true });
    const runtime = { quality: 'low' as const };
    expect(resumeRendererState(saved, runtime)).toEqual({ quality: 'high', brightness: 1.2, reducedMotion: true });
  });

  it('tanpa preferensi tersimpan, kualitas runtime (hasil auto-downgrade) dipakai', () => {
    expect(resumeRendererState(null, { quality: 'low' })).toEqual({ quality: 'low', brightness: 1, reducedMotion: false });
  });
});

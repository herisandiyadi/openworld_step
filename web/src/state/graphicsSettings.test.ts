import { describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/preferences', () => ({ Preferences: { get: vi.fn(), set: vi.fn(() => Promise.resolve()), remove: vi.fn() } }));

const { DEFAULT_GRAPHICS, DENSITY_LABELS, normalizeGraphics } = await import('./graphicsSettings');
const { VEHICLE_POOL } = await import('../ambient/spawner');

describe('preset kepadatan', () => {
  it('nilai tidak sah jatuh ke default', () => {
    expect(normalizeGraphics({ density: 'high' })).toEqual({ density: 'high' });
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

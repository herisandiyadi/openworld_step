import { describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/preferences', () => ({ Preferences: { get: vi.fn(), set: vi.fn(() => Promise.resolve()), remove: vi.fn() } }));

const { AUDIBLE_RANGE, bedLevels, cueSource, cueChance, dopplerPitch, pickCue, spatial } = await import('./ambientAudio');

const listener = { x: 0, z: 0, dirX: 0, dirZ: -1 };
const at = (hour: number) => hour / 24;

describe('audio ambient', () => {
  it('gain turun dengan jarak dan nol di luar jangkauan', () => {
    expect(spatial(listener, 0, 0).gain).toBeCloseTo(1, 2);
    expect(spatial(listener, 0, -10).gain).toBeLessThan(spatial(listener, 0, -2).gain);
    expect(spatial(listener, 0, -AUDIBLE_RANGE).gain).toBe(0);
  });

  it('pan mengikuti sisi kanan arah pandang', () => {
    // Menghadap -Z (kamera three.js), jadi +X ada di kanan.
    expect(spatial(listener, 10, 0).pan).toBeCloseTo(1, 2);
    expect(spatial(listener, -10, 0).pan).toBeCloseTo(-1, 2);
    expect(spatial(listener, 0, -10).pan).toBeCloseTo(0, 2);
  });

  it('doppler: mendekat naik pitch, menjauh turun', () => {
    expect(dopplerPitch(400, -20)).toBeGreaterThan(400);
    expect(dopplerPitch(400, 20)).toBeLessThan(400);
    expect(dopplerPitch(400, 0)).toBeCloseTo(400, 5);
  });

  it('bed malam lebih sunyi dan burung hampir diam', () => {
    const siang = bedLevels('downtown', at(12));
    const malam = bedLevels('downtown', at(23));
    expect(malam.traffic).toBeLessThan(siang.traffic);
    expect(malam.crowd).toBeLessThan(siang.crowd);
    expect(malam.birds).toBeLessThan(0.1);
  });

  it('kawasan punya ciri sendiri', () => {
    expect(bedLevels('downtown', at(12)).crowd).toBeGreaterThan(bedLevels('industrial', at(12)).crowd);
    expect(bedLevels('residential', at(7)).birds).toBeGreaterThan(bedLevels('industrial', at(7)).birds);
    expect(bedLevels('downtown', at(8)).traffic).toBeGreaterThan(bedLevels('downtown', at(12)).traffic);
  });

  it('hewan lebih sering terdengar di perumahan', () => {
    expect(cueChance('residential', at(12)).bark).toBeGreaterThan(cueChance('downtown', at(12)).bark);
  });

  it('pickCue hening saat peluang nol dan memilih saat selalu lolos', () => {
    expect(pickCue('downtown', at(12), 0.25, () => 0.999)).toBeUndefined();
    expect(pickCue('downtown', at(12), 0.25, () => 0)).toBe('horn');
  });

  it('cueSource memakai agen nyata dan diam saat tidak ada yang terdengar', () => {
    const car = { x: 10, z: 0, speed: 8 };
    const ped = { x: -10, z: 0, speed: 1 };
    expect(cueSource('horn', listener, [car], [ped], () => 0)).toEqual(spatial(listener, 10, 0));
    expect(cueSource('bark', listener, [car], [ped], () => 0)?.pan).toBeCloseTo(-1, 2);
    expect(cueSource('pass', listener, [], [ped], () => 0)).toBeUndefined();
    expect(cueSource('horn', listener, [{ x: AUDIBLE_RANGE, z: 0, speed: 5 }], [], () => 0)).toBeUndefined();
    // Hewan tanpa pejalan terdekat: cincin 10-50 m, tetap terdengar.
    expect(cueSource('meow', listener, [], [], () => 0.5)?.gain).toBeGreaterThan(0);
  });
});

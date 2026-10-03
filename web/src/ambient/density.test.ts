import { describe, expect, it } from 'vitest';
import { DENSITY, densityAt, hourOf, isNight } from './density';

const at = (hour: number) => hour / 24;

describe('kepadatan agen', () => {
  it('malam hanya 22.00-05.00', () => {
    expect(hourOf(0.5)).toBe(12);
    expect(isNight(at(21.9))).toBe(false);
    expect(isNight(at(22))).toBe(true);
    expect(isNight(at(4.9))).toBe(true);
    expect(isNight(at(5))).toBe(false);
  });

  it('pejalan kaki dan kendaraan turun 60% di malam hari', () => {
    expect(densityAt('downtown', 'pedestrian', at(12))).toBe(DENSITY.downtown.pedestrian);
    expect(densityAt('downtown', 'pedestrian', at(23))).toBe(Math.round(DENSITY.downtown.pedestrian * 0.4));
    expect(densityAt('industrial', 'moto', at(2))).toBe(Math.round(DENSITY.industrial.moto * 0.4));
    expect(densityAt('residential', 'cat', at(23))).toBe(DENSITY.residential.cat);
  });

  it('ciri tiap kawasan sesuai rancangan', () => {
    expect(DENSITY.downtown.pedestrian).toBeGreaterThan(DENSITY.industrial.pedestrian);
    expect(DENSITY.downtown.pigeon).toBeGreaterThan(DENSITY.residential.pigeon);
    expect(DENSITY.residential.cat + DENSITY.residential.dog).toBeGreaterThan(DENSITY.downtown.cat + DENSITY.downtown.dog);
    expect(DENSITY.industrial.moto).toBeGreaterThan(DENSITY.residential.moto);
  });
});

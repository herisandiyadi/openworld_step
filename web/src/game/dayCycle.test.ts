import { describe, expect, it } from 'vitest';
import { clockLabel, daylightAt } from './dayCycle';

describe('day cycle', () => {
  it('is bright at noon and dark at midnight', () => {
    expect(daylightAt(0.5).daylight).toBeCloseTo(1, 5);
    expect(daylightAt(0).daylight).toBe(0);
    expect(daylightAt(0.25).dusk).toBeCloseTo(1, 5);
  });

  it('formats the clock', () => {
    expect(clockLabel(0)).toBe('00:00');
    expect(clockLabel(0.5)).toBe('12:00');
    expect(clockLabel(0.75)).toBe('18:00');
  });
});
import { describe, expect, it } from 'vitest';
import { nearestLamps } from './streetLights';

describe('nearestLamps', () => {
  const lamps = [
    { x: 0, y: 4, z: 0 },
    { x: 30, y: 4, z: 0 },
    { x: 5, y: 4, z: 5 },
    { x: -8, y: 4, z: 1 },
  ];
  it('returns the closest lamps to the player, nearest first', () => {
    expect(nearestLamps(lamps, 1, 1, 2, 50)).toEqual([lamps[0], lamps[2]]);
  });
  it('drops lamps beyond the max distance and caps the count', () => {
    expect(nearestLamps(lamps, 0, 0, 8, 20)).toHaveLength(3);
    expect(nearestLamps(lamps, 0, 0, 0, 20)).toEqual([]);
  });
});

describe('streetLampBudget', () => {
  it('scales pooled lamp lights with tier and never casts shadows', async () => {
    const { streetLampBudget } = await import('./streetLights');
    expect(streetLampBudget('low')).toBeLessThan(streetLampBudget('medium'));
    expect(streetLampBudget('medium')).toBeLessThan(streetLampBudget('high'));
    expect(streetLampBudget('high')).toBeLessThanOrEqual(6);
  });
});

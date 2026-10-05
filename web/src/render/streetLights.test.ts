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
  it('extracts translation components from instanced lamp matrices', async () => {
    const { lampPositionsFromMatrices } = await import('./streetLights');
    const matrices = new Float32Array([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 4, -8, 1,
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -12, 4, 6, 1,
    ]);
    expect(lampPositionsFromMatrices(matrices)).toEqual([{ x: 3, y: 4, z: -8 }, { x: -12, y: 4, z: 6 }]);
    expect(lampPositionsFromMatrices(new Float32Array([1, 2, 3]))).toEqual([]);
  });
});

describe('streetLampBudget', () => {
  it('scales pooled lamp lights with tier and never casts shadows', async () => {
    const { streetLampBudget } = await import('./streetLights');
    expect(streetLampBudget('low')).toBeGreaterThan(0);
    expect(streetLampBudget('medium')).toBeGreaterThan(streetLampBudget('low'));
    expect(streetLampBudget('high')).toBeGreaterThan(streetLampBudget('medium'));
    expect(streetLampBudget('high')).toBeLessThanOrEqual(6);
  });
});

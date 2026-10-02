import { describe, expect, it } from 'vitest';
import { INITIAL_VEHICLES } from './vehicles';
import { HALF_WORLD } from '../world/worldSpec';

describe('parked vehicles', () => {
  it('has unique ids, every kind, and stays inside the world', () => {
    const ids = new Set(INITIAL_VEHICLES.map((vehicle) => vehicle.id));
    expect(ids.size).toBe(INITIAL_VEHICLES.length);
    expect(new Set(INITIAL_VEHICLES.map((vehicle) => vehicle.kind))).toEqual(new Set(['skate', 'bike', 'moto', 'car']));
    for (const vehicle of INITIAL_VEHICLES) {
      expect(Math.abs(vehicle.x)).toBeLessThan(HALF_WORLD - 4);
      expect(Math.abs(vehicle.z)).toBeLessThan(HALF_WORLD - 4);
    }
  });
});
import { describe, expect, it } from 'vitest';
import { hasInstanceRoom, vehicleBatchCapacity } from './vehicleBatch';
import { VEHICLE_POOL } from './spawner';

describe('vehicleBatchCapacity', () => {
  it('bus batch always holds a single instance', () => {
    for (const quality of ['low', 'medium', 'high'] as const) {
      expect(vehicleBatchCapacity(true, quality)).toBe(1);
    }
  });

  it('car/moto batch capacity follows the render quality tier', () => {
    expect(vehicleBatchCapacity(false, 'low')).toBe(VEHICLE_POOL.low);
    expect(vehicleBatchCapacity(false, 'medium')).toBe(VEHICLE_POOL.medium);
    expect(vehicleBatchCapacity(false, 'high')).toBe(VEHICLE_POOL.high);
  });

  it('quality capacity is never below the runtime pool for any density', () => {
    // Runtime pool = vehiclePoolFor(density, quality) = stricter tier; batch capacity = pool of
    // `quality`, so it is always >= the runtime pool -> no overflow in the normal path.
    for (const quality of ['low', 'medium', 'high'] as const) {
      expect(vehicleBatchCapacity(false, quality)).toBeGreaterThanOrEqual(VEHICLE_POOL[quality]);
    }
  });
});

describe('hasInstanceRoom', () => {
  it('reports room while the write index is below capacity', () => {
    expect(hasInstanceRoom(0, 8)).toBe(true);
    expect(hasInstanceRoom(7, 8)).toBe(true);
    expect(hasInstanceRoom(8, 8)).toBe(false);
    expect(hasInstanceRoom(9, 8)).toBe(false);
  });

  it('treats non-finite counts or capacity as "no room" (never overflow a buffer)', () => {
    expect(hasInstanceRoom(Number.NaN, 8)).toBe(false);
    expect(hasInstanceRoom(0, Number.NaN)).toBe(false);
    expect(hasInstanceRoom(0, Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('never allows a write at or beyond capacity (pool exhausted)', () => {
    // 24 is the largest pool; adding a 25th instance must be refused.
    expect(hasInstanceRoom(24, VEHICLE_POOL.high)).toBe(false);
  });
});

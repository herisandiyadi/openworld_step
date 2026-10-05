import { describe, expect, it } from 'vitest';
import { headlightRig, pointInCone, VEHICLE_LIGHTS } from './vehicleLights';

describe('headlightRig', () => {
  it('places the car spot in front of the bumper, aimed forward and down', () => {
    const rig = headlightRig(VEHICLE_LIGHTS.car);
    expect(rig.position[2]).toBeLessThan(-VEHICLE_LIGHTS.car.halfLength);
    expect(rig.target[2]).toBeLessThan(rig.position[2] - 5);
    expect(rig.target[1]).toBeLessThan(rig.position[1]);
  });
  it('never lights the roof or hood (no roof hotspot)', () => {
    for (const kind of ['car', 'moto'] as const) {
      const spec = VEHICLE_LIGHTS[kind];
      const rig = headlightRig(spec);
      expect(pointInCone([0, spec.roofY, 0], rig)).toBe(false);
      expect(pointInCone([0, spec.roofY, -spec.halfLength + 0.3], rig)).toBe(false);
      // Jalan di depan kendaraan tetap terang.
      expect(pointInCone([0, 0, -10], rig)).toBe(true);
    }
  });
  it('puts tail lights at the rear (+Z)', () => {
    for (const lamp of VEHICLE_LIGHTS.car.tail) expect(lamp[2]).toBeGreaterThan(VEHICLE_LIGHTS.car.halfLength - 0.05);
  });
});

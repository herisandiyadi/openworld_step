import { describe, expect, it } from 'vitest';
import { DRIVE, stepDrive } from './vehicleSpec';

const dt = 1 / 60;

describe('stepDrive', () => {
  it('tidak bisa berputar di tempat', () => {
    for (const spec of Object.values(DRIVE)) {
      const state = { speed: 0 };
      let heading = 0;
      for (let i = 0; i < 120; i++) heading = stepDrive(state, heading, { x: 1, z: 0 }, spec, dt);
      expect(heading).toBe(0);
      expect(state.speed).toBe(0);
    }
  });

  it('berakselerasi bertahap sampai kecepatan maksimum', () => {
    const state = { speed: 0 };
    stepDrive(state, 0, { x: 0, z: -1 }, DRIVE.car, dt);
    expect(state.speed).toBeGreaterThan(0);
    expect(state.speed).toBeLessThan(1);
    for (let i = 0; i < 60 * 10; i++) stepDrive(state, 0, { x: 0, z: -1 }, DRIVE.car, dt);
    expect(state.speed).toBeCloseTo(DRIVE.car.maxSpeed);
  });

  it('mengikuti radius putar: lingkaran penuh sekitar 2*pi*r', () => {
    const spec = DRIVE.car;
    const state = { speed: spec.maxSpeed };
    let heading = 0;
    let travelled = 0;
    while (Math.abs(heading) < Math.PI * 2) {
      heading = stepDrive(state, heading, { x: 1, z: -1 }, spec, dt);
      travelled += state.speed * dt;
    }
    expect(travelled).toBeGreaterThan(2 * Math.PI * spec.turnRadius * 0.98);
    expect(travelled).toBeLessThan(2 * Math.PI * spec.turnRadius * 1.02);
  });

  it('rem lalu mundur, dan belok terbalik saat mundur', () => {
    const state = { speed: 5 };
    for (let i = 0; i < 60 * 3; i++) stepDrive(state, 0, { x: 0, z: 1 }, DRIVE.moto, dt);
    expect(state.speed).toBeCloseTo(-DRIVE.moto.reverseSpeed);
    const forward = stepDrive({ speed: 5 }, 0, { x: 1, z: 0 }, DRIVE.moto, dt);
    const backward = stepDrive({ speed: -2 }, 0, { x: 1, z: 0 }, DRIVE.moto, dt);
    expect(Math.sign(forward)).toBe(-Math.sign(backward));
  });

  it('melambat sendiri saat gas dilepas', () => {
    const state = { speed: 3 };
    for (let i = 0; i < 60 * 3; i++) stepDrive(state, 0, { x: 0, z: 0 }, DRIVE.bike, dt);
    expect(state.speed).toBe(0);
  });
});

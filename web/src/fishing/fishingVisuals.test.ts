import { describe, expect, it, vi } from 'vitest';
import { createFishingLine, disposeFishingLine } from './FishingVisuals';
import { bobberDynamics, castTrajectory, fishingTarget, isBiting } from './fishingVisuals';
import type { FishingScenePoint } from './FishingScene';

const HAND: FishingScenePoint = { x: 0, y: 1.35, z: 0 };
const SPOT: FishingScenePoint = { x: 0, y: 0, z: -4 };
const WATER_Y = 0;

describe('fishingTarget', () => {
  it('uses spot metadata when available and falls back in front of the player', () => {
    expect(fishingTarget({ x: 1, z: 2, heading: 0 }, { id: 's', x: 10, z: 20, yaw: 0 }, 0))
      .toEqual({ x: 10, y: 0, z: 16.8 });
    expect(fishingTarget({ x: 5, z: 6, heading: 0 }, undefined, 0.4))
      .toEqual({ x: 5, y: 0.4, z: 2 });
  });
});

describe('castTrajectory', () => {
  it('starts at the rod hand and ends at the water spot', () => {
    const start = castTrajectory(HAND, SPOT, 0);
    const end = castTrajectory(HAND, SPOT, 1);
    expect(start).toEqual({ x: 0, y: 1.35, z: 0 });
    expect(end.x).toBeCloseTo(0);
    expect(end.y).toBeCloseTo(0);
    expect(end.z).toBeCloseTo(-4);
  });

  it('starts at the rod hand height, not the surface, when the spot is at WATER_Y', () => {
    const start = castTrajectory(HAND, { x: 0, y: WATER_Y, z: -4 }, 0);
    expect(start.y).toBeCloseTo(1.35);
  });

  it('ends at the spot y when the spot is elevated above the hand plane', () => {
    const end = castTrajectory(HAND, { x: 0, y: 0.4, z: -4 }, 1);
    expect(end.y).toBeCloseTo(0.4);
  });

  it('is monotonic from launch to landing', () => {
    expect(castTrajectory(HAND, SPOT, 0.3).z).toBeLessThan(0);
    expect(castTrajectory(HAND, SPOT, 0.7).z).toBeLessThan(-2);
  });

  it('arcs above the straight line mid-flight', () => {
    const mid = castTrajectory(HAND, SPOT, 0.5);
    const straightY = HAND.y + (WATER_Y - HAND.y) * 0.5;
    expect(mid.y).toBeGreaterThan(straightY);
  });

  it('clamps progress outside 0..1', () => {
    expect(castTrajectory(HAND, SPOT, 1.5)).toEqual(castTrajectory(HAND, SPOT, 1));
    expect(castTrajectory(HAND, SPOT, -0.5)).toEqual(castTrajectory(HAND, SPOT, 0));
  });
});

describe('bobberDynamics', () => {
  it('floats above the water line while waiting', () => {
    expect(bobberDynamics(WATER_Y, false, 0)).toBeGreaterThan(0);
    expect(bobberDynamics(WATER_Y, false, 10)).toBeGreaterThan(0);
  });

  it('bobs gently at rest', () => {
    const rest = bobberDynamics(WATER_Y, false, 0);
    const bobbed = bobberDynamics(WATER_Y, false, 1);
    expect(bobbed).toBeGreaterThan(rest - 0.03);
    expect(bobbed).toBeLessThan(rest + 0.03);
  });

  it('dips and vibrates when biting, tension pulls it below the surface', () => {
    const bite = bobberDynamics(WATER_Y, true, 0.5);
    const tension = bobberDynamics(WATER_Y, false, 0, 0.75);
    expect(bite).toBeLessThan(0);
    expect(tension).toBeLessThan(0);
  });
});

describe('isBiting', () => {
  it('is true only during the bite phase', () => {
    expect(isBiting('bite')).toBe(true);
    for (const phase of ['cast', 'wait', 'reel', 'result'] as const) expect(isBiting(phase)).toBe(false);
  });
});

describe('FishingLine GPU resource lifecycle', () => {
  it('disposes both owned resources and remains safe when StrictMode cleanup repeats', () => {
    const line = createFishingLine();
    const geometryDispose = vi.spyOn(line.geometry, 'dispose');
    const material = Array.isArray(line.material) ? line.material[0] : line.material;
    if (!material) throw new Error('expected fishing line material');
    const materialDispose = vi.spyOn(material, 'dispose');

    disposeFishingLine(line);
    disposeFishingLine(line);

    expect(geometryDispose).toHaveBeenCalledTimes(2);
    expect(materialDispose).toHaveBeenCalledTimes(2);
  });
});

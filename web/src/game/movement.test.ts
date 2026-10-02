import { describe, expect, it } from 'vitest';
import { type CollisionWorld, followPath, type PlayerState, pushOutOfBoxes, resolveTarget, stepPlayer } from './movement';

const world: CollisionWorld = {
  boxes: [{ minX: 2, maxX: 4, minZ: -1, maxZ: 1 }],
  bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
};

const makePlayer = (): PlayerState => ({ x: 0, z: 0, heading: 0, target: null, path: [], stuckTime: 0 });

describe('stepPlayer', () => {
  it('moves along joystick input at the given speed and faces the movement direction', () => {
    const player = makePlayer();
    stepPlayer(player, { x: 0, z: -1 }, 5, 0.4, 0.1, world);
    expect(player.z).toBeCloseTo(-0.5);
    expect(player.heading).toBeCloseTo(0);
  });

  it('cancels click-to-move when the joystick is used', () => {
    const player = makePlayer();
    player.target = { x: -5, z: 0 };
    stepPlayer(player, { x: 0, z: 1 }, 5, 0.4, 0.1, world);
    expect(player.target).toBeNull();
  });

  it('reaches a click-to-move target without overshooting', () => {
    const player = makePlayer();
    player.target = { x: -1, z: 0 };
    for (let i = 0; i < 20; i++) stepPlayer(player, { x: 0, z: 0 }, 5, 0.4, 0.05, world);
    expect(player.x).toBeCloseTo(-1, 1);
    expect(player.target).toBeNull();
  });

  it('does not walk through buildings and drops a blocked target', () => {
    const player = makePlayer();
    player.target = { x: 8, z: 0 };
    for (let i = 0; i < 60; i++) stepPlayer(player, { x: 0, z: 0 }, 5, 0.4, 0.05, world);
    expect(player.x).toBeLessThanOrEqual(2 - 0.4 + 1e-6);
    expect(player.target).toBeNull();
  });

  it('stays inside world bounds', () => {
    const player = makePlayer();
    for (let i = 0; i < 100; i++) stepPlayer(player, { x: -1, z: 0 }, 10, 0.4, 0.05, world);
    expect(player.x).toBeCloseTo(-10 + 0.4);
  });
});

describe('collision helpers', () => {
  it('pushes a point inside a box to the nearest face', () => {
    const point = { x: 2.2, z: 0 };
    pushOutOfBoxes(point, 0.4, world.boxes);
    expect(point.x).toBeCloseTo(1.6);
  });

  it('moves a tap on a building to a walkable spot', () => {
    const target = resolveTarget({ x: 3.9, z: 0 }, 0.4, world);
    expect(target.x).toBeCloseTo(4.4);
  });
});

describe('followPath', () => {
  it('walks waypoints in order around an obstacle', () => {
    const player = makePlayer();
    followPath(player, [
      { x: 0, z: 3 },
      { x: 6, z: 3 },
      { x: 6, z: 0 },
    ]);
    for (let i = 0; i < 100; i++) stepPlayer(player, { x: 0, z: 0 }, 5, 0.4, 0.05, world);
    expect(player.x).toBeCloseTo(6, 1);
    expect(player.z).toBeCloseTo(0, 1);
    expect(player.target).toBeNull();
    expect(player.path).toHaveLength(0);
  });

  it('drops the remaining path when the joystick takes over', () => {
    const player = makePlayer();
    followPath(player, [
      { x: 0, z: 3 },
      { x: 6, z: 3 },
    ]);
    stepPlayer(player, { x: 1, z: 0 }, 5, 0.4, 0.05, world);
    expect(player.target).toBeNull();
    expect(player.path).toHaveLength(0);
  });
});
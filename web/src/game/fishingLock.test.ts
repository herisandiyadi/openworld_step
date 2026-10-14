import { beforeEach, describe, expect, it } from 'vitest';
import { createFishingMovementLock, enforceFishingMovementLock, filterFishingInput } from './fishingLock';
import { jumpState } from './runtime';
import type { PlayerState } from './movement';

const player = (): PlayerState => ({
  x: 4,
  z: -7,
  heading: 1.25,
  target: { x: 10, z: 10 },
  path: [{ x: 8, z: 8 }],
  stuckTime: 0.2,
});

describe('fishing movement lock', () => {
  let state: PlayerState;

  beforeEach(() => {
    state = player();
    jumpState.y = 0.5;
    jumpState.vy = 2;
  });

  it('captures the starting position and yaw and clears navigation immediately', () => {
    const lock = createFishingMovementLock();
    enforceFishingMovementLock(lock, true, state);

    expect(lock.pose).toEqual({ x: 4, z: -7, heading: 1.25 });
    expect(state.target).toBeNull();
    expect(state.path).toEqual([]);
    expect(state.stuckTime).toBe(0);
    expect(jumpState).toEqual({ y: 0, vy: 0 });
  });

  it('restores position and yaw after any external movement while fishing', () => {
    const lock = createFishingMovementLock();
    enforceFishingMovementLock(lock, true, state);
    Object.assign(state, { x: 99, z: 42, heading: -2, target: { x: 0, z: 0 } });

    enforceFishingMovementLock(lock, true, state);

    expect({ x: state.x, z: state.z, heading: state.heading }).toEqual({ x: 4, z: -7, heading: 1.25 });
    expect(state.target).toBeNull();
  });

  it('releases after the session clears and captures a new session independently', () => {
    const lock = createFishingMovementLock();
    enforceFishingMovementLock(lock, true, state);
    enforceFishingMovementLock(lock, false, state);
    Object.assign(state, { x: 12, z: 3, heading: -0.5 });
    enforceFishingMovementLock(lock, true, state);

    expect(lock.pose).toEqual({ x: 12, z: 3, heading: -0.5 });
  });

  it('suppresses keyboard and mobile joystick vectors while fishing', () => {
    expect(filterFishingInput(true, { x: 0.6, z: -0.8 })).toEqual({ x: 0, z: 0 });
    expect(filterFishingInput(false, { x: 0.6, z: -0.8 })).toEqual({ x: 0.6, z: -0.8 });
  });
});

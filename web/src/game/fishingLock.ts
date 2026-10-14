import type { PlayerState, Vec2 } from './movement';
import { jumpState } from './runtime';

export interface FishingLockedPose {
  x: number;
  z: number;
  heading: number;
}

export interface FishingMovementLock {
  pose: FishingLockedPose | null;
}

export const createFishingMovementLock = (): FishingMovementLock => ({ pose: null });

/**
 * Freezes all horizontal motion at the first active-fishing frame. Reapplying the
 * captured pose makes the lock authoritative over taps, vehicles and net writes.
 */
export function enforceFishingMovementLock(
  lock: FishingMovementLock,
  fishing: boolean,
  state: PlayerState,
): boolean {
  if (!fishing) {
    lock.pose = null;
    return false;
  }
  lock.pose ??= { x: state.x, z: state.z, heading: state.heading };
  state.x = lock.pose.x;
  state.z = lock.pose.z;
  state.heading = lock.pose.heading;
  state.target = null;
  state.path.length = 0;
  state.stuckTime = 0;
  jumpState.y = 0;
  jumpState.vy = 0;
  return true;
}

const ZERO_INPUT: Readonly<Vec2> = Object.freeze({ x: 0, z: 0 });

/** Shared gate for keyboard and touch vectors before locomotion/steering. */
export function filterFishingInput(fishing: boolean, input: Vec2): Vec2 {
  return fishing ? ZERO_INPUT : input;
}

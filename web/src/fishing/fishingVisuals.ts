import type { FishingSessionPhase } from './FishingController';
import type { FishingScenePoint } from './FishingScene';

export interface FishingSpotPoint {
  id: string;
  x: number;
  z: number;
  yaw: number;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Spot metadata wins; otherwise cast a deterministic distance in front of the locked player yaw. */
export function fishingTarget(
  player: { x: number; z: number; heading: number },
  spot: FishingSpotPoint | undefined,
  waterY: number,
): FishingScenePoint {
  if (spot) {
    const shoreOffset = 3.2;
    return {
      x: spot.x - Math.sin(spot.yaw) * shoreOffset,
      y: waterY,
      z: spot.z - Math.cos(spot.yaw) * shoreOffset,
    };
  }
  return {
    x: player.x - Math.sin(player.heading) * 4,
    y: waterY,
    z: player.z - Math.cos(player.heading) * 4,
  };
}

/** Parabolic hand-to-water cast path. */
export function castTrajectory(
  from: FishingScenePoint,
  to: FishingScenePoint,
  progress: number,
): FishingScenePoint {
  const t = clamp01(progress);
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t + Math.sin(Math.PI * t) * 1.25,
    z: from.z + (to.z - from.z) * t,
  };
}

/** Water-relative bobber height with bite shake and reel-tension dip. */
export function bobberDynamics(
  waterY: number,
  biting: boolean,
  elapsedSeconds: number,
  tension = 0,
): number {
  const wave = Math.sin(elapsedSeconds * (biting ? 24 : 3.5)) * (biting ? 0.035 : 0.018);
  return waterY + 0.03 + wave - (biting ? 0.14 : 0) - clamp01(tension) * 0.16;
}

export const isBiting = (phase: FishingSessionPhase): boolean => phase === 'bite';

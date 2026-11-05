export const FISHING_CAST_MS = 700;

export type FishingPosePhase = 'idle' | 'casting' | 'release' | 'holding';

export interface FishingPose {
  rodYaw: number;
  rodPitch: number;
  rodRoll: number;
  rise: number;
  grounded: boolean;
}

const POSES: Record<FishingPosePhase, FishingPose> = {
  idle: { rodYaw: 0, rodPitch: 0, rodRoll: 0, rise: 0, grounded: false },
  casting: { rodYaw: 0, rodPitch: -1.05, rodRoll: 0.3, rise: 0.2, grounded: true },
  release: { rodYaw: 0, rodPitch: -0.1, rodRoll: -0.15, rise: 0, grounded: true },
  holding: { rodYaw: 0, rodPitch: -0.25, rodRoll: -0.1, rise: 0, grounded: true },
};

export const castPhases = (phase: FishingPosePhase): FishingPose => POSES[phase];

/** Smooth 0..1 easing for cast trajectory and fallback upper-body posing. */
export const smoothCast = (progress: number): number => {
  const clamped = Math.min(1, Math.max(0, progress));
  return clamped * clamped * (3 - 2 * clamped);
};

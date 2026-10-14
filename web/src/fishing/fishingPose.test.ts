import { describe, expect, it } from 'vitest';
import { castPhases, FISHING_CAST_MS } from './fishingPose';

describe('fishingPose', () => {
  it('defines a one-shot cast window under one second', () => {
    expect(FISHING_CAST_MS).toBeGreaterThan(300);
    expect(FISHING_CAST_MS).toBeLessThan(1500);
  });

  it('places the rod in the hand, aimed forward, rising through the cast', () => {
    expect(castPhases('casting')).toEqual({ rodYaw: 0, rodPitch: -1.05, rodRoll: 0.3, rise: 0.2, grounded: true });
    expect(castPhases('release')).toEqual({ rodYaw: 0, rodPitch: -0.1, rodRoll: -0.15, rise: 0, grounded: true });
  });

  it('holds a steady fishing pose after the cast completes', () => {
    expect(castPhases('holding')).toEqual({ rodYaw: 0, rodPitch: -0.25, rodRoll: -0.1, rise: 0, grounded: true });
  });

  it('drops back to the idle pose once the session clears', () => {
    expect(castPhases('idle')).toEqual({ rodYaw: 0, rodPitch: 0, rodRoll: 0, rise: 0, grounded: false });
  });
});

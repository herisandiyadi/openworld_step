import { beforeEach, describe, expect, it } from 'vitest';
import { NO_NEARBY, useGameStore } from '../state/gameStore';
import { keyboardInput, joystickInput, playerState } from './runtime';
import { keyboardVectorDuringFishing, filteredRawInput } from './inputLock';
import type { FishingSession } from '../fishing/FishingController';

const session = {
  phase: 'wait', spotId: 'lake', phaseEnteredAt: 0, lastStepAt: 0, castWindowMs: 700,
  waitMs: 3000, biteWindowMs: 1200, easyMode: false, carbonRod: false, bait: false,
  hour: 12, catchesAtSpot: 0,
  callbacks: { now: () => 0, rng: () => 0, vibrate: () => undefined, playSound: () => undefined },
} as unknown as FishingSession;

describe('input gate during fishing (mobile joystick + keyboard)', () => {
  beforeEach(() => {
    useGameStore.setState({ fishing: null, nearby: { ...NO_NEARBY }, mode: 'walk' });
    Object.assign(playerState, { x: 1, z: 2, heading: 0, target: null, path: [], stuckTime: 0 });
  });

  it('zeroes the raw walk vector before stepPlayer while fishing', () => {
    expect(filteredRawInput(true, { x: 0.5, z: -0.5 })).toEqual({ x: 0, z: 0 });
    expect(filteredRawInput(false, { x: 0.5, z: -0.5 })).toEqual({ x: 0.5, z: -0.5 });
  });

  it('zeroes the keyboard input object while fishing', () => {
    keyboardInput.x = 0.4;
    keyboardInput.z = 0.4;
    keyboardVectorDuringFishing(true);
    expect(keyboardInput).toEqual({ x: 0, z: 0 });

    keyboardVectorDuringFishing(false);
    keyboardInput.x = 0.7;
    expect(keyboardInput.x).toBe(0.7);
  });

  it('leaves the joystick untouched for the knob but zeroes locomotion via the same gate', () => {
    joystickInput.x = 0.9;
    joystickInput.z = -0.9;
    expect(filteredRawInput(true, { x: joystickInput.x, z: joystickInput.z })).toEqual({ x: 0, z: 0 });
  });

  it('blocks tap-to-move navigation while fishing', () => {
    useGameStore.setState({ fishing: session });
    expect(useGameStore.getState().fishing).not.toBeNull();
    expect(filteredRawInput(true, { x: 1, z: 0 })).toEqual({ x: 0, z: 0 });
  });
});

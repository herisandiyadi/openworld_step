import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from '../state/gameStore';
import { isPlayerActionBlocked } from './actions';
import { selectClip, shouldUseFishingFallback, useFishingPose } from './Hero';
import type { FishingSession } from '../fishing/FishingController';

const session = {
  phase: 'wait', spotId: 'lake', phaseEnteredAt: 0, lastStepAt: 0, castWindowMs: 700,
  waitMs: 3000, biteWindowMs: 1200, easyMode: false, carbonRod: false, bait: false,
  hour: 12, catchesAtSpot: 0,
  callbacks: { now: () => 0, rng: () => 0, vibrate: () => undefined, playSound: () => undefined },
} as FishingSession;

const baseState = () => ({
  fishing: null as FishingSession | null,
  mode: 'walk' as const,
  seated: false,
  paused: false,
  mapOpen: false,
  chatNpcId: null,
  busMenuOpen: false,
  soakActive: false,
  busRide: null,
});

describe('fishing hero pose', () => {
  beforeEach(() => {
    useGameStore.setState(baseState());
  });

  it('locks locomotion clips to the idle pose while fishing, regardless of speed', () => {
    expect(selectClip('walk', 4.5)).toEqual({ name: 'anim_Run', timeScale: 1 });
    expect(selectClip('walk', 0)).toEqual({ name: 'anim_Idle', timeScale: 1 });
    expect(selectClip('bike', 10).name).toBe('anim_Bike');
    expect(selectClip('moto', 10)).toEqual({ name: 'anim_Bike', timeScale: 0 });
  });

  it('selects the real anim_Cast clip only when the asset ships one', () => {
    expect(shouldUseFishingFallback([])).toBe(true);
    expect(shouldUseFishingFallback(['anim_Idle', 'anim_Cast'])).toBe(false);
  });

  it('uses the fallback pose only while a fishing session is active', () => {
    expect(useFishingPose(false, [], 0)).toEqual({ fallback: true, clip: null });
    expect(useFishingPose(false, ['anim_Cast'], 0)).toEqual({ fallback: true, clip: null });
    expect(useFishingPose(true, [], 0)).toEqual({ fallback: true, clip: 'anim_Idle' });
    expect(useFishingPose(true, ['anim_Cast'], 0.1)).toEqual({ fallback: false, clip: 'anim_Cast' });
    expect(useFishingPose(true, [], 0.9)).toEqual({ fallback: true, clip: 'anim_Idle' });
  });

  it('exposes the shared blocked check used by the fishing HUD gate', () => {
    expect(isPlayerActionBlocked()).toBe(false);
    useGameStore.setState({ fishing: session });
    expect(isPlayerActionBlocked()).toBe(true);
  });
});

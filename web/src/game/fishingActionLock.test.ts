import { beforeEach, describe, expect, it } from 'vitest';
import { isPlayerActionBlocked, jump, toggleSeat, toggleVehicle } from './actions';
import { NO_NEARBY, useGameStore } from '../state/gameStore';
import { jumpState, playerState } from './runtime';
import type { FishingSession } from '../fishing/FishingController';

const session = {
  phase: 'wait', spotId: 'lake', phaseEnteredAt: 0, lastStepAt: 0, castWindowMs: 700,
  waitMs: 3000, biteWindowMs: 1200, easyMode: false, carbonRod: false, bait: false,
  hour: 12, catchesAtSpot: 0,
  callbacks: { now: () => 0, rng: () => 0, vibrate: () => undefined, playSound: () => undefined },
} as FishingSession;

describe('player actions during fishing', () => {
  beforeEach(() => {
    useGameStore.setState({
      fishing: session,
      mode: 'walk',
      riding: null,
      seated: false,
      nearby: { ...NO_NEARBY, vehicleId: 'bike-a', seatId: 'bench-a' },
      paused: false,
      mapOpen: false,
      chatNpcId: null,
      busMenuOpen: false,
      soakActive: false,
      busRide: null,
    });
    Object.assign(playerState, { x: 2, z: 3, heading: 0.4 });
    jumpState.y = 0;
    jumpState.vy = 0;
  });

  it('reports every normal player action blocked during a session', () => {
    expect(isPlayerActionBlocked()).toBe(true);
  });

  it('blocks jump, vehicle and seat keyboard/button action entry points', () => {
    const before = { x: playerState.x, z: playerState.z, heading: playerState.heading };
    jump();
    toggleVehicle();
    toggleSeat();

    expect(jumpState.vy).toBe(0);
    expect(useGameStore.getState().riding).toBeNull();
    expect(useGameStore.getState().seated).toBe(false);
    expect({ x: playerState.x, z: playerState.z, heading: playerState.heading }).toEqual(before);
  });
});

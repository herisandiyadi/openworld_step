import { describe, expect, it, vi } from 'vitest';
import { decodeFishingSync } from './fishingSync';
import type { FishingSession } from './FishingController';
import { createFishingMultiplayerBridge } from './fishingMultiplayerBridge';

const session = (phase: FishingSession['phase']): FishingSession => ({
  phase,
  spotId: 'spot-1',
  phaseEnteredAt: 0,
  lastStepAt: 0,
  castWindowMs: 700,
  waitMs: 3000,
  biteWindowMs: 1200,
  easyMode: false,
  carbonRod: false,
  bait: false,
  hour: 12,
  catchesAtSpot: 0,
  callbacks: { now: () => 0, rng: () => 0, vibrate: () => undefined, playSound: () => undefined },
});

describe('fishing multiplayer bridge', () => {
  it('forwards reservation identity to the host adapter', () => {
    const reserve = vi.fn(() => true);
    const release = vi.fn();
    const bridge = createFishingMultiplayerBridge('p7', reserve, release);
    expect(bridge.reserve('spot-1', 45)).toBe(true);
    bridge.release('spot-1');
    expect(reserve).toHaveBeenCalledWith('spot-1', 'p7', 45);
    expect(release).toHaveBeenCalledWith('spot-1', 'p7');
  });

  it('publishes sessions with the existing fishing sync codec', () => {
    let payload: Uint8Array | undefined;
    const bridge = createFishingMultiplayerBridge('p7', () => true, () => undefined, (bytes) => { payload = bytes; });
    bridge.publish?.(session('bite'));
    const decoded = payload ? decodeFishingSync(payload) : null;
    expect(decoded?.ok && decoded.state.phase).toBe('bite');
    bridge.publish?.(null);
    const idle = payload ? decodeFishingSync(payload) : null;
    expect(idle?.ok && idle.state.phase).toBe('idle');
  });
});

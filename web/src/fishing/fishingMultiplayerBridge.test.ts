import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeFishingSync, encodeFishingSync } from './fishingSync';
import type { FishingSession } from './FishingController';
import { createFishingMultiplayerBridge, createLiveFishingMultiplayerBridge } from './fishingMultiplayerBridge';
import * as netRuntime from '../net/netRuntime';

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

describe('live fishing multiplayer bridge', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses live netRuntime for host reservation and client request paths', () => {
    const reserve = vi.spyOn(netRuntime, 'reserveFishingSpot').mockReturnValue(true);
    const release = vi.spyOn(netRuntime, 'releaseFishingSpot').mockReturnValue(true);
    vi.spyOn(netRuntime, 'localPlayerId').mockReturnValue(7);
    const bridge = createLiveFishingMultiplayerBridge();
    expect(bridge?.playerId).toBe('7');
    expect(bridge?.reserve('lake-east', 123)).toBe(true);
    bridge?.release('lake-east');
    expect(reserve).toHaveBeenCalledWith('lake-east');
    expect(release).toHaveBeenCalledWith('lake-east');
    bridge?.close?.();
  });

  it('returns null when no net session is active', () => {
    vi.spyOn(netRuntime, 'localPlayerId').mockReturnValue(null);
    expect(createLiveFishingMultiplayerBridge()).toBeNull();
  });

  it('publishes encoded state and receives decoded remote state from netRuntime', () => {
    let listener: ((playerId: number, sequence: number, payload: Uint8Array) => void) | undefined;
    vi.spyOn(netRuntime, 'localPlayerId').mockReturnValue(7);
    const publish = vi.spyOn(netRuntime, 'publishFishingState').mockReturnValue(true);
    vi.spyOn(netRuntime, 'onFishingState').mockImplementation((cb) => {
      listener = cb;
      return () => undefined;
    });
    const remote = vi.fn();
    const bridge = createLiveFishingMultiplayerBridge(remote);
    bridge?.publish?.(session('reel'));
    expect(publish).toHaveBeenCalledTimes(1);
    const sent = publish.mock.calls[0]?.[0];
    const decoded = sent ? decodeFishingSync(sent) : null;
    expect(decoded?.ok && decoded.state.phase).toBe('reel');

    listener?.(9, 3, encodeFishingSync({ phase: 'wait', spotIndex: 2, bobberX: 1, bobberZ: -2 }));
    expect(remote).toHaveBeenCalledWith({ playerId: 9, sequence: 3, state: { phase: 'wait', spotIndex: 2, bobberX: 1, bobberZ: -2 } });
    listener?.(9, 2, encodeFishingSync({ phase: 'bite', spotIndex: 2, bobberX: 1, bobberZ: -2 }));
    expect(remote).toHaveBeenCalledTimes(1);
    bridge?.close?.();
  });

  it('drops malformed remote state rather than exposing it', () => {
    let listener: ((playerId: number, sequence: number, payload: Uint8Array) => void) | undefined;
    vi.spyOn(netRuntime, 'localPlayerId').mockReturnValue(7);
    vi.spyOn(netRuntime, 'onFishingState').mockImplementation((cb) => {
      listener = cb;
      return () => undefined;
    });
    const remote = vi.fn();
    createLiveFishingMultiplayerBridge(remote);
    listener?.(9, 3, new Uint8Array(7));
    expect(remote).not.toHaveBeenCalled();
  });
});

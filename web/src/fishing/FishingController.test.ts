/**
 * FishingController state-machine tests.
 *
 * All injectable callbacks (rng, time, vibrate, audio) are replaced with
 * deterministic stubs so the suite never touches real timers, DOM, or audio.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createFishingSession,
  advanceFishingSession,
  cancelFishingSession,
  type FishingSession,
  type FishingSessionOptions,
} from './FishingController';

// ─── stub factories ────────────────────────────────────────────────────────────

function mkSession(opts: Partial<FishingSessionOptions> = {}): FishingSession {
  const t = 0;
  return createFishingSession({
    spotId: 'spot-1',
    easyMode: false,
    ...opts,
    callbacks: {
      rng: opts.callbacks?.rng ?? (() => 0.5),
      now: opts.callbacks?.now ?? (() => t),
      vibrate: opts.callbacks?.vibrate ?? vi.fn(),
      playSound: opts.callbacks?.playSound ?? vi.fn(),
    },
  });
}

// ─── state machine happy path ──────────────────────────────────────────────────

describe('FishingController – cast/wait/bite/reel/result cycle', () => {
  it('starts in the cast phase', () => {
    const s = mkSession();
    expect(s.phase).toBe('cast');
    expect(s.spotId).toBe('spot-1');
  });

  it('transitions to wait after the cast animation window elapses', () => {
    let t = 0;
    const s0 = createFishingSession({
      spotId: 'spot-1',
      easyMode: false,
      callbacks: { rng: () => 0.5, now: () => t, vibrate: vi.fn(), playSound: vi.fn() },
    });
    t = s0.castWindowMs + 50;
    const s1 = advanceFishingSession(s0, { now: t });
    expect(s1.phase).toBe('wait');
  });

  it('stays in wait until the bite delay expires', () => {
    let t = 0;
    const s0 = createFishingSession({
      spotId: 'spot-1',
      easyMode: false,
      callbacks: { rng: () => 0.5, now: () => t, vibrate: vi.fn(), playSound: vi.fn() },
    });
    // Jump through cast
    t = s0.castWindowMs + 50;
    const sWait = advanceFishingSession(s0, { now: t });
    expect(sWait.phase).toBe('wait');
    // Still before bite
    t = s0.castWindowMs + 50 + 1000;
    const sStill = advanceFishingSession(sWait, { now: t });
    expect(sStill.phase).toBe('wait');
  });

  it('transitions to bite after the wait delay, fires vibrate + playSound', () => {
    const vibrate = vi.fn();
    const playSound = vi.fn();
    let t = 0;
    const s0 = createFishingSession({
      spotId: 'spot-1',
      easyMode: false,
      callbacks: { rng: () => 0.5, now: () => t, vibrate, playSound },
    });
    t = s0.castWindowMs + s0.waitMs + 100;
    // advance past cast window first
    const s2 = advanceFishingSession(s0, { now: s0.castWindowMs + 50 });
    const s3 = advanceFishingSession(s2, { now: s0.castWindowMs + 50 + s0.waitMs + 50 });
    expect(s3.phase).toBe('bite');
    expect(vibrate).toHaveBeenCalled();
    expect(playSound).toHaveBeenCalledWith('bite');
  });

  it('transitions to reel when the player presses pull within 1.2 s of bite', () => {
    let t = 0;
    const s0 = createFishingSession({
      spotId: 'spot-1',
      easyMode: false,
      callbacks: { rng: () => 0.5, now: () => t, vibrate: vi.fn(), playSound: vi.fn() },
    });
    // fast-forward through cast → wait → bite
    const sCast = advanceFishingSession(s0, { now: s0.castWindowMs + 50 });
    const sBite = advanceFishingSession(sCast, { now: s0.castWindowMs + 50 + s0.waitMs + 50 });
    expect(sBite.phase).toBe('bite');
    // pull within window
    t = sBite.phaseEnteredAt + 800;
    const sReel = advanceFishingSession(sBite, { now: t, pull: true });
    expect(sReel.phase).toBe('reel');
  });

  it('transitions to result/missed when the 1.2 s bite window expires without a pull', () => {
    let t = 0;
    const s0 = createFishingSession({
      spotId: 'spot-1',
      easyMode: false,
      callbacks: { rng: () => 0.5, now: () => t, vibrate: vi.fn(), playSound: vi.fn() },
    });
    const sCast = advanceFishingSession(s0, { now: s0.castWindowMs + 50 });
    const sBite = advanceFishingSession(sCast, { now: s0.castWindowMs + 50 + s0.waitMs + 50 });
    // exceed 1.2 s without pulling
    t = sBite.phaseEnteredAt + 1300;
    const sMissed = advanceFishingSession(sBite, { now: t });
    expect(sMissed.phase).toBe('result');
    expect(sMissed.outcome).toBe('missed');
  });

  it('transitions to result after minigame reports won', () => {
    let t = 0;
    const s0 = createFishingSession({
      spotId: 'spot-1',
      easyMode: false,
      callbacks: { rng: () => 0.5, now: () => t, vibrate: vi.fn(), playSound: vi.fn() },
    });
    const sCast = advanceFishingSession(s0, { now: s0.castWindowMs + 50 });
    const sBite = advanceFishingSession(sCast, { now: s0.castWindowMs + 50 + s0.waitMs + 50 });
    const sReel = advanceFishingSession(sBite, { now: sBite.phaseEnteredAt + 200, pull: true });
    expect(sReel.phase).toBe('reel');
    // Feed advance steps to win the minigame: fish fixed in zone, pulling
    let reelTime = sReel.lastStepAt;
    let cur = sReel;
    for (let i = 0; i < 90; i++) {
      reelTime += 50;
      cur = advanceFishingSession(cur, {
        now: reelTime,
        pull: true,
        fishPositionOverride: cur.minigame?.zone.position ?? 0.5,
      });
      if (cur.phase === 'result') break;
    }
    expect(cur.phase).toBe('result');
    expect(cur.outcome).toBe('caught');
    expect(cur.loot).toBeDefined();
  });

  it('transitions to result/failed after minigame line-break', () => {
    let t = 0;
    const s0 = createFishingSession({
      spotId: 'spot-1',
      easyMode: false,
      callbacks: { rng: () => 0.5, now: () => t, vibrate: vi.fn(), playSound: vi.fn() },
    });
    const sCast = advanceFishingSession(s0, { now: s0.castWindowMs + 50 });
    const sBite = advanceFishingSession(sCast, { now: s0.castWindowMs + 50 + s0.waitMs + 50 });
    const sReel = advanceFishingSession(sBite, { now: sBite.phaseEnteredAt + 200, pull: true });
    // Cause line break: fish far from zone, pulling continuously for > 1 s
    let tLb = sReel.lastStepAt;
    let cur: FishingSession = {
      ...sReel,
      minigame: sReel.minigame ? { ...sReel.minigame, zone: { ...sReel.minigame.zone, position: 0.1 } } : undefined,
    };
    for (let i = 0; i < 40; i++) {
      tLb += 50;
      cur = advanceFishingSession(cur, {
        now: tLb,
        pull: true,
        fishPositionOverride: 0.99, // fish always outside zone
      });
      if (cur.phase === 'result') break;
    }
    expect(cur.phase).toBe('result');
    expect(cur.outcome).toBe('failed');
  });
});

// ─── cancel ────────────────────────────────────────────────────────────────────

describe('FishingController – cancel', () => {
  it('cancelFishingSession returns a result/cancelled state from any phase', () => {
    const phases: Array<FishingSession['phase']> = ['cast', 'wait', 'bite', 'reel'];
    for (const phase of phases) {
      const s = mkSession();
      // Fake the phase
      const faked = { ...s, phase } as FishingSession;
      const cancelled = cancelFishingSession(faked);
      expect(cancelled.phase).toBe('result');
      expect(cancelled.outcome).toBe('cancelled');
    }
  });

  it('cancelFishingSession is a no-op when already in result phase', () => {
    const s: FishingSession = { ...mkSession(), phase: 'result', outcome: 'caught' };
    const again = cancelFishingSession(s);
    expect(again.phase).toBe('result');
    expect(again.outcome).toBe('caught');
  });
});

// ─── easy mode ─────────────────────────────────────────────────────────────────

describe('FishingController – easy mode', () => {
  it('creates a minigame with easy mode on when easyMode:true', () => {
    const s0 = mkSession({ easyMode: true });
    const sCast = advanceFishingSession(s0, { now: s0.castWindowMs + 50 });
    const sBite = advanceFishingSession(sCast, { now: s0.castWindowMs + 50 + s0.waitMs + 50 });
    const sReel = advanceFishingSession(sBite, { now: sBite.phaseEnteredAt + 200, pull: true });
    expect(sReel.minigame?.easyMode).toBe(true);
    // Zone should be 0.4 (double the 0.2 base)
    expect(sReel.minigame?.zone.size).toBeCloseTo(0.4, 5);
  });

  it('caps fish weight at 70% of species maximum in easy mode', () => {
    const values = [0.5, 0, 0, 1]; // wait, fish kind, mujair, maximum weight
    let i = 0;
    const rng = () => values[i++] ?? 1;
    const s0 = createFishingSession({
      spotId: 'spot-1',
      easyMode: true,
      callbacks: { rng, now: () => 0, vibrate: vi.fn(), playSound: vi.fn() },
    });
    const sWait = advanceFishingSession(s0, { now: s0.castWindowMs + 1 });
    const sBite = advanceFishingSession(sWait, { now: sWait.phaseEnteredAt + s0.waitMs + 1 });
    expect(sBite.pendingLoot?.species).toBe('mujair');
    expect(sBite.pendingLoot?.weight).toBeLessThanOrEqual(0.42); // 70% × 0.6 kg
  });

  it('easy mode session can never break the line', () => {
    let t = 0;
    const callbacks = { rng: () => 0.5, now: () => t, vibrate: vi.fn(), playSound: vi.fn() };
    const s0 = createFishingSession({ spotId: 'spot-1', easyMode: true, callbacks });
    const sCast = advanceFishingSession(s0, { now: s0.castWindowMs + 50 });
    const sBite = advanceFishingSession(sCast, { now: s0.castWindowMs + 50 + s0.waitMs + 50 });
    t = sBite.phaseEnteredAt + 200;
    const sReel = advanceFishingSession(sBite, { now: t, pull: true });
    let cur = sReel;
    // Apply heavy tension for > 2 s in easy mode; should never line-break
    for (let i = 0; i < 60; i++) {
      t += 50;
      cur = advanceFishingSession(cur, { now: t, pull: true, fishPositionOverride: 0.99 });
      if (cur.phase === 'result') {
        expect(cur.outcome).not.toBe('failed');
        break;
      }
    }
    // If still in reel, that's also fine — never failed from line-break
    if (cur.phase === 'reel') {
      expect(cur.minigame?.failure).toBeUndefined();
    }
  });
});

// ─── timeout / cancel edge cases ───────────────────────────────────────────────

describe('FishingController – timeout edge cases', () => {
  it('advancing a result phase session is a no-op', () => {
    const s0 = mkSession();
    const sCast = advanceFishingSession(s0, { now: s0.castWindowMs + 50 });
    const sBite = advanceFishingSession(sCast, { now: sCast.phaseEnteredAt + s0.waitMs + 50 });
    const t = sBite.phaseEnteredAt + 1300;
    const sMissed = advanceFishingSession(sBite, { now: t });
    expect(sMissed.phase).toBe('result');
    // Advance again — should remain identical
    const sAgain = advanceFishingSession(sMissed, { now: t + 9999 });
    expect(sAgain).toEqual(sMissed);
  });

  it('does not mutate the session object', () => {
    const s0 = mkSession();
    const frozen = Object.freeze({ ...s0 });
    // Should not throw
    expect(() => advanceFishingSession(frozen as FishingSession, { now: s0.castWindowMs + 50 })).not.toThrow();
  });
});

/**
 * FishingController timing-gauge state-machine tests.
 * Time, RNG, haptics and audio are injected; no real timers or browser APIs.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  advanceFishingSession,
  cancelFishingSession,
  createFishingSession,
  type FishingSession,
} from './FishingController';

function start(callbacks: Parameters<typeof createFishingSession>[0]['callbacks'] = {}): FishingSession {
  return createFishingSession({
    spotId: 'spot-1',
    callbacks: { rng: () => 0.5, now: () => 0, vibrate: vi.fn(), playSound: vi.fn(), ...callbacks },
  });
}

function reachBite(session = start()): FishingSession {
  const waiting = advanceFishingSession(session, { now: session.castWindowMs + 1 });
  return advanceFishingSession(waiting, { now: waiting.phaseEnteredAt + waiting.waitMs + 1 });
}

function withNeedle(session: FishingSession, position: number): FishingSession {
  if (!session.minigame) throw new Error('expected gauge');
  return { ...session, minigame: { ...session.minigame, needle: { ...session.minigame.needle, position } } };
}

describe('FishingController timing gauge', () => {
  it('runs cast -> wait -> bite and starts the sweeping gauge at bite', () => {
    const sounds = vi.fn();
    const vibration = vi.fn();
    const cast = start({ playSound: sounds, vibrate: vibration });
    expect(cast.phase).toBe('cast');
    const waiting = advanceFishingSession(cast, { now: cast.castWindowMs + 1 });
    expect(waiting.phase).toBe('wait');
    const bite = advanceFishingSession(waiting, { now: waiting.phaseEnteredAt + waiting.waitMs + 1 });
    expect(bite.phase).toBe('bite');
    expect(bite.minigame?.phase).toBe('active');
    expect(bite.pendingLoot).toBeDefined();
    expect(sounds).toHaveBeenCalledWith('cast');
    expect(sounds).toHaveBeenCalledWith('splash');
    expect(sounds).toHaveBeenCalledWith('bite');
    expect(vibration).toHaveBeenCalledWith(80);
  });

  it('moves the needle automatically without input while in bite', () => {
    const bite = reachBite();
    const next = advanceFishingSession(bite, { now: bite.lastStepAt + 100 });
    expect(next.phase).toBe('bite');
    expect(next.minigame!.needle.position).toBeGreaterThan(bite.minigame!.needle.position);
  });

  it('catches and exposes generated loot when tapped in the target', () => {
    const vibration = vi.fn();
    const sounds = vi.fn();
    const bite = reachBite(start({ vibrate: vibration, playSound: sounds }));
    const centered = withNeedle(bite, bite.minigame!.target.position);
    const caught = advanceFishingSession(centered, { now: centered.lastStepAt, pull: true });
    expect(caught.phase).toBe('result');
    expect(caught.outcome).toBe('caught');
    expect(caught.loot).toEqual(caught.pendingLoot);
    expect(vibration.mock.calls.map(([duration]) => duration)).toEqual([80, 10, 50]);
    expect(sounds).toHaveBeenCalledWith('reel');
    expect(sounds).toHaveBeenCalledWith('catch');
  });

  it('gives every valid tap light feedback before escaped and line-break outcomes', () => {
    const missVibration = vi.fn();
    const bite = reachBite(start({ vibrate: missVibration }));
    missVibration.mockClear();
    const near = withNeedle(bite, bite.minigame!.target.position + bite.minigame!.target.size / 2 + 0.01);
    expect(advanceFishingSession(near, { now: near.lastStepAt, pull: true }).outcome).toBe('escaped');
    expect(missVibration.mock.calls).toEqual([[10]]);

    const lineBreakSound = vi.fn();
    const breakVibration = vi.fn();
    const hardBite = reachBite(start({
      // wait roll, catch-kind roll, species roll (patin), weight roll
      rng: (() => { const values = [0.5, 0, 0.99, 0.5]; let i = 0; return () => values[i++] ?? 0.5; })(),
      playSound: lineBreakSound,
      vibrate: breakVibration,
    }));
    breakVibration.mockClear();
    expect(hardBite.minigame!.difficulty).toBeGreaterThanOrEqual(4);
    const far = withNeedle(hardBite, 0);
    const broken = advanceFishingSession(far, { now: far.lastStepAt, pull: true });
    expect(broken.outcome).toBe('line-broken');
    expect(breakVibration.mock.calls).toEqual([[10]]);
    expect(lineBreakSound).toHaveBeenCalledWith('line-break');
  });

  it('escapes when the bounded gauge time expires', () => {
    const bite = reachBite();
    const timedOut = advanceFishingSession(bite, { now: bite.lastStepAt + bite.minigame!.remainingMs });
    expect(timedOut.phase).toBe('result');
    expect(timedOut.outcome).toBe('escaped');
    expect(timedOut.loot).toBeUndefined();
  });

  it('easy mode uses a wider slower gauge and never line-breaks', () => {
    const normal = reachBite(start());
    const easyStart = createFishingSession({
      spotId: 'spot-1', easyMode: true,
      callbacks: { rng: () => 0.5, now: () => 0, vibrate: vi.fn(), playSound: vi.fn() },
    });
    const easy = reachBite(easyStart);
    expect(easy.minigame!.target.size).toBeGreaterThan(normal.minigame!.target.size);
    expect(easy.minigame!.needle.speed).toBeLessThan(normal.minigame!.needle.speed);
    const missed = advanceFishingSession(withNeedle(easy, 0), { now: easy.lastStepAt, pull: true });
    expect(missed.outcome).toBe('escaped');
  });

  it('allows only one tap and preserves terminal results', () => {
    const bite = reachBite();
    const escaped = advanceFishingSession(withNeedle(bite, 0), { now: bite.lastStepAt, pull: true });
    expect(advanceFishingSession(escaped, { now: escaped.lastStepAt + 100, pull: true })).toBe(escaped);
  });

  it('cancels any active phase but not a terminal result', () => {
    for (const phase of ['cast', 'wait', 'bite'] as const) {
      expect(cancelFishingSession({ ...start(), phase }).outcome).toBe('cancelled');
    }
    const result = { ...start(), phase: 'result' as const, outcome: 'caught' as const };
    expect(cancelFishingSession(result)).toBe(result);
  });
});

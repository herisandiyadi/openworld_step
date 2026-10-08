import { createFishingMinigame, fishingMinigameStep, type FishingMinigameState } from './fishingMinigame';
import { fishSpecies, lootTable, type FishingLoot, type FishingLootConfig } from './lootTable';

export type FishingSessionPhase = 'cast' | 'wait' | 'bite' | 'reel' | 'result';
export type FishingOutcome = 'caught' | 'missed' | 'failed' | 'cancelled';
export type FishingSound = 'cast' | 'splash' | 'bite' | 'reel' | 'line-break' | 'catch';

/** All side effects are injected, keeping the state machine deterministic and testable. */
export interface FishingCallbacks {
  readonly rng: () => number;
  readonly now: () => number;
  readonly vibrate: (durationMs: number) => void;
  readonly playSound: (sound: FishingSound) => void;
}

export interface FishingSessionOptions {
  readonly spotId: string;
  readonly easyMode?: boolean;
  readonly carbonRod?: boolean;
  readonly bait?: boolean;
  readonly hour?: number;
  readonly catchesAtSpot?: number;
  readonly fishingConfig?: FishingLootConfig;
  readonly callbacks?: Partial<FishingCallbacks>;
}

export interface FishingSession {
  readonly phase: FishingSessionPhase;
  readonly spotId: string;
  readonly phaseEnteredAt: number;
  readonly lastStepAt: number;
  readonly castWindowMs: number;
  readonly waitMs: number;
  readonly biteWindowMs: number;
  readonly easyMode: boolean;
  readonly carbonRod: boolean;
  readonly bait: boolean;
  readonly hour: number;
  readonly catchesAtSpot: number;
  readonly fishingConfig?: FishingLootConfig;
  readonly callbacks: FishingCallbacks;
  readonly minigame?: FishingMinigameState;
  readonly pendingLoot?: FishingLoot;
  readonly loot?: FishingLoot;
  readonly outcome?: FishingOutcome;
}

export interface FishingAdvanceInput {
  readonly now?: number;
  readonly pull?: boolean;
  /** Deterministic integration/test hook; production callers omit it. */
  readonly fishPositionOverride?: number;
}

const CAST_WINDOW_MS = 700;
export const BITE_WINDOW_MS = 1200;
const MIN_WAIT_MS = 3000;
const MAX_WAIT_MS = 12000;

const noop = (): void => undefined;

function callbacks(overrides: Partial<FishingCallbacks> | undefined): FishingCallbacks {
  return {
    rng: overrides?.rng ?? Math.random,
    now: overrides?.now ?? Date.now,
    vibrate: overrides?.vibrate ?? noop,
    playSound: overrides?.playSound ?? noop,
  };
}

/** Starts an attempt in the cast animation phase. No timers are allocated. */
export function createFishingSession(options: FishingSessionOptions): FishingSession {
  const sideEffects = callbacks(options.callbacks);
  const now = sideEffects.now();
  if (!options.spotId) throw new RangeError('spotId is required');
  const waitRoll = Math.min(1, Math.max(0, sideEffects.rng()));
  sideEffects.playSound('cast');
  return {
    phase: 'cast',
    spotId: options.spotId,
    phaseEnteredAt: now,
    lastStepAt: now,
    castWindowMs: CAST_WINDOW_MS,
    waitMs: MIN_WAIT_MS + (MAX_WAIT_MS - MIN_WAIT_MS) * waitRoll,
    biteWindowMs: BITE_WINDOW_MS,
    easyMode: options.easyMode === true,
    carbonRod: options.carbonRod === true,
    bait: options.bait === true,
    hour: options.hour ?? 12,
    catchesAtSpot: options.catchesAtSpot ?? 0,
    ...(options.fishingConfig ? { fishingConfig: options.fishingConfig } : {}),
    callbacks: sideEffects,
  };
}

function enterWait(session: FishingSession, now: number): FishingSession {
  session.callbacks.playSound('splash');
  return { ...session, phase: 'wait', phaseEnteredAt: now, lastStepAt: now };
}

function enterBite(session: FishingSession, now: number): FishingSession {
  session.callbacks.vibrate(80);
  session.callbacks.playSound('bite');
  let pendingLoot = lootTable({
    random: session.callbacks.rng,
    fishRandom: session.callbacks.rng,
    bait: session.bait,
    hour: session.hour,
    catchesAtSpot: session.catchesAtSpot,
    config: session.fishingConfig,
  });
  // Accessibility mode trades maximum catch value for a gentler minigame.
  if (session.easyMode && pendingLoot.kind === 'fish' && pendingLoot.weight !== undefined) {
    const species = fishSpecies(pendingLoot.species ?? pendingLoot.id);
    if (species) pendingLoot = { ...pendingLoot, weight: Math.min(pendingLoot.weight, species.maxWeight * 0.7) };
  }
  return { ...session, phase: 'bite', phaseEnteredAt: now, lastStepAt: now, pendingLoot };
}

function enterReel(session: FishingSession, now: number): FishingSession {
  session.callbacks.vibrate(10);
  const species = session.pendingLoot?.species ? fishSpecies(session.pendingLoot.species) : undefined;
  const difficulty = session.pendingLoot?.kind === 'trash' ? 1 : species?.difficulty ?? 1;
  return {
    ...session,
    phase: 'reel',
    phaseEnteredAt: now,
    lastStepAt: now,
    minigame: createFishingMinigame({
      random: session.callbacks.rng,
      difficulty,
      easyMode: session.easyMode,
      carbonRod: session.carbonRod,
    }),
  };
}

function finish(session: FishingSession, now: number, outcome: FishingOutcome): FishingSession {
  return {
    ...session,
    phase: 'result',
    phaseEnteredAt: now,
    lastStepAt: now,
    outcome,
    loot: outcome === 'caught' ? session.pendingLoot : undefined,
  };
}

/**
 * Advances one frame. The caller owns the scheduling (R3F frame, interval, or tests),
 * so this module cannot leak timers when the component unmounts.
 */
export function advanceFishingSession(
  session: FishingSession,
  input: FishingAdvanceInput = {},
): FishingSession {
  if (session.phase === 'result') return session;
  const now = input.now ?? session.callbacks.now();

  if (session.phase === 'cast') {
    if (now - session.phaseEnteredAt < session.castWindowMs) return { ...session, lastStepAt: now };
    return enterWait(session, now);
  }

  if (session.phase === 'wait') {
    if (now - session.phaseEnteredAt < session.waitMs) return { ...session, lastStepAt: now };
    return enterBite(session, now);
  }

  if (session.phase === 'bite') {
    const elapsed = now - session.phaseEnteredAt;
    if (elapsed > session.biteWindowMs) return finish(session, now, 'missed');
    if (input.pull) return enterReel(session, now);
    return { ...session, lastStepAt: now };
  }

  const minigame = session.minigame;
  if (!minigame) return finish(session, now, 'failed');
  const deltaSeconds = Math.max(0, Math.min((now - session.lastStepAt) / 1000, 0.25));
  const nextMinigame = fishingMinigameStep(minigame, {
    deltaSeconds,
    pulling: input.pull === true,
    fishPosition: input.fishPositionOverride,
    random: session.callbacks.rng,
  });
  if (input.pull) session.callbacks.playSound('reel');
  // FISHING.md 3.1: a short pulse whenever the fish enters or leaves the green zone.
  const fishInside =
    session.minigame !== undefined &&
    Math.abs(nextMinigame.fish.position - nextMinigame.zone.position) <= nextMinigame.zone.size / 2;
  const wasInside =
    session.minigame !== undefined &&
    Math.abs(session.minigame.fish.position - session.minigame.zone.position) <= session.minigame.zone.size / 2;
  if (fishInside !== wasInside) session.callbacks.vibrate(10);
  if (nextMinigame.phase === 'won') {
    session.callbacks.vibrate(50);
    session.callbacks.playSound('catch');
    return finish({ ...session, minigame: nextMinigame }, now, 'caught');
  }
  if (nextMinigame.phase === 'failed') {
    if (nextMinigame.failure === 'line-break') session.callbacks.playSound('line-break');
    return finish({ ...session, minigame: nextMinigame }, now, 'failed');
  }
  return { ...session, minigame: nextMinigame, lastStepAt: now };
}

/** Cancels an active attempt and preserves a terminal result already shown. */
export function cancelFishingSession(session: FishingSession): FishingSession {
  if (session.phase === 'result') return session;
  return finish(session, session.callbacks.now(), 'cancelled');
}

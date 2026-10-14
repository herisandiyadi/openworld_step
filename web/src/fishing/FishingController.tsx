import { createFishingMinigame, fishingMinigameStep, fishingMinigameTap, type FishingMinigameState } from './fishingMinigame';
import { fishSpecies, lootTable, type FishingLoot, type FishingLootConfig } from './lootTable';

export type FishingSessionPhase = 'cast' | 'wait' | 'bite' | 'reel' | 'result';
export type FishingOutcome = 'caught' | 'escaped' | 'line-broken' | 'cancelled';
export type FishingSound = 'cast' | 'splash' | 'bite' | 'reel' | 'line-break' | 'catch';

export interface FishingCallbacks {
  readonly rng: () => number;
  readonly now: () => number;
  readonly vibrate: (durationMs: number) => void;
  readonly playSound: (sound: FishingSound) => void;
}

export interface FishingSessionOptions {
  readonly spotId: string;
  /** Streamed spot geometry snapshot; keeps 3D visuals correct even if the chunk streams out. */
  readonly spot?: { id: string; x: number; z: number; yaw: number };
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
  /** Snapshot of the streamed spot geometry for the visuals; taken once at start. */
  readonly spot?: { id: string; x: number; z: number; yaw: number };
  readonly phaseEnteredAt: number;
  readonly lastStepAt: number;
  readonly castWindowMs: number;
  readonly waitMs: number;
  /** Kept for wire/store compatibility; the timing gauge owns the active deadline. */
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
  /** A rising-edge action: one press resolves the gauge; holding is not required. */
  readonly pull?: boolean;
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

export function createFishingSession(options: FishingSessionOptions): FishingSession {
  const sideEffects = callbacks(options.callbacks);
  const now = sideEffects.now();
  if (!options.spotId) throw new RangeError('spotId is required');
  const waitRoll = Math.min(1, Math.max(0, sideEffects.rng()));
  sideEffects.playSound('cast');
  return {
    phase: 'cast',
    spotId: options.spotId,
    ...(options.spot ? { spot: options.spot } : {}),
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
  if (session.easyMode && pendingLoot.kind === 'fish' && pendingLoot.weight !== undefined) {
    const species = fishSpecies(pendingLoot.species ?? pendingLoot.id, session.fishingConfig?.species);
    if (species) pendingLoot = { ...pendingLoot, weight: Math.min(pendingLoot.weight, species.maxWeight * 0.7) };
  }
  const species = pendingLoot.kind === 'fish'
    ? fishSpecies(pendingLoot.species ?? pendingLoot.id, session.fishingConfig?.species)
    : undefined;
  const difficulty = pendingLoot.kind === 'trash' ? 1 : species?.difficulty ?? 1;
  return {
    ...session,
    phase: 'bite',
    phaseEnteredAt: now,
    lastStepAt: now,
    pendingLoot,
    minigame: createFishingMinigame({
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

function resolveGauge(session: FishingSession, now: number, minigame: FishingMinigameState): FishingSession {
  if (minigame.phase === 'active') return { ...session, minigame, lastStepAt: now };
  session.callbacks.vibrate(10);
  if (minigame.phase === 'won') {
    session.callbacks.vibrate(50);
    session.callbacks.playSound('catch');
    return finish({ ...session, minigame }, now, 'caught');
  }
  if (minigame.failure === 'line-break') {
    session.callbacks.playSound('line-break');
    return finish({ ...session, minigame }, now, 'line-broken');
  }
  return finish({ ...session, minigame }, now, 'escaped');
}

/** Advances one frame. Scheduling remains owned by the caller, so no timers can leak. */
export function advanceFishingSession(session: FishingSession, input: FishingAdvanceInput = {}): FishingSession {
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

  const minigame = session.minigame;
  if (!minigame) return finish(session, now, 'escaped');
  // Preserve the historical reel phase if one is restored from an older saved session.
  const activeSession = session.phase === 'reel' ? { ...session, phase: 'bite' as const } : session;
  if (input.pull) {
    activeSession.callbacks.playSound('reel');
    return resolveGauge(activeSession, now, fishingMinigameTap(minigame));
  }
  const deltaSeconds = Math.max(0, (now - session.lastStepAt) / 1000);
  return resolveGauge(activeSession, now, fishingMinigameStep(minigame, { deltaSeconds }));
}

export function cancelFishingSession(session: FishingSession): FishingSession {
  if (session.phase === 'result') return session;
  return finish(session, session.callbacks.now(), 'cancelled');
}

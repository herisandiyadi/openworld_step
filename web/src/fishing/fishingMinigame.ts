export type FishingPhase = 'active' | 'won' | 'failed';
export type FishingFailure = 'line-break' | 'reel-empty';

export interface FishingMinigameState {
  readonly phase: FishingPhase;
  readonly failure?: FishingFailure;
  /** Vertical bar: green zone, position = center in [0,1], size = height fraction. */
  readonly zone: { readonly position: number; readonly size: number };
  /** Fish icon in the same [0,1] bar. */
  readonly fish: { readonly position: number; readonly velocity: number };
  /** Reel meter in [0,1]; 1 wins, 0 (after some progress) lets the fish escape. */
  readonly reel: number;
  /** 0..1; above 0.9 is "red". */
  readonly tension: number;
  /** Seconds spent at red tension; more than 1 breaks the line. */
  readonly redTensionSeconds: number;
  readonly easyMode: boolean;
  readonly difficulty: number;
  /** Base movement speed of the fish icon (halved in easy mode). */
  readonly fishSpeed: number;
}

export interface FishingMinigameOptions {
  readonly random?: () => number;
  /** 1 is calm and light (mujair), 5 is rare and heavy (patin). */
  readonly difficulty?: number;
  readonly easyMode?: boolean;
  /** Carbon rod widens the green zone by 25%. */
  readonly carbonRod?: boolean;
}

export interface FishingMinigameInput {
  readonly deltaSeconds: number;
  readonly pulling: boolean;
  /** Overrides the simulated fish icon position (scripted patterns, tests). */
  readonly fishPosition?: number;
  /** Random stream for autonomous fish movement when fishPosition is not given. */
  readonly random?: () => number;
}

const clamp = (value: number, min = 0, max = 1): number => Math.min(max, Math.max(min, value));
const ZONE_TRAVEL = 0.35; // zone center units per second
const REEL_RATE = 0.25; // reel gain per second while the fish is in the zone and pulling
const DRAIN_RATE = 0.05; // slow reel loss while the fish is outside
const RED_THRESHOLD = 0.9;
const LINE_BREAK_SECONDS = 1;

/** FISHING.md 3.1: hold = zone rises and line reels; fish inside the green zone fills the meter. */
export function createFishingMinigame(options: FishingMinigameOptions = {}): FishingMinigameState {
  const difficulty = clamp(Math.round(options.difficulty ?? 1), 1, 5);
  const easyMode = options.easyMode === true;
  let size = 0.2;
  if (options.carbonRod) size *= 1.25;
  if (easyMode) size *= 2;
  const random = options.random ?? Math.random;
  return {
    phase: 'active',
    zone: { position: 0.5, size: Math.min(size, 1) },
    fish: { position: clamp(random()), velocity: 0 },
    reel: 0,
    tension: 0,
    redTensionSeconds: 0,
    easyMode,
    difficulty,
    fishSpeed: 0.3 * (easyMode ? 0.5 : 1),
  };
}

/** Advances the bar-pulling minigame one frame. Pure: returns a new state, never mutates. */
export function fishingMinigameStep(
  state: FishingMinigameState,
  input: FishingMinigameInput,
): FishingMinigameState {
  if (state.phase !== 'active' || input.deltaSeconds <= 0) return state;
  const dt = input.deltaSeconds;
  const random = input.random ?? Math.random;

  // Fish icon: calmer for light species, wilder for heavy ones; easy mode halves the speed.
  const maxSpeed = state.fishSpeed * (1 + 0.25 * (state.difficulty - 1));
  const targetVelocity = (clamp(random()) - 0.5) * 2 * maxSpeed;
  const velocity = state.fish.velocity * 0.5 + targetVelocity * 0.5;
  const simulatedPosition = clamp(state.fish.position + velocity * dt);
  const fishPosition =
    input.fishPosition === undefined ? simulatedPosition : clamp(input.fishPosition);

  // Zone: hold to raise, release to sink.
  const zonePosition = clamp(
    state.zone.position + (input.pulling ? ZONE_TRAVEL : -ZONE_TRAVEL) * dt,
    state.zone.size / 2,
    1 - state.zone.size / 2,
  );

  // Reel: rises while the fish sits inside the (frame-start) zone and the player pulls.
  const fishInside = Math.abs(fishPosition - state.zone.position) <= state.zone.size / 2;
  const reelDelta = fishInside && input.pulling ? REEL_RATE : -DRAIN_RATE;
  const reel = clamp(state.reel + reelDelta * dt);

  // Tension: holding pull with the fish outside the zone heats the line; easy mode never can.
  const tension =
    !state.easyMode && input.pulling && !fishInside
      ? clamp(state.tension + dt)
      : clamp(state.tension - dt);
  const redTensionSeconds =
    !state.easyMode && tension > RED_THRESHOLD ? state.redTensionSeconds + dt : 0;

  const progressed: FishingMinigameState = {
    ...state,
    zone: { position: zonePosition, size: state.zone.size },
    fish: { position: fishPosition, velocity },
    reel,
    tension,
    redTensionSeconds,
  };

  // Red tension for more than a second snaps the line (never in easy mode).
  if (!state.easyMode && redTensionSeconds > LINE_BREAK_SECONDS) {
    return { ...progressed, phase: 'failed', failure: 'line-break' };
  }
  if (reel >= 1) return { ...progressed, reel: 1, phase: 'won' };
  // Emptying the meter loses the fish, but only once some line has been reeled in.
  if (reel <= 0 && state.reel > 0) {
    return { ...progressed, reel: 0, phase: 'failed', failure: 'reel-empty' };
  }
  return progressed;
}

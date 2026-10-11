export type FishingPhase = 'active' | 'won' | 'failed';
export type FishingFailure = 'line-break' | 'escaped';

export interface FishingMinigameState {
  readonly phase: FishingPhase;
  readonly failure?: FishingFailure;
  readonly target: { readonly position: number; readonly size: number };
  readonly needle: { readonly position: number; readonly direction: 1 | -1; readonly speed: number };
  readonly remainingMs: number;
  readonly durationMs: number;
  readonly attempts: number;
  /** Normalized miss tension; large misses on hard species break the line. */
  readonly tension: number;
  readonly easyMode: boolean;
  readonly difficulty: number;
  /** Compatibility aliases retained for multiplayer/UI callers during migration. */
  readonly zone: { readonly position: number; readonly size: number };
  readonly fish: { readonly position: number; readonly velocity: number };
  readonly reel: number;
  readonly redTensionSeconds: number;
  readonly fishSpeed: number;
}

export interface FishingMinigameOptions {
  readonly random?: () => number;
  readonly difficulty?: number;
  readonly easyMode?: boolean;
  readonly carbonRod?: boolean;
}

export interface FishingMinigameInput {
  readonly deltaSeconds: number;
  /** The tap is intentionally separate from movement so one frame cannot double-submit. */
  readonly tap?: boolean;
  /** Legacy input is accepted as a tap for callers that still pass pulling. */
  readonly pulling?: boolean;
  readonly fishPosition?: number;
  readonly random?: () => number;
}

const clamp = (value: number, min = 0, max = 1): number => Math.min(max, Math.max(min, value));
const BASE_DURATION_MS = 1200;

function withCompatibility(state: Omit<FishingMinigameState, 'zone' | 'fish' | 'reel' | 'redTensionSeconds' | 'fishSpeed'>): FishingMinigameState {
  return {
    ...state,
    zone: state.target,
    fish: { position: state.needle.position, velocity: state.needle.direction * state.needle.speed },
    reel: state.phase === 'won' ? 1 : 0,
    redTensionSeconds: state.tension > 0.9 ? 1 : 0,
    fishSpeed: state.needle.speed,
  };
}

export function createFishingMinigame(options: FishingMinigameOptions = {}): FishingMinigameState {
  const difficulty = clamp(Math.round(options.difficulty ?? 1), 1, 5);
  const easyMode = options.easyMode === true;
  const baseTarget = 0.28 - (difficulty - 1) * 0.035;
  const targetSize = clamp(baseTarget * (options.carbonRod ? 1.25 : 1) * (easyMode ? 2 : 1), 0.12, 0.85);
  const durationMs = BASE_DURATION_MS + (easyMode ? 900 : 0) - (difficulty - 1) * 100;
  const speed = (0.9 + difficulty * 0.16) * (easyMode ? 0.55 : 1);
  const targetPosition = 0.5;
  return withCompatibility({
    phase: 'active',
    target: { position: targetPosition, size: targetSize },
    needle: { position: 0, direction: 1, speed },
    remainingMs: durationMs,
    durationMs,
    attempts: 0,
    tension: 0,
    easyMode,
    difficulty,
  });
}

function moveNeedle(state: FishingMinigameState, deltaSeconds: number): FishingMinigameState {
  let position = state.needle.position + state.needle.direction * state.needle.speed * deltaSeconds;
  let direction = state.needle.direction;
  if (position >= 1) {
    position = 1 - (position - 1);
    direction = -1;
  } else if (position <= 0) {
    position = -position;
    direction = 1;
  }
  return withCompatibility({
    ...state,
    needle: { ...state.needle, position: clamp(position), direction },
    remainingMs: Math.max(0, state.remainingMs - deltaSeconds * 1000),
  });
}

/** Advances the automatic horizontal needle sweep. Pure and timer-free. */
export function fishingMinigameStep(state: FishingMinigameState, input: FishingMinigameInput): FishingMinigameState {
  if (state.phase !== 'active' || input.deltaSeconds <= 0) return state;
  const moved = moveNeedle(state, input.deltaSeconds);
  if (moved.remainingMs <= 0) return withCompatibility({ ...moved, remainingMs: 0, phase: 'failed', failure: 'escaped' });
  if (input.tap || input.pulling) return fishingMinigameTap(moved);
  return moved;
}

/** Resolves the single player tap against the current needle position. */
export function fishingMinigameTap(state: FishingMinigameState): FishingMinigameState {
  if (state.phase !== 'active') return state;
  const attempts = state.attempts + 1;
  const distance = Math.abs(state.needle.position - state.target.position);
  const inTarget = distance <= state.target.size / 2;
  if (inTarget) return withCompatibility({ ...state, phase: 'won', attempts, remainingMs: state.remainingMs });
  const missRatio = distance / Math.max(state.target.size / 2, 0.001);
  const tension = clamp(missRatio / 2);
  const lineBreak = !state.easyMode && state.difficulty >= 4 && missRatio >= 2;
  return withCompatibility({
    ...state,
    phase: 'failed',
    failure: lineBreak ? 'line-break' : 'escaped',
    attempts,
    tension,
  });
}

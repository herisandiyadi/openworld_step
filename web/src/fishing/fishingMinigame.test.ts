import { describe, expect, it } from 'vitest';
import {
  createFishingMinigame,
  fishingMinigameStep,
  type FishingMinigameState,
} from './fishingMinigame';

describe('fishingMinigame', () => {
  it('starts with a green zone, fish position, empty reel and no tension', () => {
    const state = createFishingMinigame({ random: () => 0.5, difficulty: 1 });
    expect(state.phase).toBe('active');
    expect(state.zone).toEqual({ position: 0.5, size: 0.2 });
    expect(state.fish).toEqual({ position: 0.5, velocity: 0 });
    expect(state.reel).toBe(0);
    expect(state.tension).toBe(0);
  });

  it('reels in while the fish is in the zone and drains outside it', () => {
    const initial = createFishingMinigame({ random: () => 0.5, difficulty: 1 });
    const inside = fishingMinigameStep(initial, { deltaSeconds: 1, pulling: true, fishPosition: 0.5 });
    expect(inside.reel).toBeCloseTo(0.25);
    expect(inside.tension).toBe(0);

    const outside = fishingMinigameStep(inside, { deltaSeconds: 1, pulling: false, fishPosition: 0.99 });
    expect(outside.reel).toBeCloseTo(0.20);
  });

  it('moves the zone up while pulling and down when released', () => {
    const initial = createFishingMinigame({ random: () => 0.5, difficulty: 1 });
    const up = fishingMinigameStep(initial, { deltaSeconds: 1, pulling: true, fishPosition: 0.5 });
    expect(up.zone.position).toBeGreaterThan(initial.zone.position);
    const down = fishingMinigameStep(up, { deltaSeconds: 1, pulling: false, fishPosition: 0.5 });
    expect(down.zone.position).toBeLessThan(up.zone.position);
  });

  it('breaks the line after more than one second of red tension', () => {
    const initial = createFishingMinigame({ random: () => 0.5, difficulty: 5 });
    const red = fishingMinigameStep(initial, { deltaSeconds: 1.1, pulling: true, fishPosition: 0.99 });
    expect(red.tension).toBeGreaterThan(0.9);
    expect(red.phase).toBe('failed');
    expect(red.failure).toBe('line-break');
  });

  it('succeeds at full reel and fails at empty reel', () => {
    const initial = createFishingMinigame({ random: () => 0.5, difficulty: 1 });
    const success = fishingMinigameStep({ ...initial, reel: 0.99 }, { deltaSeconds: 0.1, pulling: true, fishPosition: 0.5 });
    expect(success.phase).toBe('won');

    const failure = fishingMinigameStep({ ...initial, reel: 0.01 }, { deltaSeconds: 0.5, pulling: false, fishPosition: 0.99 });
    expect(failure.phase).toBe('failed');
    expect(failure.failure).toBe('reel-empty');
  });

  it('makes easy mode twice as wide, slower, and unable to break the line', () => {
    const normal = createFishingMinigame({ random: () => 0.5, difficulty: 5 });
    const easy = createFishingMinigame({ random: () => 0.5, difficulty: 5, easyMode: true });
    expect(easy.zone.size).toBe(normal.zone.size * 2);
    const normalFailure = fishingMinigameStep(normal, { deltaSeconds: 1.1, pulling: true, fishPosition: 0.99 });
    const easyProgress = fishingMinigameStep(easy, { deltaSeconds: 1.1, pulling: true, fishPosition: 0.99 });
    expect(normalFailure.phase).toBe('failed');
    expect(easyProgress.phase).toBe('active');
  });

  it('moves the fish icon autonomously, faster for heavier fish', () => {
    const stream = () => 0.9;
    const calm = createFishingMinigame({ random: () => 0.5, difficulty: 1 });
    const wild = createFishingMinigame({ random: () => 0.5, difficulty: 5 });
    const calmStep = fishingMinigameStep(calm, { deltaSeconds: 1, pulling: false, random: stream });
    const wildStep = fishingMinigameStep(wild, { deltaSeconds: 1, pulling: false, random: stream });
    expect(calmStep.fish.position).toBeGreaterThan(0.5);
    expect(wildStep.fish.position).toBeGreaterThan(calmStep.fish.position);

    const easyWild = createFishingMinigame({ random: () => 0.5, difficulty: 5, easyMode: true });
    const easyStep = fishingMinigameStep(easyWild, { deltaSeconds: 1, pulling: false, random: stream });
    expect(easyStep.fish.position).toBeLessThan(wildStep.fish.position);
  });

  it('widens the green zone 25% with a carbon rod', () => {
    const normal = createFishingMinigame({ random: () => 0.5, difficulty: 1 });
    const carbon = createFishingMinigame({ random: () => 0.5, difficulty: 1, carbonRod: true });
    expect(carbon.zone.size).toBeCloseTo(normal.zone.size * 1.25, 10);
  });

  it('does not fail an untouched reel (0%) when nothing has been reeled in yet', () => {
    const initial = createFishingMinigame({ random: () => 0.5, difficulty: 5 });
    const outside = fishingMinigameStep(initial, { deltaSeconds: 0.5, pulling: false, fishPosition: 0.99 });
    expect(outside.reel).toBe(0);
    expect(outside.phase).toBe('active');
  });

  it('does not mutate the input state', () => {
    const initial = createFishingMinigame({ random: () => 0.5, difficulty: 1 });
    const copy: FishingMinigameState = structuredClone(initial);
    fishingMinigameStep(initial, { deltaSeconds: 1, pulling: true, fishPosition: 0.5 });
    expect(initial).toEqual(copy);
  });
});

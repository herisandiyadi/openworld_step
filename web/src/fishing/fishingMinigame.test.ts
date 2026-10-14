import { describe, expect, it } from 'vitest';
import {
  createFishingMinigame,
  fishingMinigameStep,
  fishingMinigameTap,
  type FishingMinigameState,
} from './fishingMinigame';

describe('horizontal fishing timing gauge', () => {
  it('creates a centered target and a moving needle whose difficulty changes width and speed', () => {
    const easyFish = createFishingMinigame({ random: () => 0.5, difficulty: 1 });
    const hardFish = createFishingMinigame({ random: () => 0.5, difficulty: 5 });

    expect(easyFish.target).toEqual({ position: 0.5, size: 0.28 });
    expect(easyFish.needle.position).toBe(0);
    expect(easyFish.needle.direction).toBe(1);
    expect(hardFish.target.size).toBeLessThan(easyFish.target.size);
    expect(hardFish.needle.speed).toBeGreaterThan(easyFish.needle.speed);
  });

  it('sweeps horizontally and bounces off either end', () => {
    const initial = createFishingMinigame({ random: () => 0.5, difficulty: 1 });
    const moving = fishingMinigameStep(initial, { deltaSeconds: 0.5 });
    expect(moving.needle.position).toBeGreaterThan(0);

    const nearRight: FishingMinigameState = {
      ...initial,
      needle: { ...initial.needle, position: 0.95, direction: 1 },
    };
    const bounced = fishingMinigameStep(nearRight, { deltaSeconds: 0.2 });
    expect(bounced.needle.position).toBeLessThanOrEqual(1);
    expect(bounced.needle.direction).toBe(-1);
  });

  it('catches on the inclusive target boundary with one tap', () => {
    const initial = createFishingMinigame({ random: () => 0.5, difficulty: 3 });
    const boundary: FishingMinigameState = {
      ...initial,
      needle: { ...initial.needle, position: initial.target.position + initial.target.size / 2 },
    };
    const result = fishingMinigameTap(boundary);
    expect(result.phase).toBe('won');
    expect(result.attempts).toBe(1);
  });

  it('deterministically escapes on a near miss and breaks the line on a large hard-fish miss', () => {
    const medium = createFishingMinigame({ random: () => 0.5, difficulty: 3 });
    const nearMiss = fishingMinigameTap({
      ...medium,
      needle: { ...medium.needle, position: medium.target.position + medium.target.size / 2 + 0.01 },
    });
    expect(nearMiss.phase).toBe('failed');
    expect(nearMiss.failure).toBe('escaped');

    const hard = createFishingMinigame({ random: () => 0.5, difficulty: 5 });
    const farMiss = fishingMinigameTap({ ...hard, needle: { ...hard.needle, position: 0 } });
    expect(farMiss.phase).toBe('failed');
    expect(farMiss.failure).toBe('line-break');
    expect(farMiss.tension).toBeGreaterThan(0.5);
  });

  it('times out as escaped without accepting another attempt', () => {
    const initial = createFishingMinigame({ random: () => 0.5, difficulty: 2 });
    const timedOut = fishingMinigameStep(initial, { deltaSeconds: initial.durationMs / 1000 });
    expect(timedOut.phase).toBe('failed');
    expect(timedOut.failure).toBe('escaped');
    expect(timedOut.remainingMs).toBe(0);
    expect(fishingMinigameTap(timedOut)).toBe(timedOut);
  });

  it('makes easy mode wider and slower and prevents line breaks', () => {
    const normal = createFishingMinigame({ random: () => 0.5, difficulty: 5 });
    const easy = createFishingMinigame({ random: () => 0.5, difficulty: 5, easyMode: true });
    expect(easy.target.size).toBeGreaterThan(normal.target.size);
    expect(easy.needle.speed).toBeLessThan(normal.needle.speed);
    expect(easy.durationMs).toBeGreaterThan(normal.durationMs);

    const farMiss = fishingMinigameTap({ ...easy, needle: { ...easy.needle, position: 0 } });
    expect(farMiss.failure).toBe('escaped');
  });

  it('widens the target 25% for a carbon rod and does not mutate input state', () => {
    const normal = createFishingMinigame({ random: () => 0.5, difficulty: 2 });
    const carbon = createFishingMinigame({ random: () => 0.5, difficulty: 2, carbonRod: true });
    expect(carbon.target.size).toBeCloseTo(normal.target.size * 1.25);
    const copy = structuredClone(normal);
    fishingMinigameStep(normal, { deltaSeconds: 0.1 });
    fishingMinigameTap(normal);
    expect(normal).toEqual(copy);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { clearExplored, decodeExplored, encodeExplored, exploredRatio, FOG_CELL, isExplored, markExplored } from './exploration';
import { HALF_WORLD } from '../world/worldSpec';

const cellOf = (meters: number) => Math.floor((meters + HALF_WORLD) / FOG_CELL);

describe('fog of war', () => {
  beforeEach(() => clearExplored());

  it('reveals around the player only', () => {
    expect(markExplored(0, 0)).toBe(true);
    expect(isExplored(cellOf(0), cellOf(0))).toBe(true);
    expect(isExplored(cellOf(200), cellOf(200))).toBe(false);
    expect(markExplored(0, 0)).toBe(false);
  });

  it('round-trips through the save encoding', () => {
    markExplored(100, -50);
    markExplored(-200, 180);
    const ratio = exploredRatio();
    const encoded = encodeExplored();
    clearExplored();
    expect(exploredRatio()).toBe(0);
    decodeExplored(encoded);
    expect(exploredRatio()).toBe(ratio);
    expect(isExplored(cellOf(100), cellOf(-50))).toBe(true);
  });
});
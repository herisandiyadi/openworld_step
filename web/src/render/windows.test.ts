import { describe, expect, it } from 'vitest';
import { WINDOW_LIT_RATIO, windowCellLit, windowEmissionAt } from './windows';

describe('windowCellLit', () => {
  it('is deterministic per cell', () => {
    expect(windowCellLit(3, 7)).toBe(windowCellLit(3, 7));
  });
  it('lights a varied fraction of windows close to the target ratio', () => {
    let lit = 0;
    let total = 0;
    for (let x = -40; x < 40; x++) for (let y = 0; y < 20; y++, total++) if (windowCellLit(x, y)) lit++;
    expect(Math.abs(lit / total - WINDOW_LIT_RATIO)).toBeLessThan(0.06);
    expect(lit).toBeGreaterThan(0);
    expect(lit).toBeLessThan(total);
  });
  it('turns emissive off at noon and on gradually at night', () => {
    expect(windowEmissionAt(1)).toBe(0);
    expect(windowEmissionAt(0.5)).toBeCloseTo(0.425, 8);
    expect(windowEmissionAt(0)).toBe(0.85);
    expect(windowEmissionAt(-1)).toBe(0.85);
    expect(windowEmissionAt(2)).toBe(0);
    expect(windowEmissionAt(Number.NaN)).toBe(0);
  });
});

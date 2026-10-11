import { describe, expect, it } from 'vitest';
import { linearToSrgbByte, PALETTE } from './palette';

const srgb = (color: readonly number[]): number[] => color.map(linearToSrgbByte);

describe('Notion section 11 urban character palette', () => {
  it('uses the documented hero skin, hair, shirt and pants tokens', () => {
    expect(srgb(PALETTE.skin)).toEqual([120, 54, 27]);
    expect(srgb(PALETTE.hair)).toEqual([3, 3, 2]);
    expect(srgb(PALETTE.hoodie)).toEqual([209, 196, 168]);
    expect(srgb(PALETTE.hoodieDark)).toEqual([158, 147, 125]);
    expect(srgb(PALETTE.jeans)).toEqual([11, 13, 17]);
  });

  it('uses the documented sneaker and sole tokens', () => {
    expect(srgb(PALETTE.shoe)).toEqual([224, 219, 209]);
    expect(srgb(PALETTE.sole)).toEqual([242, 240, 230]);
  });
});

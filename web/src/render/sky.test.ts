import { describe, expect, it } from 'vitest';
import { skyPalette } from './sky';

describe('skyPalette', () => {
  it('matches fog to the horizon colour so the skyline has no seam', () => {
    for (const [daylight, dusk] of [[1, 0], [0.5, 1], [0, 0]]) {
      const p = skyPalette(daylight!, dusk!);
      expect(p.fog.getHex()).toBe(p.horizon.getHex());
    }
  });
  it('shows stars only at night and clouds mostly by day', () => {
    expect(skyPalette(1, 0).stars).toBe(0);
    expect(skyPalette(0, 0).stars).toBeGreaterThan(0.8);
    expect(skyPalette(1, 0).clouds).toBeGreaterThan(skyPalette(0, 0).clouds);
  });
  it('keeps the night zenith blue-violet and darker than the horizon', () => {
    const p = skyPalette(0, 0);
    expect(p.zenith.b).toBeGreaterThan(p.zenith.r);
    expect(p.zenith.b).toBeGreaterThan(p.zenith.g);
    expect(p.zenith.getHSL({ h: 0, s: 0, l: 0 }).l).toBeLessThan(p.horizon.getHSL({ h: 0, s: 0, l: 0 }).l);
  });
});

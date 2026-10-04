import { describe, expect, it } from 'vitest';
import { fitShadowCamera, lightingAt, lightingFor, timeState, type LightingState } from './lighting';

describe('lighting helpers', () => {
  it('classifies day, dusk, and night continuously', () => {
    expect(timeState(0.5)).toBe('day');
    expect(timeState(0.25)).toBe('dusk');
    expect(timeState(0)).toBe('night');
  });
  it('keeps night readable with cool fill and warm practicals', () => {
    const night = lightingFor('night');
    expect(night.sunIntensity).toBeLessThan(0.2);
    expect(night.hemisphereIntensity).toBeGreaterThan(0.2);
    expect(night.streetLightIntensity).toBeGreaterThan(night.sunIntensity);
    expect(night.streetLightColor).toBe('#ffb45c');
  });
  it('blends lighting continuously across the cycle (no popping)', () => {
    let previous = lightingAt(0).sunIntensity;
    // 4000 sampel = 0.12 s waktu nyata per langkah; lompatan > 0.05 berarti ada diskontinuitas.
    for (let i = 1; i <= 4000; i++) {
      const sun = lightingAt(i / 4000).sunIntensity;
      expect(Math.abs(sun - previous)).toBeLessThan(0.05);
      previous = sun;
    }
    expect(lightingAt(0.5).sunIntensity).toBeCloseTo(lightingFor('day').sunIntensity, 5);
    expect(lightingAt(0).sunIntensity).toBeCloseTo(lightingFor('night').sunIntensity, 5);
    expect(lightingAt(0).streetLight).toBeCloseTo(lightingFor('night').streetLightIntensity, 5);
    expect(lightingAt(0.5).streetLight).toBe(0);
  });
  it('fits the shadow camera tightly around the active area and snaps to texels', () => {
    const fit = fitShadowCamera({ radius: 18, mapSize: 1024, focusX: 10.3, focusZ: -4.7 });
    expect(fit.halfExtent).toBe(18);
    expect(fit.far).toBeLessThanOrEqual(100);
    const texel = (2 * 18) / 1024;
    expect(Math.abs(fit.focusX / texel - Math.round(fit.focusX / texel))).toBeLessThan(1e-6);
    expect(Math.abs(fit.focusX - 10.3)).toBeLessThanOrEqual(texel);
  });
  it('uses a single shadow caster budget', () => {
    const states: LightingState[] = ['day', 'dusk', 'night'];
    for (const state of states) expect(lightingFor(state).shadowCasters).toBe(1);
  });
});

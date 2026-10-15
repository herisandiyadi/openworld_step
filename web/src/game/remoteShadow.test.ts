import { describe, expect, it } from 'vitest';
import { SHADOW_HALF_EXTENT, castsShadowAt } from './remotePlayers';

/**
 * castShadow pemain jauh dimatikan karena bayangannya tidak akan pernah terlihat: shadow camera
 * hanya mencakup kotak 40x40 m di sekitar pemain lokal (PlayerController.tsx). Kalau
 * SHADOW_HALF_EXTENT tidak lagi cocok dengan shadow-camera-* di sana, opsi optimasi ini jadi bug
 * visual (bayangan hilang padahal seharusnya tampak) atau bug performa (tetap mahal tanpa hasil).
 */
describe('castsShadowAt', () => {
  it('di dalam frustum shadow: tetap jadi shadow caster', () => {
    expect(castsShadowAt(0)).toBe(true);
    expect(castsShadowAt(5)).toBe(true);
    expect(castsShadowAt(SHADOW_HALF_EXTENT)).toBe(true);
  });

  it('di luar frustum shadow: tidak lagi jadi shadow caster', () => {
    expect(castsShadowAt(SHADOW_HALF_EXTENT + 0.01)).toBe(false);
    expect(castsShadowAt(50)).toBe(false);
    expect(castsShadowAt(125)).toBe(false);
  });

  it('jarak tidak sah tidak menjadi shadow caster', () => {
    expect(castsShadowAt(Number.NaN)).toBe(false);
    expect(castsShadowAt(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('cakupannya lebih kecil dari jarak animasi penuh (kalau tidak, optimasi tidak ada efek)', () => {
    // Shadow dimatikan jauh sebelum animasi di-throttle, jadi pemain di 20-40 m sudah menghemat
    // shadow pass sambil tetap dianimasikan penuh.
    expect(SHADOW_HALF_EXTENT).toBeLessThan(40);
  });
});

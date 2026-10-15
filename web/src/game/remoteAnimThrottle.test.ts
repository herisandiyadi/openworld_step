import { describe, expect, it } from 'vitest';
import { REMOTE_ANIM_FULL_DISTANCE, remoteAnimInterval } from './remotePlayers';

/**
 * Throttle ini mengurangi beban CPU untuk pemain jauh. Kontrak yang harus dijaga:
 * (a) dekat -> tiap frame, animasi tetap halus;
 * (b) jauh -> tiap N frame, TAPI akumulasi delta membuat kecepatan animasi tidak berubah.
 * Kalau (b) salah, pemain jauh akan berjalan slow-motion — bug yang lebih buruk dari beban CPU.
 */
describe('remoteAnimInterval', () => {
  it('dekat dan sedang: update tiap frame', () => {
    expect(remoteAnimInterval(0)).toBe(1);
    expect(remoteAnimInterval(20)).toBe(1);
    expect(remoteAnimInterval(REMOTE_ANIM_FULL_DISTANCE)).toBe(1);
  });

  it('jauh: makin jauh makin jarang, dan dibatasi 4', () => {
    expect(remoteAnimInterval(45)).toBe(2);
    expect(remoteAnimInterval(75)).toBe(3);
    expect(remoteAnimInterval(124)).toBe(4);
    expect(remoteAnimInterval(1e6)).toBe(4);
  });

  it('tidak pernah 0 (0 akan membagi nol di modulo dan menghentikan animasi)', () => {
    for (const d of [0, 1, 39.9, 40, 40.1, 70, 100, 125, 500]) {
      expect(remoteAnimInterval(d)).toBeGreaterThanOrEqual(1);
    }
  });

  it('jarak tidak sah diperlakukan seperti dekat, bukan crash', () => {
    expect(remoteAnimInterval(Number.NaN)).toBe(1);
    expect(remoteAnimInterval(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

/**
 * Meniru loop mixer di RemotePlayers: dengan akumulasi delta, total waktu yang diumpankan ke
 * mixer selama 60 frame harus tetap 60 * dt, berapa pun intervalnya. Inilah jaminan anti
 * slow-motion.
 */
describe('throttle tetap menjaga kecepatan animasi', () => {
  const simulate = (distance: number, frames = 60, dt = 1 / 60): number => {
    const interval = remoteAnimInterval(distance);
    let accum = 0;
    let counter = 0;
    let fed = 0;
    for (let i = 0; i < frames; i++) {
      if (interval <= 1) {
        fed += dt;
        accum = 0;
      } else {
        accum += dt;
        counter = (counter + 1) % interval;
        if (counter === 0) {
          fed += accum;
          accum = 0;
        }
      }
    }
    return fed;
  };

  it('dekat: tiap frame diumpankan', () => {
    expect(simulate(10)).toBeCloseTo(1, 5);
  });

  it('jauh: total waktu yang diumpankan sama (hanya lebih jarang)', () => {
    // Sisa accum yang belum sempat diumpankan di akhir loop maksimal 1 frame, jadi selisihnya
    // harus < dt — bukan jauh lebih kecil seperti slow-motion.
    for (const d of [45, 75, 124]) {
      expect(Math.abs(simulate(d) - 1)).toBeLessThan(1 / 60 + 1e-9);
    }
  });

  it('jauh tetap mengumpankan lebih sedikit kali (inilah penghematannya)', () => {
    const count = (distance: number) => {
      const interval = remoteAnimInterval(distance);
      let counter = 0;
      let calls = 0;
      for (let i = 0; i < 60; i++) {
        counter = (counter + 1) % interval;
        if (counter === 0) calls++;
      }
      return calls;
    };
    expect(count(45)).toBe(30);
    expect(count(75)).toBe(20);
    expect(count(124)).toBe(15);
  });
});

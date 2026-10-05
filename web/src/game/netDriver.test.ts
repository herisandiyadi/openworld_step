/** Test logika murni driver jaringan: pemilihan animasi dan laju kirim 15 Hz. */

import { describe, expect, it } from 'vitest';
import { RUN_SPEED, SEND_INTERVAL_MS, localAnim, localSnapshot, shouldSend } from './netDriver';
import type { LocalMotion } from './netDriver';

const walk = (speed: number, extra: Partial<LocalMotion> = {}): LocalMotion => ({
  mode: 'walk',
  speed,
  seated: false,
  jumping: false,
  ...extra,
});

describe('animasi lokal', () => {
  it('diam saat hampir tidak bergerak', () => {
    expect(localAnim(walk(0))).toBe('idle');
  });

  it('jalan di bawah ambang lari', () => {
    expect(localAnim(walk(RUN_SPEED - 0.1))).toBe('walk');
  });

  it('lari di atas ambang', () => {
    expect(localAnim(walk(RUN_SPEED + 0.5))).toBe('run');
  });

  it('lompat mengalahkan gerak kaki', () => {
    expect(localAnim(walk(2, { jumping: true }))).toBe('jump');
  });

  it('naik kendaraan selalu ride', () => {
    expect(localAnim(walk(5, { mode: 'bike' }))).toBe('ride');
    expect(localAnim(walk(0, { mode: 'car', jumping: true }))).toBe('ride');
  });

  it('duduk paling tinggi prioritasnya', () => {
    expect(localAnim(walk(0, { seated: true, mode: 'bike' }))).toBe('sit');
  });
});

describe('laju kirim', () => {
  it('15 Hz', () => {
    expect(SEND_INTERVAL_MS).toBeCloseTo(1000 / 15);
  });

  it('menunggu interval penuh', () => {
    // Dibandingkan dari waktu kirim terakhir supaya tidak bergantung pada pembulatan pecahan.
    expect(shouldSend(SEND_INTERVAL_MS - 1, 0)).toBe(false);
    expect(shouldSend(SEND_INTERVAL_MS, 0)).toBe(true);
    expect(shouldSend(SEND_INTERVAL_MS + 5, 0)).toBe(true);
  });
});

describe('snapshot lokal', () => {
  it('menyalin pose dan mengisi animasi', () => {
    const snap = localSnapshot({ x: 1, y: 2, z: 3, heading: 0.5 }, walk(4));
    expect(snap).toEqual({ x: 1, y: 2, z: 3, heading: 0.5, mode: 'walk', anim: 'run', jumping: false });
  });
});

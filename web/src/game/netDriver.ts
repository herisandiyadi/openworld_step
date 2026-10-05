/**
 * Logika murni driver jaringan (MULTIPLAYER.md 4): memilih animasi dari keadaan pemain lokal
 * dan menentukan kapan snapshot berikutnya dikirim. Dipisah dari komponen supaya bisa diuji
 * tanpa React maupun Three.
 */

import type { AnimId, PlayerSnapshot } from '../net/protocol';
import type { MoveMode } from '../state/gameStore';

/** Laju kirim state pemain lokal: 15 Hz, sama dengan yang diharapkan host/server. */
export const SEND_HZ = 15;
export const SEND_INTERVAL_MS = 1000 / SEND_HZ;

/** Ambang kecepatan (m/s) antara jalan dan lari saat berjalan kaki. */
export const RUN_SPEED = 3.2;

/** Benar kalau sudah waktunya mengirim snapshot berikutnya. */
export const shouldSend = (nowMs: number, lastSentMs: number): boolean => nowMs - lastSentMs >= SEND_INTERVAL_MS;

export interface LocalMotion {
  mode: MoveMode;
  /** Kecepatan horizontal (m/s) yang sudah dihaluskan. */
  speed: number;
  seated: boolean;
  jumping: boolean;
}

/**
 * Animasi yang dikirim ke pemain lain. Urutan prioritas: duduk, naik kendaraan, lompat,
 * lalu gerak kaki. `jump` hanya dipakai saat benar-benar di udara dengan kaki sendiri.
 */
export function localAnim(motion: LocalMotion): AnimId {
  if (motion.seated) return 'sit';
  if (motion.mode !== 'walk') return 'ride';
  if (motion.jumping) return 'jump';
  if (motion.speed < 0.15) return 'idle';
  return motion.speed >= RUN_SPEED ? 'run' : 'walk';
}

/** Snapshot pemain lokal tanpa id; id diisi host/server. */
export function localSnapshot(
  pose: { x: number; y: number; z: number; heading: number },
  motion: LocalMotion,
): Omit<PlayerSnapshot, 'id'> {
  return {
    x: pose.x,
    y: pose.y,
    z: pose.z,
    heading: pose.heading,
    mode: motion.mode,
    anim: localAnim(motion),
    jumping: motion.jumping,
  };
}

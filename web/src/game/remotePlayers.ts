import type { PlayerId } from '../net/protocol';

/**
 * Fungsi murni untuk menggambar pemain lain (MULTIPLAYER.md 4): jarak, culling kabut,
 * dan pemilihan "terdekat dulu" dengan batas jumlah.
 * Tidak mengimpor sesi/jaringan supaya bisa diuji tanpa transport.
 */

/** Batas kabut di App.tsx (`<fog args={[SKY_COLOR, 50, 125]} />`): lebih jauh dari ini tidak terlihat. */
export const REMOTE_FOG_FAR = 125;

/**
 * Maksimum pemain remote yang digambar sekaligus. 50 pemain dalam satu room (4.1) akan
 * menjatuhkan FPS di HP kelas menengah, jadi hanya 20 terdekat yang dirender.
 */
export const MAX_VISIBLE_REMOTES = 20;

/** Jarak label nama masih terbaca; lebih jauh label dimatikan (sprite tetap ada, hanya disembunyikan). */
export const LABEL_VISIBLE_DISTANCE = 45;

export interface RemoteCandidate {
  id: PlayerId;
  x: number;
  z: number;
}

export interface VisibleRemote {
  id: PlayerId;
  /** Jarak horizontal ke kamera (m). */
  distance: number;
}

/** Jarak horizontal (y diabaikan: kamera selalu di atas pemain). */
export const horizontalDistance = (a: { x: number; z: number }, b: { x: number; z: number }): number =>
  Math.hypot(a.x - b.x, a.z - b.z);

/** Benar kalau pemain masih di dalam batas kabut (dan jaraknya angka yang sah). */
export function isRemoteVisible(distance: number, far: number = REMOTE_FOG_FAR): boolean {
  return Number.isFinite(distance) && distance >= 0 && distance <= far;
}

/** Benar kalau label nama layak digambar pada jarak ini. */
export function isLabelVisible(distance: number, maxDistance: number = LABEL_VISIBLE_DISTANCE): boolean {
  return isRemoteVisible(distance, maxDistance);
}

/**
 * Memilih pemain yang digambar frame ini: buang yang di luar kabut, urutkan terdekat dulu,
 * lalu potong ke `maxCount`. Urutan stabil (id kecil dulu) saat jaraknya sama supaya
 * pemain tidak berkedip hilang-muncul.
 */
export function selectVisibleRemotes(
  candidates: readonly RemoteCandidate[],
  origin: { x: number; z: number },
  maxCount: number = MAX_VISIBLE_REMOTES,
  far: number = REMOTE_FOG_FAR,
): VisibleRemote[] {
  if (maxCount <= 0) return [];
  const visible: VisibleRemote[] = [];
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.z)) continue;
    const distance = horizontalDistance(candidate, origin);
    if (!isRemoteVisible(distance, far)) continue;
    visible.push({ id: candidate.id, distance });
  }
  visible.sort((a, b) => (a.distance === b.distance ? a.id - b.id : a.distance - b.distance));
  return visible.length > maxCount ? visible.slice(0, maxCount) : visible;
}

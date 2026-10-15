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

/**
 * Di luar jarak ini, animasi pemain jauh di-throttle: mixer hanya di-update tiap N frame.
 * Alasannya biaya CPU, bukan visual — 20 skinned mesh x mixer.update tiap frame membebani GPU/CPU
 * kelas menengah, sementara pada jarak >40 m perubahan pose <2 px dan tak terlihat. Posisi badan
 * tetap diinterpolasi tiap frame, jadi tidak ada patah gerak; hanya animasi kakinya yang melambat.
 */
export const REMOTE_ANIM_FULL_DISTANCE = 40;

/**
 * Setengah lebar frustum shadow kamera (m). Harus sama dengan shadow-camera-left/right/top/bottom
 * di PlayerController.tsx (+-20). Bayangan hanya dirender di dalam kotak 40x40 m ini.
 */
export const SHADOW_HALF_EXTENT = 20;

/**
 * Benar kalau pemain pada jarak ini masih mungkin masuk frustum shadow (bayangannya terlihat).
 * Di luar ini `castShadow` hanya membuat GPU menguji objek lalu menolaknya — beban tanpa hasil.
 * Dipakai untuk mematikan castShadow pemain jauh.
 */
export function castsShadowAt(distance: number, halfExtent: number = SHADOW_HALF_EXTENT): boolean {
  if (!Number.isFinite(distance)) return false;
  return distance <= halfExtent;
}

/**
 * Interval update mixer (dalam frame) untuk pemain pada jarak tertentu.
 * 1 = tiap frame (dekat, animasi halus). Nilai >1 = update tiap N frame (jauh, hemat CPU).
 */
export function remoteAnimInterval(distance: number, fullDistance: number = REMOTE_ANIM_FULL_DISTANCE): number {
  if (!Number.isFinite(distance) || distance <= fullDistance) return 1;
  // Bertahap: 40-70 m -> tiap 2 frame, 70-100 m -> tiap 3, >100 m -> tiap 4.
  const steps = Math.floor((distance - fullDistance) / 30) + 2;
  return Math.min(steps, 4);
}

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

import type { Aabb, Vec2 } from './movement';
import type { SeatPoint } from '../world/worldSpec';

/**
 * Logika kursi bangku tanpa three.js dan tanpa React supaya bisa di-unit-test.
 * Konvensi arah sama seperti pemain: heading 0 menghadap -Z, forward = (-sin, -cos).
 */

/** Jarak maksimal pemain ke kursi supaya tombol "Duduk" muncul (m). */
export const SEAT_REACH = 1.5;
/** Pemain berdiri sejauh ini di depan kursi (m). */
export const STAND_FORWARD = 0.7;
/** Lama interpolasi posisi dan arah saat duduk (detik), sama dengan transisi klip. */
export const SIT_TRANSITION = 0.4;

/** Kursi yang sedang dipakai: id kursi -> id karakter (pemain atau warga). */
const reservations = new Map<string, string>();

export const seatOccupant = (seatId: string): string | null => reservations.get(seatId) ?? null;
export const isSeatFree = (seatId: string): boolean => !reservations.has(seatId);

/** Reservasi kursi. Gagal (false) kalau sudah dipakai karakter lain, jadi tidak ada dua karakter di satu kursi. */
export function reserveSeat(seatId: string, occupantId: string): boolean {
  const current = reservations.get(seatId);
  if (current !== undefined && current !== occupantId) return false;
  reservations.set(seatId, occupantId);
  return true;
}

/** Melepas kursi; hanya pemiliknya yang boleh melepas. */
export function releaseSeat(seatId: string, occupantId: string): void {
  if (reservations.get(seatId) === occupantId) reservations.delete(seatId);
}

/** Melepas semua kursi milik satu karakter (dipakai saat warga di-despawn atau load save). */
export function releaseOccupant(occupantId: string): void {
  for (const [seatId, owner] of reservations) if (owner === occupantId) reservations.delete(seatId);
}

export function clearSeatReservations(): void {
  reservations.clear();
}

/** Kursi kosong terdekat dalam jangkauan. Kursi yang sudah direservasi `occupantId` tetap dianggap miliknya. */
export function findNearestFreeSeat(
  seats: readonly SeatPoint[],
  x: number,
  z: number,
  occupantId = 'player',
  maxDistance = SEAT_REACH,
): SeatPoint | null {
  let best: SeatPoint | null = null;
  let bestDistance = maxDistance;
  for (const seat of seats) {
    const owner = reservations.get(seat.id);
    if (owner !== undefined && owner !== occupantId) continue;
    const distance = Math.hypot(seat.x - x, seat.z - z);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = seat;
    }
  }
  return best;
}

/** Posisi dan arah karakter saat duduk (tepat di titik kursi, menghadap depan bangku). */
export const sitPose = (seat: SeatPoint): { x: number; z: number; heading: number } => ({
  x: seat.x,
  z: seat.z,
  heading: seat.yaw,
});

/** Toleransi 1 cm: titik yang hanya menyentuh collider (bangku 0.3 + radius 0.4 = 0.7 m) dianggap bebas. */
const blocked = (x: number, z: number, radius: number, boxes: readonly Aabb[]): boolean => {
  const r = radius - 0.01;
  return boxes.some((box) => x > box.minX - r && x < box.maxX + r && z > box.minZ - r && z < box.maxZ + r);
};

/**
 * Titik berdiri: 0.7 m di depan kursi, lalu coba kiri dan kanan bangku kalau terhalang.
 * Kandidat terakhir selalu dikembalikan walau terhalang (lebih baik sedikit menembus lalu
 * didorong keluar oleh pushOutOfBoxes daripada pemain terjebak di dalam collider bangku).
 */
export function standPosition(seat: SeatPoint, boxes: readonly Aabb[] = [], radius = 0.4): Vec2 {
  const fx = -Math.sin(seat.yaw);
  const fz = -Math.cos(seat.yaw);
  // Vektor kanan bangku (forward diputar -90 derajat).
  const rx = -fz;
  const rz = fx;
  const candidates: Vec2[] = [
    { x: seat.x + fx * STAND_FORWARD, z: seat.z + fz * STAND_FORWARD },
    { x: seat.x + fx * STAND_FORWARD + rx * 1.1, z: seat.z + fz * STAND_FORWARD + rz * 1.1 },
    { x: seat.x + fx * STAND_FORWARD - rx * 1.1, z: seat.z + fz * STAND_FORWARD - rz * 1.1 },
    { x: seat.x + rx * 1.3, z: seat.z + rz * 1.3 },
    { x: seat.x - rx * 1.3, z: seat.z - rz * 1.3 },
    { x: seat.x + fx * 1.6, z: seat.z + fz * 1.6 },
  ];
  return candidates.find((spot) => !blocked(spot.x, spot.z, radius, boxes)) ?? candidates[candidates.length - 1] ?? sitPose(seat);
}

/** Kursi terdekat hasil pindaian Proximity dan kursi yang sedang dipakai pemain (bukan save game). */
export const seatTarget: { seat: SeatPoint | null } = { seat: null };
export const playerSeat: { seat: SeatPoint | null } = { seat: null };

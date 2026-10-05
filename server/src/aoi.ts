import { CHUNK_SIZE, HALF_WORLD, type PlayerId } from './protocol.js';
import { distance2d } from './validate.js';

/**
 * Interest management (MULTIPLAYER.md 4.1): grid spasial dengan sel 64 m (ukuran chunk dunia).
 * Tiap pemain menerima update pemain lain pada frekuensi berbeda sesuai jarak:
 *   <= 120 m            : 15 Hz
 *   120 m .. 250 m      : 3 Hz
 *   > 250 m             : posisi kasar tiap 2 detik
 */

export const AOI_NEAR_RADIUS = 120;
export const AOI_MID_RADIUS = 250;
export const AOI_INTERVAL_MS = { near: 1000 / 15, mid: 1000 / 3, far: 2000 } as const;
export type AoiTier = keyof typeof AOI_INTERVAL_MS;

/** Jumlah sel grid per sisi dunia (512 / 64 = 8). */
export const GRID_CELLS = Math.ceil((HALF_WORLD * 2) / CHUNK_SIZE);

export function aoiTier(dist: number): AoiTier {
  if (dist <= AOI_NEAR_RADIUS) return 'near';
  if (dist <= AOI_MID_RADIUS) return 'mid';
  return 'far';
}

/** Benar kalau update subjek sudah waktunya dikirim lagi ke penerima ini (toleransi 1 ms seperti klien). */
export function aoiDue(dist: number, lastSentMs: number | undefined, nowMs: number): boolean {
  if (lastSentMs === undefined) return true;
  return nowMs - lastSentMs >= AOI_INTERVAL_MS[aoiTier(dist)] - 1;
}

/** Indeks sel grid dari koordinat dunia; dijepit ke dalam peta. */
export const cellIndex = (value: number): number =>
  Math.min(GRID_CELLS - 1, Math.max(0, Math.floor((value + HALF_WORLD) / CHUNK_SIZE)));

export const cellKey = (cx: number, cz: number): number => cz * GRID_CELLS + cx;

export interface GridEntry {
  id: PlayerId;
  x: number;
  z: number;
}

/**
 * Grid spasial sederhana: dibangun ulang tiap tick (50 pemain × 1 insert jauh lebih murah
 * daripada menjaga indeks saat pemain bergerak 15 Hz).
 */
export class SpatialGrid {
  private readonly cells = new Map<number, GridEntry[]>();

  clear(): void {
    this.cells.clear();
  }

  insert(entry: GridEntry): void {
    const key = cellKey(cellIndex(entry.x), cellIndex(entry.z));
    const bucket = this.cells.get(key);
    if (bucket) bucket.push(entry);
    else this.cells.set(key, [entry]);
  }

  /** Semua entri dalam kotak radius `radius` m di sekitar titik (termasuk titik itu sendiri). */
  queryRadius(x: number, z: number, radius: number): GridEntry[] {
    const span = Math.ceil(radius / CHUNK_SIZE);
    const cx = cellIndex(x);
    const cz = cellIndex(z);
    const found: GridEntry[] = [];
    for (let dz = -span; dz <= span; dz++) {
      const zi = cz + dz;
      if (zi < 0 || zi >= GRID_CELLS) continue;
      for (let dx = -span; dx <= span; dx++) {
        const xi = cx + dx;
        if (xi < 0 || xi >= GRID_CELLS) continue;
        const bucket = this.cells.get(cellKey(xi, zi));
        if (!bucket) continue;
        for (const entry of bucket) {
          if (distance2d({ x, z }, entry) <= radius) found.push(entry);
        }
      }
    }
    return found;
  }

  /** Entri dalam radius `near` saja, dipakai untuk filter chat 30 m. */
  queryNear(x: number, z: number, radius: number): GridEntry[] {
    return this.queryRadius(x, z, radius);
  }

  get size(): number {
    let total = 0;
    for (const bucket of this.cells.values()) total += bucket.length;
    return total;
  }
}

/**
 * Daftar subjek yang harus dikirim ke satu penerima pada `nowMs`, dengan tier-nya.
 * `lastSent` menyimpan waktu kirim terakhir per subjek dan diperbarui di tempat.
 */
export function dueUpdates(
  origin: { x: number; z: number } | null,
  subjects: readonly GridEntry[],
  lastSent: Map<PlayerId, number>,
  nowMs: number,
): { id: PlayerId; tier: AoiTier }[] {
  const out: { id: PlayerId; tier: AoiTier }[] = [];
  for (const subject of subjects) {
    // Penerima yang belum punya posisi dianggap dekat dengan semua (sama dengan session.ts).
    const dist = origin ? distance2d(origin, subject) : 0;
    if (!aoiDue(dist, lastSent.get(subject.id), nowMs)) continue;
    lastSent.set(subject.id, nowMs);
    out.push({ id: subject.id, tier: aoiTier(dist) });
  }
  return out;
}

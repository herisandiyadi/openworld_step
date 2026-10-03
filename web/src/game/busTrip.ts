import type { BusRide } from '../ambient/busRide';
import type { BusStop } from '../world/worldSpec';

/**
 * State perjalanan bus per frame (bukan React, bukan save game). Ditulis oleh game/actions.ts
 * (minta perjalanan / turun) dan ambient/AmbientLayer.tsx (yang memegang graf lajur dan bus kota),
 * dibaca PlayerController dan CameraRig.
 *
 * Kenapa permintaan lewat sini, bukan langsung memanggil busRide: graf lajur dan rute bus hanya ada
 * di AmbientLayer setelah lanes.json dimuat. Kalau AmbientLayer belum siap atau gagal, permintaan
 * tidak pernah diambil dan PlayerController menjalankan fast travel lama setelah PICKUP_WATCHDOG.
 */
export const busTrip: {
  request: { from: BusStop; to: BusStop } | null;
  ride: BusRide | null;
  /** Halte tujuan; disimpan terpisah supaya fallback tetap tahu tujuan walau ride null. */
  to: BusStop | null;
  /** Detik sejak permintaan dibuat tanpa diambil AmbientLayer. */
  pending: number;
  /** Pose bus terakhir (dunia), untuk titik turun darurat. */
  pose: { x: number; z: number; dirX: number; dirZ: number } | null;
} = { request: null, ride: null, to: null, pending: 0, pose: null };

/** Batas tunggu AmbientLayer mengambil permintaan sebelum jatuh ke fast travel (detik). */
export const PICKUP_WATCHDOG = 3;

export function resetBusTrip(): void {
  busTrip.request = null;
  busTrip.ride = null;
  busTrip.to = null;
  busTrip.pending = 0;
  busTrip.pose = null;
}

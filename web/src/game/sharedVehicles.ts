import { create } from 'zustand';
import type { PlayerId } from '../net/protocol';
import type { VehicleInfo } from '../net/session';

/**
 * Kendaraan bersama (MULTIPLAYER.md 5): kepemilikan ditentukan host (net/session.ts) atau server
 * (server/src/room.ts). Modul ini hanya mencerminkan `vehicleState` yang diterima, tidak memutuskan apa pun.
 * ownerId 0 berarti kendaraan bebas, sama seperti di host/server.
 */
export const NO_OWNER: PlayerId = 0;

/** Warna penanda kendaraan yang sedang dipakai pemain lain (cincin merah di bawah kendaraan). */
export const CLAIMED_TINT = '#e5484d';

export interface VehiclePose {
  x: number;
  z: number;
  yaw: number;
}

interface SharedVehiclesState {
  /** Pemilik per vehicleId; kendaraan yang tidak tercatat dianggap bebas. */
  owners: Record<string, PlayerId>;
  /** Pose terakhir yang dilaporkan host per vehicleId. */
  poses: Record<string, VehiclePose>;
}

/** State kecil terpisah dari gameStore supaya single-player tidak tersentuh sama sekali. */
export const useSharedVehicles = create<SharedVehiclesState>()(() => ({ owners: {}, poses: {} }));

/** Pemilik kendaraan menurut host, atau NO_OWNER. */
export function vehicleOwner(owners: Readonly<Record<string, PlayerId>>, vehicleId: string): PlayerId {
  return owners[vehicleId] ?? NO_OWNER;
}

/** True kalau kendaraan dipegang pemain lain (bukan pemain lokal). */
export function isClaimedByOther(ownerId: PlayerId, localId: PlayerId | null): boolean {
  return ownerId !== NO_OWNER && ownerId !== localId;
}

/**
 * Boleh dinaiki secara lokal? Tanpa sesi (mode null) selalu boleh, jadi single-player tidak berubah.
 * Dalam sesi: bebas atau sudah milik sendiri (sama dengan aturan mount host/server).
 */
export function isClaimable(ownerId: PlayerId, localId: PlayerId | null, inSession: boolean): boolean {
  if (!inSession) return true;
  return !isClaimedByOther(ownerId, localId);
}

/** Warna penanda kendaraan: merah kalau dipakai pemain lain, null kalau tidak perlu penanda. */
export function vehicleTint(ownerId: PlayerId, localId: PlayerId | null): string | null {
  return isClaimedByOther(ownerId, localId) ? CLAIMED_TINT : null;
}

/** Label di atas kendaraan yang sedang dipakai pemain lain. */
export function claimedLabel(username: string | undefined): string {
  return username ? `Dipakai ${username}` : 'Dipakai pemain lain';
}

/**
 * Pemain lokal harus turun kalau host melaporkan kendaraan yang sedang dinaikinya dimiliki pemain lain
 * (misalnya klaim lokal kalah balapan dengan pemain lain dan host menolak 'vehicle-taken').
 */
export function shouldEject(info: VehicleInfo, localId: PlayerId | null, ridingId: string | null): boolean {
  return ridingId === info.vehicleId && isClaimedByOther(info.ownerId, localId);
}

/** Menerapkan satu `vehicleState` dari host ke state lokal (murni, mudah dites). */
export function reduceVehicleUpdate(state: SharedVehiclesState, info: VehicleInfo): SharedVehiclesState {
  const owners = { ...state.owners };
  if (info.ownerId === NO_OWNER) delete owners[info.vehicleId];
  else owners[info.vehicleId] = info.ownerId;
  return { owners, poses: { ...state.poses, [info.vehicleId]: { x: info.x, z: info.z, yaw: info.yaw } } };
}

/**
 * Dihubungkan oleh integrator ke `onVehicleUpdate(cb)` di netRuntime.
 * Hanya menyentuh store kendaraan bersama; posisi parkir di gameStore disesuaikan oleh pemanggil
 * lewat `onSharedVehicleUpdate` (lihat ParkedVehicles/actions) supaya modul ini bebas dependensi game.
 */
export function applyVehicleUpdate(info: VehicleInfo): void {
  useSharedVehicles.setState((state) => reduceVehicleUpdate(state, info));
  for (const listener of listeners) listener(info);
}

type VehicleListener = (info: VehicleInfo) => void;
const listeners = new Set<VehicleListener>();

/** Pendengar tambahan setiap kali applyVehicleUpdate dipanggil; mengembalikan fungsi berhenti. */
export function onSharedVehicleUpdate(listener: VehicleListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Kosongkan saat keluar sesi supaya tidak ada kendaraan yang tetap terkunci di single-player. */
export function resetSharedVehicles(): void {
  useSharedVehicles.setState({ owners: {}, poses: {} });
}

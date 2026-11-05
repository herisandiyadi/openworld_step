/**
 * Culling murni (tanpa three/GPU) — VISUAL_UPGRADE_TASKS §6 P1:
 * frustum culling per chunk, distance culling props kecil, dan occlusion sederhana
 * untuk bangunan besar. Semua bentuk diterima sebagai data biasa supaya bisa diuji di node.
 *
 * Konvensi plane mengikuti three.js: titik p ada di dalam bila nx*px + ny*py + nz*pz + d >= 0.
 */
import type { QualityTier } from '../state/qualityTiers';
import { CHUNK_SIZE } from '../world/worldSpec';

export interface Box {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface Plane {
  nx: number;
  ny: number;
  nz: number;
  d: number;
}

export interface Eye {
  x: number;
  y: number;
  z: number;
}

/**
 * Uji AABB terhadap daftar plane frustum. Konservatif: kotak yang memotong batas dianggap
 * terlihat. Daftar plane kosong = tanpa culling (dipakai saat kamera belum siap).
 */
export function boxInFrustum(box: Box, planes: readonly Plane[]): boolean {
  for (const plane of planes) {
    // Titik terjauh kotak ke arah normal plane; bila titik itu pun di luar, seluruh kotak di luar.
    const px = plane.nx > 0 ? box.maxX : box.minX;
    const py = plane.ny > 0 ? box.maxY : box.minY;
    const pz = plane.nz > 0 ? box.maxZ : box.minZ;
    if (plane.nx * px + plane.ny * py + plane.nz * pz + plane.d < 0) return false;
  }
  return true;
}

/** Ambang distance culling props kecil (m) per tier. Low memotong paling agresif. */
const PROP_CULL_DISTANCE: Readonly<Record<QualityTier, number>> = { low: 35, medium: 60, high: 90 };

export const propCullDistance = (tier: QualityTier): number => PROP_CULL_DISTANCE[tier];

/** Prop kecil terlihat bila jaraknya masih di dalam ambang tier (batas tepat masih terlihat). */
export const smallPropVisible = (distance: number, tier: QualityTier): boolean =>
  Number.isFinite(distance) && distance <= PROP_CULL_DISTANCE[tier];

/**
 * Backwards-compatible helper for callers that still reason in chunk rings.
 * Runtime streaming uses exact metre distance to chunk centres instead.
 */
export const propsVisibleAtDistance = (chunkDistance: number, tier: QualityTier): boolean =>
  smallPropVisible(chunkDistance * CHUNK_SIZE, tier);

export interface OccluderPolicy {
  /** Tinggi minimum (m) agar sebuah bangunan layak jadi occluder. */
  minHeight: number;
  /** Luas footprint minimum (m²). */
  minFootprint: number;
}

export const DEFAULT_OCCLUDER_POLICY: OccluderPolicy = { minHeight: 12, minFootprint: 50 };

/** Hanya bangunan tinggi dan lebar yang dipakai sebagai occluder (urutan input dipertahankan). */
export function selectOccluders(boxes: readonly Box[], policy: OccluderPolicy = DEFAULT_OCCLUDER_POLICY): Box[] {
  return boxes.filter(
    (box) =>
      box.maxY - box.minY >= policy.minHeight &&
      (box.maxX - box.minX) * (box.maxZ - box.minZ) >= policy.minFootprint,
  );
}

/** Jarak horizontal terdekat dari mata ke kotak (0 bila mata di dalam footprint). */
function nearDistance(box: Box, eye: Eye): number {
  const dx = Math.max(box.minX - eye.x, 0, eye.x - box.maxX);
  const dz = Math.max(box.minZ - eye.z, 0, eye.z - box.maxZ);
  return Math.hypot(dx, dz);
}

/** Jarak horizontal terjauh dari mata ke sudut kotak. */
function farDistance(box: Box, eye: Eye): number {
  const dx = Math.max(Math.abs(box.minX - eye.x), Math.abs(box.maxX - eye.x));
  const dz = Math.max(Math.abs(box.minZ - eye.z), Math.abs(box.maxZ - eye.z));
  return Math.hypot(dx, dz);
}

const corners = (box: Box): [number, number][] => [
  [box.minX, box.minZ],
  [box.minX, box.maxZ],
  [box.maxX, box.minZ],
  [box.maxX, box.maxZ],
];

/** Rentang bearing (rad) sudut-sudut kotak dilihat dari mata; null bila melingkupi mata. */
function bearingRange(box: Box, eye: Eye): { min: number; max: number } | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const [x, z] of corners(box)) {
    const angle = Math.atan2(z - eye.z, x - eye.x);
    min = Math.min(min, angle);
    max = Math.max(max, angle);
  }
  // Rentang > 180° berarti melewati batas ±PI (atau mata di dalam kotak): jangan ambil risiko.
  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min > Math.PI) return null;
  return { min, max };
}

/**
 * Occlusion kasar dan konservatif: target dianggap tertutup hanya bila seluruh siluetnya
 * (bearing + elevasi) berada di dalam siluet SATU occluder yang lebih dekat. Siluet occluder
 * dihitung dari sisi terjauhnya sehingga selalu lebih kecil dari kenyataan — lebih baik
 * gagal mengoklusi (objek digambar sia-sia) daripada menghilangkan objek yang terlihat.
 */
export function isOccluded(target: Box, occluders: readonly Box[], eye: Eye): boolean {
  const targetNear = nearDistance(target, eye);
  if (targetNear <= 0) return false;
  const targetBearing = bearingRange(target, eye);
  if (!targetBearing) return false;

  for (const occluder of occluders) {
    // Mata di atas atap: bangunan tidak lagi menutup apa pun di belakangnya.
    if (eye.y >= occluder.maxY) continue;
    const occluderFar = farDistance(occluder, eye);
    if (occluderFar <= 0 || targetNear <= occluderFar) continue;
    const occluderBearing = bearingRange(occluder, eye);
    if (!occluderBearing) continue;
    if (targetBearing.min < occluderBearing.min || targetBearing.max > occluderBearing.max) continue;
    // Elevasi: puncak target harus di bawah siluet atap occluder.
    const targetElevation = Math.atan2(target.maxY - eye.y, targetNear);
    const occluderElevation = Math.atan2(occluder.maxY - eye.y, occluderFar);
    if (targetElevation <= occluderElevation) return true;
  }
  return false;
}

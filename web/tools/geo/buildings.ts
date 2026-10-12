/**
 * Bangunan OSM -> AABB (sumbu-sejajar, sesuai engine). Polygon non-persegi dibungkus
 * AABB penuhnya; footprint yang terlalu kecil (< 4 m2) dibuang supaya tidak jadi noise.
 */
import type { Building } from '../../src/world/worldSpec';

export const BUILDING_COLORS = ['#b7bcc6', '#c9c2b6', '#a9b0ba', '#d2cabf', '#9fa7b2', '#c4b8ab'] as const;
export const HEIGHT_PER_LEVEL = 3.2;
export const MIN_FOOTPRINT_M2 = 4;

export function colorFor(id: string): string {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return BUILDING_COLORS[(h >>> 0) % BUILDING_COLORS.length] as string;
}

export function heightFor(tags: Record<string, string>, fallback: number): number {
  const h = Number.parseFloat(tags.height ?? '');
  if (Number.isFinite(h) && h > 0) return h;
  const levels = Number.parseFloat(tags['building:levels'] ?? '');
  if (Number.isFinite(levels) && levels > 0) return levels * HEIGHT_PER_LEVEL;
  return fallback;
}

export interface BuildingInput {
  id: string;
  tags: Record<string, string>;
  pts: [number, number][];
  ground: (x: number, z: number) => number;
}

export function footprintToBuilding(input: BuildingInput, fallbackHeight: number): Building | null {
  const { pts } = input;
  if (pts.length < 3) return null;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of pts) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  if ((maxX - minX) * (maxZ - minZ) < MIN_FOOTPRINT_M2) return null;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const samples = [
    input.ground(minX, minZ), input.ground(maxX, minZ),
    input.ground(minX, maxZ), input.ground(maxX, maxZ), input.ground(cx, cz),
  ];
  const round2 = (v: number) => Math.round(v * 100) / 100;
  const height = heightFor(input.tags, fallbackHeight);
  return {
    minX: round2(minX), maxX: round2(maxX), minZ: round2(minZ), maxZ: round2(maxZ),
    baseY: round2(Math.min(...samples) - 0.3),
    topY: round2(Math.max(...samples) + height),
    color: colorFor(input.id),
  };
}

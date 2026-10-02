import type { Category } from './defs/types';

export interface Budget {
  maxTriangles: number;
  maxMaterials: number;
  maxDrawCalls: number;
  maxBytes: number;
  maxBones?: number;
}

/** Per-category hard limits (prompt section 6B), checked after optimisation. */
export const BUDGETS: Record<Category, Budget> = {
  // Hero kustomisasi: 11 node varian + 4 material slot di file; runtime menggabung yang terlihat jadi 1 draw call.
  hero: { maxTriangles: 5000, maxMaterials: 4, maxDrawCalls: 11, maxBytes: 400_000, maxBones: 40 },
  npc: { maxTriangles: 3000, maxMaterials: 2, maxDrawCalls: 2, maxBytes: 300_000, maxBones: 40 },
  vehicle_bike: { maxTriangles: 800, maxMaterials: 2, maxDrawCalls: 4, maxBytes: 60_000 },
  vehicle_small: { maxTriangles: 500, maxMaterials: 2, maxDrawCalls: 2, maxBytes: 40_000 },
  // Mobil/bus: satu draw call bodi + satu per roda/pintu (node terpisah supaya runtime bisa memutarnya).
  vehicle_car: { maxTriangles: 1200, maxMaterials: 2, maxDrawCalls: 6, maxBytes: 80_000 },
  vehicle_bus: { maxTriangles: 1500, maxMaterials: 2, maxDrawCalls: 10, maxBytes: 110_000 },
  // Hewan di-instance: satu primitive, animasi vertex memakai JOINTS_0 sebagai indeks bagian.
  animal: { maxTriangles: 800, maxMaterials: 2, maxDrawCalls: 2, maxBytes: 60_000, maxBones: 20 },
  // Prop dengan node emissive terpisah (lampu lalu lintas).
  prop_lit: { maxTriangles: 500, maxMaterials: 2, maxDrawCalls: 5, maxBytes: 40_000 },
  prop_small: { maxTriangles: 500, maxMaterials: 2, maxDrawCalls: 2, maxBytes: 40_000 },
  tree: { maxTriangles: 800, maxMaterials: 2, maxDrawCalls: 2, maxBytes: 60_000 },
  structure: { maxTriangles: 3000, maxMaterials: 2, maxDrawCalls: 2, maxBytes: 120_000 },
};
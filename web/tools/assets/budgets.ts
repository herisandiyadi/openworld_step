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
  // Hero kustomisasi: 16 node varian (badan, kulit, 3 rambut, 3 baju, 3 bawahan, 3 ekspresi, 2 aksesori)
  // + 5 material (palet + slot kulit/rambut/baju/celana) di file. Angka ini hanya isi file: runtime
  // (HeroAppearance.applyAppearance) menggabung node terlihat jadi 1 SkinnedMesh = 1 draw call di HP.
  hero: { maxTriangles: 5000, maxMaterials: 5, maxDrawCalls: 16, maxBytes: 400_000, maxBones: 40 },
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
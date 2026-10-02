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
  hero: { maxTriangles: 5000, maxMaterials: 2, maxDrawCalls: 2, maxBytes: 400_000, maxBones: 40 },
  npc: { maxTriangles: 3000, maxMaterials: 2, maxDrawCalls: 2, maxBytes: 300_000, maxBones: 40 },
  vehicle_bike: { maxTriangles: 800, maxMaterials: 2, maxDrawCalls: 4, maxBytes: 60_000 },
  vehicle_small: { maxTriangles: 500, maxMaterials: 2, maxDrawCalls: 2, maxBytes: 40_000 },
  prop_small: { maxTriangles: 500, maxMaterials: 2, maxDrawCalls: 2, maxBytes: 40_000 },
  tree: { maxTriangles: 800, maxMaterials: 2, maxDrawCalls: 2, maxBytes: 60_000 },
  structure: { maxTriangles: 3000, maxMaterials: 2, maxDrawCalls: 2, maxBytes: 120_000 },
};
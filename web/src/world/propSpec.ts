export type Vec3Tuple = [number, number, number];
export type CityQuality = 'low' | 'medium' | 'high';

/** Reusable facade modules; runtime may choose any combination without requiring fake assets. */
export const FACADE_KIT = ['door', 'window', 'signage', 'balcony', 'ac_unit', 'drainage'] as const;
/** Maximum decorative instances per active city chunk, preserving mobile budgets. */
export const PROP_DENSITY: Record<CityQuality, number> = { low: 30, medium: 60, high: 100 };
export const PROP_LOD_DISTANCES = { high: 90, medium: 65, low: 45 } as const;
export const DECAL_POLICY = { atlas: true, maxPerChunk: 24, dynamicContactFallback: true } as const;
export const BUILDING_VARIATIONS = 4;
export function propCountForQuality(quality: CityQuality, candidates: number): number {
  return Math.min(PROP_DENSITY[quality], Math.max(0, Math.floor(candidates)));
}

export const PROP_IDS = ['prop_streetlamp_01', 'prop_bench_01', 'prop_bench_02', 'prop_tree_01', 'prop_trashbin_01', 'prop_busstop_01'] as const;
export type PropId = (typeof PROP_IDS)[number];
export interface BoxCollider { type: 'box'; center: Vec3Tuple; size: Vec3Tuple }
export const SEAT_OFFSETS_X = [-0.4, 0.4] as const;
export const SEAT_HEIGHT = 0.45;
export const BENCH_IDS: readonly PropId[] = PROP_IDS.filter((id) => id.startsWith('prop_bench_'));
export const PROP_COLLIDERS: Record<PropId, BoxCollider> = {
  prop_streetlamp_01: { type: 'box', center: [0, 2.1, 0], size: [0.3, 4.2, 0.3] },
  prop_bench_01: { type: 'box', center: [0, 0.45, 0], size: [1.6, 0.9, 0.6] },
  prop_bench_02: { type: 'box', center: [0, 0.45, 0], size: [1.3, 0.9, 0.55] },
  prop_tree_01: { type: 'box', center: [0, 1, 0], size: [0.45, 2, 0.45] },
  prop_trashbin_01: { type: 'box', center: [0, 0.45, 0], size: [0.55, 0.9, 0.55] },
  prop_busstop_01: { type: 'box', center: [0, 1.3, 0], size: [3.0, 2.6, 1.4] },
};

export type Vec3Tuple = [number, number, number];

export const PROP_IDS = [
  'prop_streetlamp_01',
  'prop_bench_01',
  'prop_tree_01',
  'prop_trashbin_01',
  'prop_busstop_01',
] as const;

export type PropId = (typeof PROP_IDS)[number];

export interface BoxCollider {
  type: 'box';
  /** Local-space centre and full size; the model's pivot is at its base. */
  center: Vec3Tuple;
  size: Vec3Tuple;
}

/** Simple collision volumes (not the visual mesh). Also exported to assets/manifest.json. */
export const PROP_COLLIDERS: Record<PropId, BoxCollider> = {
  prop_streetlamp_01: { type: 'box', center: [0, 2.1, 0], size: [0.3, 4.2, 0.3] },
  prop_bench_01: { type: 'box', center: [0, 0.45, 0], size: [1.6, 0.9, 0.6] },
  prop_tree_01: { type: 'box', center: [0, 1, 0], size: [0.45, 2, 0.45] },
  prop_trashbin_01: { type: 'box', center: [0, 0.45, 0], size: [0.55, 0.9, 0.55] },
  prop_busstop_01: { type: 'box', center: [0, 1.3, 0], size: [3.0, 2.6, 1.4] },
};
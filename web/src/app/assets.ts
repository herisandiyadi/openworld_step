import { useGLTF } from '@react-three/drei';

export type AssetId =
  | 'char_hero'
  | 'char_hero_m'
  | 'char_hero_f'
  | 'npc_vendor'
  | 'veh_bicycle'
  | 'veh_skateboard'
  | 'prop_streetlamp_01'
  | 'prop_bench_01'
  | 'prop_tree_01'
  | 'prop_trashbin_01'
  | 'prop_busstop_01';

const PRELOAD: AssetId[] = [
  'char_hero_m',
  'char_hero_f',
  'npc_vendor',
  'veh_bicycle',
  'veh_skateboard',
  'prop_streetlamp_01',
  'prop_bench_01',
  'prop_tree_01',
  'prop_trashbin_01',
  'prop_busstop_01',
];

/** GLBs produced by tools/assets (meshopt-compressed; drei's loader decodes them). */
export const assetUrl = (id: AssetId): string => `${import.meta.env.BASE_URL}assets/${id}.glb`;

export function preloadAssets(): void {
  for (const id of PRELOAD) useGLTF.preload(assetUrl(id));
}
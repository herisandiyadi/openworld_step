import type { Document } from '@gltf-transform/core';
import type { BoxCollider } from '../../../src/world/propSpec';

export type Category = 'hero' | 'npc' | 'vehicle_small' | 'vehicle_bike' | 'prop_small' | 'tree' | 'structure';

export interface CapsuleCollider {
  type: 'capsule';
  radius: number;
  height: number;
  center: [number, number, number];
}

export type Collider = BoxCollider | CapsuleCollider;

export interface PreviewPose {
  clip: string;
  phase: number;
  /** Render another (already built) asset at the origin, e.g. hero on the bicycle. */
  with?: string;
}

export interface AssetDef {
  id: string;
  category: Category;
  tags: string[];
  collider: Collider;
  build: () => Document;
  requiredAnimations?: string[];
  /** Nodes the runtime animates (must exist and stay pivoted correctly). */
  requiredNodes?: string[];
  previews?: PreviewPose[];
  meta?: Record<string, unknown>;
}
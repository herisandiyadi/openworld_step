import type { Aabb } from '../game/movement';
import type { PropId } from './propSpec';
import type { DistrictId } from './worldSpec';

/** Main thread -> chunk worker. */
export interface ChunkLoadRequest {
  type: 'load';
  key: string;
  /** Absolute URL (workers resolve relative URLs against their own script location). */
  url: string;
}

/** Render-ready chunk produced off the main thread; every typed array is transferred, not copied. */
export interface BuiltChunk {
  key: string;
  cx: number;
  cz: number;
  district: DistrictId;
  /** Heightmap (cm) and surface ids, kept for ground-height queries on the main thread. */
  heights: Int32Array;
  surface: Uint8Array;
  terrain: { positions: Float32Array; normals: Float32Array; colors: Float32Array };
  /** Unit-box instance matrices (column-major, 16 floats each) and linear RGB colours. */
  buildingMatrices: Float32Array;
  buildingColors: Float32Array;
  /** Per prop type: placement matrices (yaw + position) to be multiplied by each GLB part's own transform. */
  props: { id: PropId; matrices: Float32Array }[];
  colliders: Aabb[];
  /** Fetch + parse + build time inside the worker. */
  workerMs: number;
}

export type ChunkWorkerResponse =
  | { type: 'loaded'; chunk: BuiltChunk }
  | { type: 'error'; key: string; message: string };
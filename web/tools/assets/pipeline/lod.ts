/**
 * Notion §12.6 runtime LOD chain for built asset documents.
 *
 * For each configured ratio (PIPELINE_CONFIG.lod.scales, used as the target
 * triangle ratio per level) this returns a simplified copy of the source
 * document. Level 0 is the source at full detail; levels >= 1 are simplified.
 *
 * Design notes:
 * - `simplifySloppy` ignores topology quality, which suits distant props. It
 *   can't move locked vertices, so every vertex on the primitive's local AABB
 *   is locked. This keeps world bounds (pivot, footprint, height) intact;
 *   plain `simplify` pulled AABBs in by up to ~5.6% in probes.
 * - Normals and COLOR_0 are kept by compacting the primitive with
 *   `compactPrimitive`, which remaps every attribute.
 * - Only float32-position, indexed, triangle primitives are simplified. Any
 *   other primitive is copied unchanged.
 */
import { type Document, Primitive } from '@gltf-transform/core';
import { cloneDocument, compactPrimitive, dequantize } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

async function simplifyPrimitive(prim: Primitive, ratio: number): Promise<void> {
  if (ratio >= 1) return;
  if (prim.getMode() !== Primitive.Mode.TRIANGLES) return;
  const indices = prim.getIndices();
  const position = prim.getAttribute('POSITION');
  if (!indices || !position) return;

  const indexArray = indices.getArray();
  const positionArray = position.getArray();
  if (!(indexArray instanceof Uint16Array || indexArray instanceof Uint32Array)) return;
  if (!(positionArray instanceof Float32Array)) return;

  const srcIndices = new Uint32Array(indexArray);
  const positions = new Float32Array(positionArray);
  const vertexCount = position.getCount();

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vertexCount; i++) {
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[i * 3 + axis]!;
      min[axis] = Math.min(min[axis]!, value);
      max[axis] = Math.max(max[axis]!, value);
    }
  }
  const lock = new Uint8Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[i * 3 + axis]!;
      if (value === min[axis] || value === max[axis]) {
        lock[i] = 1;
        break;
      }
    }
  }

  const targetIndexCount = Math.max(3, Math.floor((srcIndices.length * ratio) / 3) * 3);
  const [dstIndices] = MeshoptSimplifier.simplifySloppy(srcIndices, positions, 3, lock, targetIndexCount, 1);

  prim.setIndices(indices.clone().setArray(dstIndices.length <= 65534 ? new Uint16Array(dstIndices) : new Uint32Array(dstIndices)));
  compactPrimitive(prim);
}

/**
 * Returns one document per ratio, ordered as given (index 0 = highest detail).
 * The input document is never mutated.
 */
export async function buildLodChain(source: Document, ratios: readonly number[]): Promise<Document[]> {
  await MeshoptSimplifier.ready;
  const levels: Document[] = [];
  for (const ratio of ratios) {
    const level = cloneDocument(source);
    // Build input is already quantized. Simplification requires true float
    // positions; dequantize all attributes before running meshoptimizer.
    await level.transform(dequantize());
    for (const mesh of level.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) await simplifyPrimitive(prim, ratio);
    }
    levels.push(level);
  }
  return levels;
}

import { NodeIO, type Document } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import { BUDGETS } from '../budgets';
import { propAssets } from '../defs/props';
import { boundsOf, evaluateScene, type Bounds } from '../lib/evaluate';
import { PIPELINE_CONFIG } from './config';
import { buildLodChain } from './lod';

function triangleCount(doc: Document): number {
  return doc.getRoot().listMeshes().reduce(
    (sum, mesh) => sum + mesh.listPrimitives().reduce(
      (meshSum, primitive) => meshSum + (primitive.getIndices()?.getCount() ?? primitive.getAttribute('POSITION')?.getCount() ?? 0) / 3,
      0,
    ),
    0,
  );
}

function meshNodeNames(doc: Document): string[] {
  return doc.getRoot().listNodes().filter((node) => node.getMesh()).map((node) => node.getName());
}

function expectBoundsWithinPercent(actual: Bounds, expected: Bounds, tolerance: number): void {
  for (let axis = 0; axis < 3; axis++) {
    const size = expected.max[axis]! - expected.min[axis]!;
    const allowed = Math.max(size * tolerance, 1e-6);
    expect(Math.abs(actual.min[axis]! - expected.min[axis]!)).toBeLessThanOrEqual(allowed);
    expect(Math.abs(actual.max[axis]! - expected.max[axis]!)).toBeLessThanOrEqual(allowed);
  }
}

const prop = propAssets.find((asset) => asset.id === 'prop_trashbin_01')!;
let levels: Document[];

beforeAll(async () => {
  levels = await buildLodChain(prop.build(), PIPELINE_CONFIG.lod.scales);
});

describe('buildLodChain', () => {
  // Non-strict: for coarse props (>=90 tris) the 0.5 and 0.1 ratios can both clamp to the
  // same floor, so LOD2 is not always strictly below LOD1. Strict per-level decrease on quantized
  // build input is enforced separately by build.ts (LOD_CATEGORIES gate).
  it('returns levels ordered from highest to lowest detail', () => {
    expect(levels).toHaveLength(PIPELINE_CONFIG.lod.scales.length);
    const triangles = levels.map(triangleCount);
    for (let level = 1; level < triangles.length; level++) expect(triangles[level]).toBeLessThanOrEqual(triangles[level - 1]!);
  });

  it('reduces LOD1 triangles while staying under the prop_small budget', () => {
    expect(triangleCount(levels[1]!)).toBeLessThan(triangleCount(levels[0]!));
    expect(triangleCount(levels[1]!)).toBeLessThanOrEqual(BUDGETS.prop_small.maxTriangles);
  });

  it('keeps LOD1 bounds within 3% of LOD0', () => {
    expectBoundsWithinPercent(boundsOf(evaluateScene(levels[1]!)), boundsOf(evaluateScene(levels[0]!)), 0.03);
  });

  it('keeps mesh node names, material count, normals, and vertex colours', () => {
    for (const level of levels.slice(1)) {
      expect(meshNodeNames(level)).toEqual(meshNodeNames(levels[0]!));
      expect(level.getRoot().listMaterials()).toHaveLength(levels[0]!.getRoot().listMaterials().length);
      for (const mesh of level.getRoot().listMeshes()) {
        for (const primitive of mesh.listPrimitives()) {
          expect(primitive.getAttribute('NORMAL')).not.toBeNull();
          expect(primitive.getAttribute('COLOR_0')).not.toBeNull();
        }
      }
    }
  });
});

describe('buildLodChain on the optimised (meshopt-quantized) document', () => {
  it('still reduces triangles when positions are quantized, as in the build pipeline', async () => {
    const io = new NodeIO()
      .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
      .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
    await MeshoptEncoder.ready;
    await MeshoptDecoder.ready;
    const optimized = await io.readBinary(await io.writeBinary(prop.build()));
    await optimized.transform(dedup(), prune(), weld(), meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizationVolume: 'mesh' }));
    const chain = await buildLodChain(optimized, PIPELINE_CONFIG.lod.scales);
    expect(triangleCount(chain[1]!)).toBeLessThan(triangleCount(chain[0]!));
    expectBoundsWithinPercent(boundsOf(evaluateScene(chain[1]!)), boundsOf(evaluateScene(chain[0]!)), 0.03);
  });
});

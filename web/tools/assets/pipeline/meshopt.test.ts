import { Document } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { checkMeshoptRoundTrip } from './meshopt';

function triangleDoc(): Document {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1])).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array([0, 1, 2])).setBuffer(buffer))
    .setMaterial(doc.createMaterial('m'));
  doc.createScene('s').addChild(doc.createNode('n').setMesh(doc.createMesh('m').addPrimitive(prim)));
  return doc;
}

describe('checkMeshoptRoundTrip', () => {
  it('encodes with EXT_meshopt_compression and decodes back within tolerance', async () => {
    const result = await checkMeshoptRoundTrip(triangleDoc());
    expect(result.extensionsUsed).toContain('EXT_meshopt_compression');
    expect(result.triangles).toBe(1);
    expect(result.maxDrift).toBeLessThan(0.01);
    expect(result.ok).toBe(true);
  });
});

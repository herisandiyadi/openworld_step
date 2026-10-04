import { Document } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { validateDocument } from './validate';

function makeDoc(opts: { normals?: boolean; tangents?: boolean; uv2?: boolean; scaleNode?: number; translateY?: number } = {}): Document {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const position = doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1])).setBuffer(buffer);
  const prim = doc.createPrimitive().setAttribute('POSITION', position).setMaterial(doc.createMaterial('mat'));
  if (opts.normals !== false) prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0])).setBuffer(buffer));
  if (opts.tangents) prim.setAttribute('TANGENT', doc.createAccessor().setType('VEC4').setArray(new Float32Array([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1])).setBuffer(buffer));
  if (opts.uv2) prim.setAttribute('TEXCOORD_1', doc.createAccessor().setType('VEC2').setArray(new Float32Array([0, 0, 1, 0, 0, 1])).setBuffer(buffer));
  const node = doc.createNode('root').setMesh(doc.createMesh('mesh').addPrimitive(prim));
  if (opts.scaleNode !== undefined) node.setScale([opts.scaleNode, opts.scaleNode, opts.scaleNode]);
  if (opts.translateY !== undefined) node.setTranslation([0, opts.translateY, 0]);
  doc.createScene('scene').addChild(node);
  return doc;
}

describe('validateDocument', () => {
  it('passes a dynamic asset with applied transforms and normals', () => {
    const report = validateDocument(makeDoc(), { id: 'veh', category: 'vehicle_car', kind: 'dynamic' });
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('flags unapplied node scale as a world-scale violation', () => {
    const codes = validateDocument(makeDoc({ scaleNode: 100 }), { id: 'veh', category: 'vehicle_car', kind: 'dynamic' }).errors.map((e) => e.code);
    expect(codes).toContain('TRANSFORM_NOT_APPLIED');
  });

  it('flags missing normals', () => {
    const codes = validateDocument(makeDoc({ normals: false }), { id: 'veh', category: 'vehicle_car', kind: 'dynamic' }).errors.map((e) => e.code);
    expect(codes).toContain('MISSING_NORMALS');
  });

  it('requires TEXCOORD_1 on static lightmapped assets and forbids baking dynamic ones', () => {
    expect(validateDocument(makeDoc(), { id: 'bld', category: 'structure', kind: 'static', lightmapped: true }).errors.map((e) => e.code)).toContain('MISSING_UV2');
    expect(validateDocument(makeDoc({ uv2: true }), { id: 'bld', category: 'structure', kind: 'static', lightmapped: true }).ok).toBe(true);
    expect(validateDocument(makeDoc({ uv2: true }), { id: 'veh', category: 'vehicle_car', kind: 'dynamic', lightmapped: true }).errors.map((e) => e.code)).toContain('BAKE_POLICY_VIOLATION');
  });

  it('reports missing required animation clips', () => {
    const codes = validateDocument(makeDoc(), { id: 'ped', category: 'npc', kind: 'dynamic', requiredAnimations: ['anim_Walk'] }).errors.map((e) => e.code);
    expect(codes).toContain('MISSING_ANIMATION');
  });

  it('flags primitives without a material', () => {
    const doc = makeDoc();
    doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!.setMaterial(null);
    expect(validateDocument(doc, { id: 'veh', category: 'vehicle_car', kind: 'dynamic' }).errors.map((e) => e.code)).toContain('MISSING_MATERIAL');
  });

  it('warns when a normal-mapped material has no tangents', () => {
    const doc = makeDoc();
    const material = doc.getRoot().listMaterials()[0]!;
    material.setNormalTexture(doc.createTexture('n').setMimeType('image/ktx2').setImage(new Uint8Array([1])));
    expect(validateDocument(doc, { id: 'bld', category: 'structure', kind: 'static' }).errors.map((e) => e.code)).toContain('MISSING_TANGENTS');
  });
});

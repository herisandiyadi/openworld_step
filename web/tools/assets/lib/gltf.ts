import { Document, type Material, type Mesh, type Node, type TypedArray } from '@gltf-transform/core';
import type { MeshBuilder } from './builder';
import { PALETTE } from './palette';

export const GENERATOR = 'openworld-city procedural asset pipeline (Mode B)';

export type AccessorKind = 'SCALAR' | 'VEC3' | 'VEC4' | 'MAT4';

export function createAccessor(doc: Document, type: AccessorKind, array: TypedArray) {
  return doc
    .createAccessor()
    .setType(type)
    .setArray(array)
    .setBuffer(doc.getRoot().listBuffers()[0] ?? null);
}

export interface BaseDocument {
  doc: Document;
  /** Vertex-colour PBR metallic-roughness material shared by every part. */
  material: Material;
  /** Optional glowing material (lamp bulbs); pruned when unused. */
  emissive: Material;
}

export function createBaseDocument(): BaseDocument {
  const doc = new Document();
  doc.getRoot().getAsset().generator = GENERATOR;
  doc.createBuffer('buffer');
  const material = doc
    .createMaterial('mat_palette')
    .setBaseColorFactor([1, 1, 1, 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(0.85);
  const emissive = doc
    .createMaterial('mat_emissive')
    .setBaseColorFactor([1, 1, 1, 1])
    .setEmissiveFactor([...PALETTE.lamp])
    .setMetallicFactor(0)
    .setRoughnessFactor(0.6);
  return { doc, material, emissive };
}

export interface MeshPart {
  builder: MeshBuilder;
  material: Material;
}

/** One primitive per part (= one draw call per part). */
export function addMesh(doc: Document, name: string, parts: MeshPart[], skinned = false): Mesh {
  const mesh = doc.createMesh(name);
  for (const { builder, material } of parts) {
    if (builder.triangleCount === 0) continue;
    const indices =
      builder.vertexCount > 65535 ? new Uint32Array(builder.indices) : new Uint16Array(builder.indices);
    const primitive = doc
      .createPrimitive()
      .setAttribute('POSITION', createAccessor(doc, 'VEC3', new Float32Array(builder.positions)))
      .setAttribute('NORMAL', createAccessor(doc, 'VEC3', new Float32Array(builder.normals)))
      .setAttribute('COLOR_0', createAccessor(doc, 'VEC3', new Float32Array(builder.colors)))
      .setIndices(createAccessor(doc, 'SCALAR', indices))
      .setMaterial(material);

    if (skinned) {
      const joints = new Uint8Array(builder.vertexCount * 4);
      const weights = new Float32Array(builder.vertexCount * 4);
      builder.joints.forEach((joint, i) => {
        joints[i * 4] = joint;
        weights[i * 4] = 1;
      });
      primitive
        .setAttribute('JOINTS_0', createAccessor(doc, 'VEC4', joints))
        .setAttribute('WEIGHTS_0', createAccessor(doc, 'VEC4', weights));
    }
    mesh.addPrimitive(primitive);
  }
  return mesh;
}

/** Scene with a single root node carrying `mesh` (props). */
export function singleMeshScene(doc: Document, id: string, mesh: Mesh): Node {
  const node = doc.createNode(id).setMesh(mesh);
  const scene = doc.createScene('scene').addChild(node);
  doc.getRoot().setDefaultScene(scene);
  return node;
}
import { describe, expect, it } from 'vitest';
import { Bone, BufferAttribute, BufferGeometry, MeshStandardMaterial, Object3D, Skeleton, SkinnedMesh } from 'three';
import { applyAppearance } from './HeroAppearance';
import type { Appearance } from '../state/profile';

/** Minimal skinned geometry: 1 triangle with the attributes applyAppearance merges. */
const skinnedGeometry = (): BufferGeometry => {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1]), 3));
  geometry.setAttribute('skinIndex', new BufferAttribute(new Uint16Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 4));
  geometry.setAttribute('skinWeight', new BufferAttribute(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), 4));
  geometry.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2]), 1));
  return geometry;
};

const APPEARANCE: Appearance = {
  gender: 'm',
  skinTone: 0,
  hairStyle: 0,
  hairColor: 0,
  shirtStyle: 0,
  shirtColor: 0,
  pantsStyle: 0,
  pantsColor: 0,
  expression: 0,
  accessory: 0,
};

describe('hero appearance merge with the gold chain', () => {
  it('keeps gold_chain visible and out of the merged body geometry', () => {
    const skeleton = new Skeleton([new Bone()]);
    const root = new Object3D();
    const body = new SkinnedMesh(skinnedGeometry(), new MeshStandardMaterial());
    body.name = 'char_hero_m';
    root.add(body);
    const chain = new SkinnedMesh(skinnedGeometry(), new MeshStandardMaterial());
    chain.name = 'gold_chain';
    root.add(chain);
    body.bind(skeleton);
    chain.bind(skeleton);

    applyAppearance(root, APPEARANCE);

    const merged = root.getObjectByName('hero_merged') as SkinnedMesh | undefined;
    expect(merged).toBeDefined();
    expect(root.getObjectByName('gold_chain')?.visible).toBe(true);

    // Chain is not folded in: merged vertex count equals the body alone (3 verts), not body + chain (6).
    expect(merged?.geometry.getAttribute('position').count).toBe(3);
  });
});

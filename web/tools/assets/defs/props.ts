import { MeshBuilder } from '../lib/builder';
import { addMesh, createBaseDocument, singleMeshScene } from '../lib/gltf';
import { PALETTE } from '../lib/palette';
import { PROP_COLLIDERS, type PropId } from '../../../src/world/propSpec';
import type { AssetDef, Category } from './types';

function streetlamp() {
  const { doc, material, emissive } = createBaseDocument();
  const body = new MeshBuilder();
  body.frustum({ radiusBottom: 0.18, radiusTop: 0.13, height: 0.35, segments: 8 }, { color: PALETTE.metalDark });
  body.frustum({ radiusBottom: 0.07, radiusTop: 0.05, height: 4.1, segments: 6, capBottom: false }, { at: [0, 0.35, 0], color: PALETTE.metalDark });
  body.bar([0, 4.15, 0], [0, 4.3, -0.9], 0.07, { color: PALETTE.metalDark });
  body.box([0.32, 0.12, 0.5], { at: [0, 4.3, -1.05], color: PALETTE.metalDark });
  const bulb = new MeshBuilder();
  bulb.box([0.24, 0.04, 0.4], { at: [0, 4.22, -1.05], color: PALETTE.white });
  singleMeshScene(doc, 'prop_streetlamp_01', addMesh(doc, 'prop_streetlamp_01', [
    { builder: body, material },
    { builder: bulb, material: emissive },
  ]));
  return doc;
}

function bench() {
  const { doc, material } = createBaseDocument();
  const b = new MeshBuilder();
  for (const x of [-0.65, 0.65]) {
    b.box([0.08, 0.45, 0.5], { at: [x, 0.225, 0], color: PALETTE.metalDark });
    b.box([0.08, 0.5, 0.06], { at: [x, 0.7, 0.24], rot: [-0.18, 0, 0], color: PALETTE.metalDark });
  }
  for (let i = 0; i < 3; i++) b.box([1.6, 0.05, 0.14], { at: [0, 0.47, -0.17 + i * 0.16], color: PALETTE.wood });
  for (let i = 0; i < 2; i++) b.box([1.6, 0.12, 0.04], { at: [0, 0.66 + i * 0.17, 0.26 + i * 0.03], rot: [-0.18, 0, 0], color: PALETTE.woodDark });
  singleMeshScene(doc, 'prop_bench_01', addMesh(doc, 'prop_bench_01', [{ builder: b, material }]));
  return doc;
}

function tree() {
  const { doc, material } = createBaseDocument();
  const b = new MeshBuilder();
  b.frustum({ radiusBottom: 0.2, radiusTop: 0.12, height: 2.2, segments: 6, capBottom: false }, { color: PALETTE.trunk });
  b.bar([0, 1.6, 0], [0.5, 2.3, 0.1], 0.1, { color: PALETTE.trunk });
  b.blob({ radius: 1.15, stretch: [1, 0.85, 1], subdivide: true, jitter: 0.12, seed: 11 }, { at: [0, 3.0, 0], color: PALETTE.leaf });
  b.blob({ radius: 0.8, subdivide: true, jitter: 0.15, seed: 23 }, { at: [0.7, 2.6, 0.3], color: PALETTE.leafDark });
  b.blob({ radius: 0.75, subdivide: true, jitter: 0.15, seed: 37 }, { at: [-0.5, 3.6, -0.35], color: PALETTE.leafLight });
  singleMeshScene(doc, 'prop_tree_01', addMesh(doc, 'prop_tree_01', [{ builder: b, material }]));
  return doc;
}

function trashbin() {
  const { doc, material } = createBaseDocument();
  const b = new MeshBuilder();
  b.frustum({ radiusBottom: 0.22, radiusTop: 0.26, height: 0.8, segments: 10 }, { color: PALETTE.binGreen });
  b.frustum({ radiusBottom: 0.27, radiusTop: 0.24, height: 0.08, segments: 10 }, { at: [0, 0.8, 0], color: PALETTE.binDark });
  b.frustum({ radiusBottom: 0.27, radiusTop: 0.27, height: 0.08, segments: 10, capTop: false, capBottom: false }, { at: [0, 0.35, 0], color: PALETTE.binDark });
  singleMeshScene(doc, 'prop_trashbin_01', addMesh(doc, 'prop_trashbin_01', [{ builder: b, material }]));
  return doc;
}

function busstop() {
  const { doc, material } = createBaseDocument();
  const b = new MeshBuilder();
  for (const x of [-1.4, 1.4]) {
    b.box([0.08, 2.5, 0.08], { at: [x, 1.25, 0.55], color: PALETTE.metalDark });
    b.box([0.08, 2.5, 0.08], { at: [x, 1.25, -0.45], color: PALETTE.metalDark });
    b.box([0.04, 1.8, 0.9], { at: [x, 1.2, 0.05], color: PALETTE.glass });
  }
  b.box([3.0, 0.1, 1.4], { at: [0, 2.55, 0.05], rot: [0.05, 0, 0], color: PALETTE.roof });
  b.box([2.72, 1.8, 0.04], { at: [0, 1.2, 0.55], color: PALETTE.glass });
  b.box([2.72, 0.08, 0.06], { at: [0, 2.1, 0.55], color: PALETTE.metalDark });
  b.box([2.0, 0.06, 0.4], { at: [0, 0.48, 0.3], color: PALETTE.wood });
  for (const x of [-0.8, 0.8]) b.box([0.06, 0.45, 0.3], { at: [x, 0.225, 0.3], color: PALETTE.metalDark });
  b.box([0.07, 2.9, 0.07], { at: [1.7, 1.45, -0.5], color: PALETTE.metalDark });
  b.box([0.5, 0.5, 0.05], { at: [1.7, 2.75, -0.5], color: PALETTE.signBlue });
  b.box([0.3, 0.12, 0.06], { at: [1.7, 2.75, -0.5], color: PALETTE.white });
  singleMeshScene(doc, 'prop_busstop_01', addMesh(doc, 'prop_busstop_01', [{ builder: b, material }]));
  return doc;
}

const prop = (id: PropId, category: Category, tags: string[], build: AssetDef['build']): AssetDef => ({
  id,
  category,
  tags: ['prop', 'city', ...tags],
  collider: PROP_COLLIDERS[id],
  build,
});

export const propAssets: AssetDef[] = [
  prop('prop_streetlamp_01', 'prop_small', ['street', 'downtown', 'residential'], streetlamp),
  prop('prop_bench_01', 'prop_small', ['street', 'park'], bench),
  prop('prop_tree_01', 'tree', ['park', 'residential'], tree),
  prop('prop_trashbin_01', 'prop_small', ['street'], trashbin),
  prop('prop_busstop_01', 'structure', ['street', 'transit'], busstop),
];
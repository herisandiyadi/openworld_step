import { MeshBuilder } from '../lib/builder';
import { addMesh, createBaseDocument } from '../lib/gltf';
import { PALETTE } from '../lib/palette';
import type { AssetDef } from './types';

/**
 * Prop jalan baru (NEXT_FEATURES 4). Collider ditulis di sini, bukan di src/world/propSpec.ts,
 * karena penempatan di generator dunia dikerjakan task lain; manifest sudah membawa collider.
 */

/**
 * Lampu lalu lintas: tiap muka lampu adalah node mesh sendiri (`lamp_red`, `lamp_yellow`,
 * `lamp_green`) memakai material emissive, jadi shader runtime cukup menyetel emissive per node
 * untuk siklus 12 detik + kuning 2 detik tanpa menyentuh geometri.
 */
function trafficlight() {
  const { doc, material, emissive } = createBaseDocument();
  const pole = new MeshBuilder();
  pole.frustum({ radiusBottom: 0.16, radiusTop: 0.12, height: 0.18, segments: 8 }, { color: PALETTE.concrete });
  pole.frustum({ radiusBottom: 0.07, radiusTop: 0.055, height: 3.0, segments: 6, capBottom: false }, { at: [0, 0.18, 0], color: PALETTE.metalDark });
  // Rumah lampu: tiga lensa bertumpuk menghadap -Z (arah datangnya kendaraan).
  pole.box([0.3, 0.92, 0.26], { at: [0, 2.62, 0], color: PALETTE.metalDark });
  pole.box([0.34, 0.06, 0.1], { at: [0, 3.08, -0.1], color: PALETTE.metalDark });
  for (let i = 0; i < 3; i++) pole.box([0.34, 0.04, 0.12], { at: [0, 2.3 + i * 0.28, -0.14], color: PALETTE.metalDark });

  const lens = (y: number, color: typeof PALETTE.lightRed) => {
    const b = new MeshBuilder();
    b.frustum({ radiusBottom: 0.09, radiusTop: 0.09, height: 0.05, segments: 8 }, { at: [0, y, -0.13], rot: [-Math.PI / 2, 0, 0], color });
    return b;
  };
  const root = doc.createNode('prop_trafficlight_01').setMesh(addMesh(doc, 'prop_trafficlight_01', [{ builder: pole, material }]));
  for (const [name, y, color] of [
    ['lamp_red', 2.9, PALETTE.lightRed],
    ['lamp_yellow', 2.62, PALETTE.lightYellow],
    ['lamp_green', 2.34, PALETTE.lightGreen],
  ] as const) {
    root.addChild(doc.createNode(name).setMesh(addMesh(doc, name, [{ builder: lens(y, color), material: emissive }])));
  }
  doc.getRoot().setDefaultScene(doc.createScene('scene').addChild(root));
  return doc;
}

/** Bangku pinggir jalan dengan sandaran; lebih ramping dari prop_bench_01 supaya trotoar tetap lega. */
function bench02() {
  const { doc, material } = createBaseDocument();
  const b = new MeshBuilder();
  for (const x of [-0.52, 0.52]) {
    b.box([0.07, 0.44, 0.44], { at: [x, 0.22, 0.02], color: PALETTE.concrete });
    b.box([0.06, 0.46, 0.05], { at: [x, 0.66, 0.2], rot: [-0.2, 0, 0], color: PALETTE.metalDark });
  }
  for (let i = 0; i < 3; i++) b.box([1.3, 0.05, 0.15], { at: [0, 0.455, -0.16 + i * 0.17], color: PALETTE.wood });
  for (let i = 0; i < 2; i++) b.box([1.3, 0.14, 0.04], { at: [0, 0.66 + i * 0.19, 0.22 + i * 0.04], rot: [-0.2, 0, 0], color: PALETTE.woodDark });
  doc.getRoot().setDefaultScene(doc.createScene('scene').addChild(doc.createNode('prop_bench_02').setMesh(addMesh(doc, 'prop_bench_02', [{ builder: b, material }]))));
  return doc;
}

export const streetPropAssets: AssetDef[] = [
  {
    id: 'prop_trafficlight_01',
    category: 'prop_lit',
    tags: ['prop', 'city', 'street', 'downtown', 'traffic'],
    collider: { type: 'box', center: [0, 1.6, 0], size: [0.34, 3.2, 0.34] },
    requiredNodes: ['lamp_red', 'lamp_yellow', 'lamp_green'],
    meta: { lampNodes: ['lamp_red', 'lamp_yellow', 'lamp_green'], cycleSeconds: 12, yellowSeconds: 2 },
    build: trafficlight,
  },
  {
    id: 'prop_bench_02',
    category: 'prop_small',
    tags: ['prop', 'city', 'street', 'seating'],
    collider: { type: 'box', center: [0, 0.45, 0], size: [1.3, 0.9, 0.55] },
    // Titik duduk relatif pivot (C9): 2 per bangku, tinggi dudukan 0.45 m.
    meta: { seatPoints: [[-0.32, 0.45, 0.0], [0.32, 0.45, 0.0]], seatFacing: [0, 0, -1] },
    build: bench02,
  },
];

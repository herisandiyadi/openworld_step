import { MeshBuilder } from '../lib/builder';
import { addMesh, createBaseDocument } from '../lib/gltf';
import { type Vec3 } from '../lib/math';
import { PALETTE } from '../lib/palette';
import { BIKE, SKATE } from '../../../src/game/vehicleSpec';
import type { AssetDef } from './types';

const HALF_PI = Math.PI / 2;

/** Wheel centred on the origin, axle along X. */
function buildBikeWheel(): MeshBuilder {
  const b = new MeshBuilder();
  const tyre = BIKE.wheelRadius - 0.03;
  b.torus({ radius: tyre, tube: 0.03, radialSegments: 14, tubularSegments: 4 }, { color: PALETTE.rubber });
  b.frustum({ radiusBottom: 0.035, radiusTop: 0.035, height: 0.09, segments: 6 }, { at: [0.045, 0, 0], rot: [0, 0, HALF_PI], color: PALETTE.metalLight });
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI;
    const dir: Vec3 = [0, Math.cos(angle) * (tyre - 0.02), Math.sin(angle) * (tyre - 0.02)];
    b.bar([0, -dir[1], -dir[2]], dir, 0.012, { color: PALETTE.metalLight });
  }
  return b;
}

function buildBicycle() {
  const { doc, material } = createBaseDocument();
  const frame = new MeshBuilder();
  const tube = 0.04;
  const color = PALETTE.frame;
  const rearHub: Vec3 = [0, BIKE.hubY, BIKE.rearHubZ];
  const frontHub: Vec3 = [0, BIKE.hubY, BIKE.frontHubZ];
  const bottomBracket: Vec3 = [0, BIKE.crankY, BIKE.crankZ];
  const seatTop: Vec3 = [0, BIKE.saddleTopY - 0.12, BIKE.saddleZ - 0.04];
  const headTop: Vec3 = [0, 0.86, BIKE.frontHubZ + 0.12];
  const headBottom: Vec3 = [0, 0.62, BIKE.frontHubZ + 0.07];

  frame.bar(bottomBracket, seatTop, tube, { color });
  frame.bar(seatTop, headTop, tube, { color });
  frame.bar(bottomBracket, headBottom, tube * 1.1, { color });
  for (const x of [-0.05, 0.05]) {
    frame.bar([x, rearHub[1], rearHub[2]], [x * 0.4, bottomBracket[1], bottomBracket[2]], 0.025, { color });
    frame.bar([x, rearHub[1], rearHub[2]], [x * 0.4, seatTop[1], seatTop[2]], 0.025, { color });
    frame.bar([x, frontHub[1], frontHub[2]], [x * 0.4, headBottom[1], headBottom[2]], 0.025, { color: PALETTE.metalDark });
  }
  frame.bar(headBottom, headTop, tube * 1.2, { color: PALETTE.metalDark });
  frame.bar(seatTop, [0, BIKE.saddleTopY - 0.03, BIKE.saddleZ], 0.03, { color: PALETTE.metalDark });
  frame.box([0.14, 0.05, 0.26], { at: [0, BIKE.saddleTopY - 0.025, BIKE.saddleZ], color: PALETTE.sole });
  frame.bar(headTop, [0, BIKE.gripY - 0.02, BIKE.gripZ + 0.04], 0.03, { color: PALETTE.metalDark });
  frame.bar([-BIKE.gripX - 0.04, BIKE.gripY - 0.02, BIKE.gripZ], [BIKE.gripX + 0.04, BIKE.gripY - 0.02, BIKE.gripZ], 0.03, { color: PALETTE.metalDark });
  for (const x of [-BIKE.gripX, BIKE.gripX]) frame.box([0.09, 0.04, 0.04], { at: [x, BIKE.gripY - 0.02, BIKE.gripZ], color: PALETTE.sole });
  frame.box([0.03, 0.03, 0.4], { at: [0.07, BIKE.hubY + BIKE.wheelRadius + 0.03, BIKE.rearHubZ], color });

  const crank = new MeshBuilder();
  const arm = BIKE.crankLength;
  crank.frustum({ radiusBottom: 0.07, radiusTop: 0.07, height: 0.02, segments: 8 }, { at: [0.06, 0, 0], rot: [0, 0, HALF_PI], color: PALETTE.metalLight });
  crank.box([0.15, 0.03, 0.03], { color: PALETTE.metalLight });
  crank.box([0.02, 0.03, arm], { at: [0.075, 0, -arm / 2], color: PALETTE.metalLight });
  crank.box([0.02, 0.03, arm], { at: [-0.075, 0, arm / 2], color: PALETTE.metalLight });
  crank.box([0.1, 0.02, 0.06], { at: [0.13, 0, -arm], color: PALETTE.sole });
  crank.box([0.1, 0.02, 0.06], { at: [-0.13, 0, arm], color: PALETTE.sole });

  const wheel = buildBikeWheel();
  const wheelMesh = addMesh(doc, 'veh_bicycle_wheel', [{ builder: wheel, material }]);
  // Rotating parts get a mesh-less pivot node: quantisation may rewrite mesh-node transforms, never the pivot.
  const pivot = (name: string, at: Vec3, mesh: ReturnType<typeof addMesh>) =>
    doc.createNode(name).setTranslation(at).addChild(doc.createNode(`${name}_mesh`).setMesh(mesh));
  const root = doc.createNode('veh_bicycle').setMesh(addMesh(doc, 'veh_bicycle_frame', [{ builder: frame, material }]));
  root.addChild(pivot('wheel_front', frontHub, wheelMesh));
  root.addChild(pivot('wheel_rear', rearHub, wheelMesh));
  root.addChild(pivot('crank', bottomBracket, addMesh(doc, 'veh_bicycle_crank', [{ builder: crank, material }])));
  doc.getRoot().setDefaultScene(doc.createScene('scene').addChild(root));
  return doc;
}

function buildSkateboard() {
  const { doc, material } = createBaseDocument();
  const b = new MeshBuilder();
  const deckThickness = 0.025;
  const deckY = SKATE.deckTopY - deckThickness / 2;
  b.box([0.22, deckThickness, 0.62], { at: [0, deckY, 0], color: PALETTE.deck });
  b.box([0.222, 0.004, 0.6], { at: [0, SKATE.deckTopY + 0.002, 0], color: PALETTE.grip });
  for (const sign of [-1, 1]) {
    b.box([0.22, deckThickness, 0.14], { at: [0, deckY + 0.02, sign * 0.37], rot: [sign * 0.28, 0, 0], color: PALETTE.deck });
    b.box([0.16, 0.03, 0.06], { at: [0, 0.075, sign * 0.22], color: PALETTE.metalLight });
    b.box([0.2, 0.02, 0.025], { at: [0, 0.05, sign * 0.22], color: PALETTE.metalDark });
    for (const x of [-0.11, 0.11]) {
      b.frustum(
        { radiusBottom: 0.03, radiusTop: 0.03, height: 0.035, segments: 8 },
        { at: [x > 0 ? x + 0.015 : x + 0.02, 0.03, sign * 0.22], rot: [0, 0, HALF_PI], color: PALETTE.white },
      );
    }
  }
  doc.getRoot().setDefaultScene(doc.createScene('scene').addChild(doc.createNode('veh_skateboard').setMesh(addMesh(doc, 'veh_skateboard', [{ builder: b, material }]))));
  return doc;
}

export const vehicleAssets: AssetDef[] = [
  {
    id: 'veh_bicycle',
    category: 'vehicle_bike',
    tags: ['vehicle', 'player', 'city'],
    collider: { type: 'box', center: [0, 0.5, 0], size: [0.6, 1, 1.75] },
    requiredNodes: ['wheel_front', 'wheel_rear', 'crank'],
    meta: { ...BIKE },
    build: buildBicycle,
  },
  {
    id: 'veh_skateboard',
    category: 'vehicle_small',
    tags: ['vehicle', 'player', 'city'],
    collider: { type: 'box', center: [0, 0.07, 0], size: [0.24, 0.14, 0.8] },
    meta: { ...SKATE },
    build: buildSkateboard,
  },
];
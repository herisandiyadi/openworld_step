import { MeshBuilder } from '../lib/builder';
import { addMesh, createBaseDocument } from '../lib/gltf';
import { type Vec3 } from '../lib/math';
import { PALETTE } from '../lib/palette';
import type { AssetDef } from './types';

const HALF_PI = Math.PI / 2;

/**
 * Kendaraan lalu lintas (NEXT_FEATURES 3.1 dan 4). Bodi memakai vertex colour netral (PALETTE.paint)
 * supaya runtime bisa mengalikan warna per instance; roda dan pintu jadi node terpisah agar bisa
 * diputar/dibuka tanpa mengubah mesh. Konvensi arah sama dengan pemain: forward = -Z.
 */

/** Roda silinder dengan sumbu X, berpusat di origin node (pivot putar). */
function wheel(radius: number, width: number): MeshBuilder {
  const b = new MeshBuilder();
  b.frustum({ radiusBottom: radius, radiusTop: radius, height: width, segments: 10 }, { at: [width / 2, 0, 0], rot: [0, 0, HALF_PI], color: PALETTE.rubber });
  b.frustum({ radiusBottom: radius * 0.45, radiusTop: radius * 0.45, height: width * 1.05, segments: 6 }, { at: [width * 0.52, 0, 0], rot: [0, 0, HALF_PI], color: PALETTE.metalLight });
  return b;
}

interface CarShape {
  /** Profil samping bodi bawah sebagai (z, y) siklis dan cembung. */
  body: [number, number][];
  cabin: [number, number][];
  width: number;
  cabinWidth: number;
  wheelX: number;
  wheelZ: [number, number];
  wheelRadius: number;
}

const SEDAN: CarShape = {
  body: [[-2.0, 0.3], [-1.86, 0.74], [1.86, 0.8], [2.0, 0.34]],
  cabin: [[-0.92, 0.74], [-0.5, 1.3], [0.84, 1.34], [1.26, 0.79]],
  width: 1.8,
  cabinWidth: 1.62,
  wheelX: 0.85,
  wheelZ: [-1.3, 1.3],
  wheelRadius: 0.34,
};

const HATCH: CarShape = {
  body: [[-1.78, 0.3], [-1.64, 0.74], [1.6, 0.82], [1.72, 0.4]],
  cabin: [[-0.84, 0.74], [-0.44, 1.32], [1.12, 1.36], [1.45, 0.82]],
  width: 1.74,
  cabinWidth: 1.58,
  wheelX: 0.82,
  wheelZ: [-1.18, 1.16],
  wheelRadius: 0.32,
};

/** Node pivot tanpa mesh: kuantisasi meshopt boleh menulis ulang transform node mesh, pivot tidak. */
function pivot(doc: ReturnType<typeof createBaseDocument>['doc'], name: string, at: Vec3, mesh: ReturnType<typeof addMesh>) {
  return doc.createNode(name).setTranslation(at).addChild(doc.createNode(`${name}_mesh`).setMesh(mesh));
}

function buildCar(id: string, shape: CarShape) {
  const { doc, material, emissive } = createBaseDocument();
  const body = new MeshBuilder();
  const lights = new MeshBuilder();
  const frontZ = shape.body[0]?.[0] ?? -2;
  const rearZ = shape.body[shape.body.length - 1]?.[0] ?? 2;

  body.prism(shape.body, shape.width, { color: PALETTE.paint });
  body.prism(shape.cabin, shape.cabinWidth, { color: PALETTE.glass });
  // Bumper, gril, dan kaca spion: kotak murah supaya siluet tidak terlalu kosong.
  body.box([shape.width * 0.96, 0.16, 0.12], { at: [0, 0.38, frontZ - 0.02], color: PALETTE.metalDark });
  body.box([shape.width * 0.96, 0.16, 0.12], { at: [0, 0.4, rearZ + 0.02], color: PALETTE.metalDark });
  for (const sign of [-1, 1]) body.box([0.1, 0.07, 0.16], { at: [sign * (shape.width / 2 + 0.04), 1.0, -0.6], color: PALETTE.metalDark });
  body.box([shape.width * 0.9, 0.04, 2.4], { at: [0, 0.82, 0.1], color: PALETTE.paint });

  for (const sign of [-1, 1]) {
    lights.box([0.34, 0.14, 0.06], { at: [sign * 0.58, 0.62, frontZ - 0.03], color: PALETTE.white });
    lights.box([0.3, 0.12, 0.06], { at: [sign * 0.58, 0.66, rearZ + 0.03], color: PALETTE.lightRed });
  }

  const wheelMesh = addMesh(doc, `${id}_wheel`, [{ builder: wheel(shape.wheelRadius, 0.22), material }]);
  const root = doc.createNode(id).setMesh(addMesh(doc, `${id}_body`, [{ builder: body, material }]));
  root.addChild(doc.createNode('lights').setMesh(addMesh(doc, `${id}_lights`, [{ builder: lights, material: emissive }])));
  const [front, rear] = shape.wheelZ;
  root.addChild(pivot(doc, 'wheel_fl', [-shape.wheelX, shape.wheelRadius, front ?? -1.3], wheelMesh));
  root.addChild(pivot(doc, 'wheel_fr', [shape.wheelX, shape.wheelRadius, front ?? -1.3], wheelMesh));
  root.addChild(pivot(doc, 'wheel_rl', [-shape.wheelX, shape.wheelRadius, rear ?? 1.3], wheelMesh));
  root.addChild(pivot(doc, 'wheel_rr', [shape.wheelX, shape.wheelRadius, rear ?? 1.3], wheelMesh));
  doc.getRoot().setDefaultScene(doc.createScene('scene').addChild(root));
  return doc;
}

/** Motor: jok dan stang sejajar sepeda (vehicleSpec BIKE) supaya pose berkendara hero tetap pas. */
function buildMoto() {
  const { doc, material, emissive } = createBaseDocument();
  const b = new MeshBuilder();
  const lights = new MeshBuilder();
  const radius = 0.32;

  b.box([0.2, 0.3, 1.1], { at: [0, 0.55, 0], color: PALETTE.metalLight });
  b.box([0.34, 0.22, 0.5], { at: [0, 0.82, -0.2], color: PALETTE.paint });
  b.box([0.3, 0.1, 0.6], { at: [0, 0.86, 0.25], color: PALETTE.seat });
  b.box([0.3, 0.26, 0.3], { at: [0, 0.6, 0.2], color: PALETTE.paint });
  b.box([0.06, 0.6, 0.06], { at: [0, 0.68, -0.5], rot: [-0.35, 0, 0], color: PALETTE.metalDark });
  b.box([0.62, 0.05, 0.05], { at: [0, 1.02, -0.32], color: PALETTE.metalDark });
  for (const x of [-0.27, 0.27]) b.box([0.09, 0.05, 0.05], { at: [x, 1.02, -0.3], color: PALETTE.grip });
  b.box([0.14, 0.14, 0.4], { at: [0, 0.45, -0.1], color: PALETTE.metalDark });
  b.box([0.08, 0.1, 0.5], { at: [0.16, 0.5, 0.35], color: PALETTE.metalLight });
  lights.box([0.16, 0.12, 0.06], { at: [0, 0.9, -0.62], color: PALETTE.white });
  lights.box([0.12, 0.08, 0.05], { at: [0, 0.78, 0.56], color: PALETTE.lightRed });

  const wheelMesh = addMesh(doc, 'veh_moto_wheel', [{ builder: wheel(radius, 0.12), material }]);
  const root = doc.createNode('veh_moto').setMesh(addMesh(doc, 'veh_moto_body', [{ builder: b, material }]));
  root.addChild(doc.createNode('lights').setMesh(addMesh(doc, 'veh_moto_lights', [{ builder: lights, material: emissive }])));
  root.addChild(pivot(doc, 'wheel_front', [0, radius, -0.65], wheelMesh));
  root.addChild(pivot(doc, 'wheel_rear', [0, radius, 0.65], wheelMesh));
  doc.getRoot().setDefaultScene(doc.createScene('scene').addChild(root));
  return doc;
}

/** Bus kota: pintu depan dan tengah jadi node terpisah (berhenti 4 detik di halte, NEXT_FEATURES 3.1). */
function buildBus() {
  const { doc, material, emissive } = createBaseDocument();
  const b = new MeshBuilder();
  const lights = new MeshBuilder();
  const radius = 0.5;
  const width = 2.5;
  const hw = width / 2;

  b.prism([[-5.1, 0.45], [-4.9, 3.05], [4.9, 3.05], [5.1, 0.5]], width, { color: PALETTE.paint });
  b.box([width * 0.98, 0.12, 9.6], { at: [0, 3.08, 0], color: PALETTE.roof });
  // Jendela: satu strip per sisi, plus kaca depan dan belakang.
  for (const sign of [-1, 1]) b.box([0.06, 0.95, 8.2], { at: [sign * (hw - 0.01), 2.3, 0.2], color: PALETTE.glass });
  b.box([width * 0.88, 1.2, 0.06], { at: [0, 2.3, -5.0], color: PALETTE.glass });
  b.box([width * 0.88, 0.9, 0.06], { at: [0, 2.3, 5.0], color: PALETTE.glass });
  b.box([width * 0.96, 0.2, 0.14], { at: [0, 0.6, -5.12], color: PALETTE.metalDark });
  b.box([width * 0.96, 0.2, 0.14], { at: [0, 0.6, 5.12], color: PALETTE.metalDark });
  b.box([width * 0.9, 0.1, 9.0], { at: [0, 0.46, 0], color: PALETTE.metalDark });
  lights.box([0.3, 0.14, 0.06], { at: [-0.85, 0.85, -5.13], color: PALETTE.white });
  lights.box([0.3, 0.14, 0.06], { at: [0.85, 0.85, -5.13], color: PALETTE.white });
  lights.box([0.26, 0.12, 0.06], { at: [0, 0.85, 5.13], color: PALETTE.lightRed });

  // Pintu berputar pada tepi depannya: geometri mulai di x lokal 0 supaya pivot ada di hinge.
  const door = () => {
    const d = new MeshBuilder();
    d.box([1.1, 1.9, 0.08], { at: [0.55, 0.95, 0], color: PALETTE.glass });
    d.box([1.1, 0.1, 0.1], { at: [0.55, 1.9, 0], color: PALETTE.metalDark });
    return d;
  };
  const doorMesh = addMesh(doc, 'veh_bus_door', [{ builder: door(), material }]);
  const wheelMesh = addMesh(doc, 'veh_bus_wheel', [{ builder: wheel(radius, 0.3), material }]);
  const root = doc.createNode('veh_bus').setMesh(addMesh(doc, 'veh_bus_body', [{ builder: b, material }]));
  root.addChild(doc.createNode('lights').setMesh(addMesh(doc, 'veh_bus_lights', [{ builder: lights, material: emissive }])));
  root.addChild(pivot(doc, 'door_front', [-hw + 0.02, 0.55, -3.2], doorMesh));
  root.addChild(pivot(doc, 'door_rear', [-hw + 0.02, 0.55, 1.4], doorMesh));
  for (const [name, x, z] of [['wheel_fl', -hw + 0.1, -3.6], ['wheel_fr', hw - 0.1, -3.6], ['wheel_rl', -hw + 0.1, 3.4], ['wheel_rr', hw - 0.1, 3.4]] as const) {
    root.addChild(pivot(doc, name, [x, radius, z], wheelMesh));
  }
  doc.getRoot().setDefaultScene(doc.createScene('scene').addChild(root));
  return doc;
}

const CAR_WHEEL_NODES = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'];

export const trafficVehicleAssets: AssetDef[] = [
  {
    id: 'veh_car_sedan',
    category: 'vehicle_car',
    tags: ['vehicle', 'traffic', 'ambient', 'player', 'city'],
    collider: { type: 'box', center: [0, 0.75, 0], size: [1.8, 1.5, 4.0] },
    requiredNodes: [...CAR_WHEEL_NODES, 'lights'],
    meta: { wheelRadius: SEDAN.wheelRadius, wheelNodes: CAR_WHEEL_NODES, paintSlot: 'vertex-colour', drive: 'car' },
    build: () => buildCar('veh_car_sedan', SEDAN),
  },
  {
    id: 'veh_car_hatch',
    category: 'vehicle_car',
    tags: ['vehicle', 'traffic', 'ambient', 'city'],
    collider: { type: 'box', center: [0, 0.73, 0], size: [1.74, 1.46, 3.5] },
    requiredNodes: [...CAR_WHEEL_NODES, 'lights'],
    meta: { wheelRadius: HATCH.wheelRadius, wheelNodes: CAR_WHEEL_NODES, paintSlot: 'vertex-colour', drive: 'car' },
    build: () => buildCar('veh_car_hatch', HATCH),
  },
  {
    id: 'veh_moto',
    category: 'vehicle_bike',
    tags: ['vehicle', 'traffic', 'ambient', 'player', 'city'],
    collider: { type: 'box', center: [0, 0.55, 0], size: [0.7, 1.1, 1.9] },
    requiredNodes: ['wheel_front', 'wheel_rear', 'lights'],
    meta: { wheelRadius: 0.32, wheelNodes: ['wheel_front', 'wheel_rear'], drive: 'moto' },
    build: buildMoto,
  },
  {
    id: 'veh_bus',
    category: 'vehicle_bus',
    tags: ['vehicle', 'traffic', 'ambient', 'transit'],
    collider: { type: 'box', center: [0, 1.6, 0], size: [2.5, 3.2, 10.2] },
    requiredNodes: [...CAR_WHEEL_NODES, 'door_front', 'door_rear', 'lights'],
    meta: { wheelRadius: 0.5, wheelNodes: CAR_WHEEL_NODES, doorNodes: ['door_front', 'door_rear'], doorOpenYawDeg: 95 },
    build: buildBus,
  },
];

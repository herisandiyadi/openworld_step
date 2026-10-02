import { use, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { Color, InstancedMesh, type Material, Matrix4, type Mesh, MeshBasicMaterial, Object3D, type PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { type AssetId, assetUrl } from '../app/assets';
import { audio } from '../audio/audioEngine';
import { pushOutOfBoxes } from '../game/movement';
import { dayClock, MODE_RADIUS, playerState } from '../game/runtime';
import { useGameStore } from '../state/gameStore';
import type { BusStop } from '../world/worldSpec';
import { groundHeightAt, worldUrl } from '../world/worldState';
import { busPose, createBus, planBusRoute, stepBus } from './busRoute';
import { isNight } from './density';
import { buildLaneGraph, type LaneGraph, type LanesData } from './laneGraph';
import { updateSpawns, VEHICLE_POOL } from './spawner';
import { useGraphicsSettings } from '../state/graphicsSettings';
import { LAMP_NODES, type LampState, lampAt, signalBlocks, signalisedIntersections } from './trafficLights';
import { createTraffic, FAR_DISTANCE, playerGap, stepTrafficTiered, TICK_HZ_NEAR, type Vehicle, VEHICLE_LENGTH, vehiclePose } from './trafficSim';

/** Jenis kendaraan ambient; indeks 3 (bus) punya rute sendiri, lihat busRoute.ts. */
const VEHICLE_IDS = ['veh_car_sedan', 'veh_car_hatch', 'veh_moto', 'veh_bus'] as const satisfies readonly AssetId[];
const TRAFFIC_TYPES = 3;
const BUS = 3;
const TICK = 1 / TICK_HZ_NEAR;
/** Lampu lalu lintas hanya digambar untuk persimpangan sedekat ini. */
const LIGHT_DISTANCE = 70;
const MAX_LIGHTS = 12;
/** Tiang di sudut persimpangan (m dari titik tengah). */
const POLE_CORNER = 5.5;
const HONK_AFTER = 2;
const HONK_COOLDOWN = 4;
const LAMP_OFF = new Color('#2a2420');
const LAMP_ON: Record<LampState, Color> = { red: new Color('#ff3b2f'), yellow: new Color('#ffd23f'), green: new Color('#4cd964') };

let lanesPromise: Promise<LaneGraph> | null = null;
/** lanes.json dimuat sekali; promise-nya stabil supaya bisa dipakai React use(). */
function loadLaneGraph(): Promise<LaneGraph> {
  lanesPromise ??= fetch(worldUrl('lanes.json'))
    .then((response) => {
      if (!response.ok) throw new Error(`lanes.json: HTTP ${response.status}`);
      return response.json() as Promise<LanesData>;
    })
    .then(buildLaneGraph);
  return lanesPromise;
}

/** Satu geometri GLB, digambar sekali per salinan (mis. 4 roda) per kendaraan. */
interface Part {
  mesh: InstancedMesh;
  geometry: Mesh['geometry'];
  material: Material;
  /** Per salinan: matriks node relatif pivot, lalu matriks lokal mesh (putaran roda disisipkan di antaranya). */
  copies: { node: Matrix4; local: Matrix4 }[];
  wheel: boolean;
  lights: boolean;
}

const UP = new Vector3(0, 1, 0);
const SCRATCH = new Matrix4();
const SPIN = new Matrix4();
const BASE = new Matrix4();
const QUAT = new Quaternion();
const POS = new Vector3();
const ONE = new Vector3(1, 1, 1);
const VIEW_DIR = new Vector3();

/**
 * Bongkar GLB jadi bagian instanced: satu InstancedMesh per geometri unik, jadi semua roda
 * (atau kedua pintu bus) berbagi satu draw call.
 */
function buildBatch(root: Object3D, slots: number): { parts: Part[]; wheelRadius: number } {
  root.updateMatrixWorld(true);
  const byGeometry = new Map<string, Part>();
  let wheelRadius = 0.34;
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    const parent = mesh.parent ?? root;
    // Roda berputar, jadi matriksnya dipecah: node roda (pivot) x putaran x matriks lokal mesh.
    const wheel = parent.name.startsWith('wheel');
    const node = wheel ? parent.matrixWorld.clone() : mesh.matrixWorld.clone();
    const local = wheel ? mesh.matrix.clone() : new Matrix4();
    if (wheel) wheelRadius = parent.position.y || wheelRadius;
    let part = byGeometry.get(mesh.geometry.uuid);
    if (!part) {
      part = { mesh: null as unknown as InstancedMesh, geometry: mesh.geometry, material: mesh.material as Material, copies: [], wheel, lights: mesh.name.includes('lights') };
      byGeometry.set(mesh.geometry.uuid, part);
    }
    part.copies.push({ node, local });
  });
  const parts = [...byGeometry.values()].map((part) => {
    // Kapasitas tetap (pool terbesar x salinan): tidak ada alokasi saat main.
    const mesh = new InstancedMesh(part.geometry, part.material, slots * part.copies.length);
    // ponytail: kendaraan tersebar di radius 130 m, jadi culling per batch dimatikan; blob shadow belum ada.
    mesh.frustumCulled = false;
    mesh.count = 0;
    return { ...part, mesh };
  });
  return { parts, wheelRadius };
}

/** Tambah satu kendaraan ke batch-nya; `spin` = sudut putar roda (rad). */
function addVehicle(parts: Part[], x: number, y: number, z: number, dirX: number, dirZ: number, spin: number): void {
  // Model menghadap -Z, sama dengan konvensi heading pemain.
  BASE.compose(POS.set(x, y, z), QUAT.setFromAxisAngle(UP, Math.atan2(-dirX, -dirZ)), ONE);
  SPIN.makeRotationX(spin);
  for (const part of parts) {
    for (const copy of part.copies) {
      SCRATCH.multiplyMatrices(BASE, copy.node);
      if (part.wheel) SCRATCH.multiply(SPIN);
      part.mesh.setMatrixAt(part.mesh.count++, SCRATCH.multiply(copy.local));
    }
    part.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Data render per kendaraan ambient: jenis model, jarak tempuh (putaran roda), dan klakson. */
interface Extra {
  type: number;
  distance: number;
  blocked: number;
  honkCooldown: number;
}

/**
 * Lapisan lalu lintas kota (B4, B7-B9): mobil/motor ambient, bus kota, dan lampu lalu lintas.
 * Draw call: sedan/hatch/motor masing-masing 3 (badan, lampu depan, roda), bus 4 (+ pintu),
 * lampu lalu lintas 2 (tiang, lensa) = 15.
 */
export function AmbientLayer({ busStops }: { busStops: readonly BusStop[] }) {
  const graph = use(loadLaneGraph());
  const gltfs = useGLTF([...VEHICLE_IDS, 'prop_trafficlight_01'].map((id) => assetUrl(id as AssetId)));
  const camera = useThree((state) => state.camera) as PerspectiveCamera;

  const batches = useMemo(
    () => VEHICLE_IDS.map((_, index) => buildBatch(gltfs[index]?.scene ?? new Object3D(), index === BUS ? 1 : VEHICLE_POOL.high)),
    [gltfs],
  );

  // Lampu lalu lintas: tiang + satu InstancedMesh lensa dengan warna per instance (merah/kuning/hijau).
  const lights = useMemo(() => {
    const scene = gltfs[VEHICLE_IDS.length]?.scene ?? new Object3D();
    scene.updateMatrixWorld(true);
    const lenses: { state: LampState; matrix: Matrix4 }[] = [];
    let pole: InstancedMesh | null = null;
    let poleMatrix = new Matrix4();
    let lens: InstancedMesh | null = null;
    scene.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      const state = (Object.keys(LAMP_NODES) as LampState[]).find((key) => LAMP_NODES[key] === mesh.name);
      if (state) {
        lenses.push({ state, matrix: mesh.matrixWorld.clone() });
        lens ??= new InstancedMesh(mesh.geometry, new MeshBasicMaterial(), MAX_LIGHTS * 3);
      } else if (!pole) {
        pole = new InstancedMesh(mesh.geometry, mesh.material as Material, MAX_LIGHTS);
        poleMatrix = mesh.matrixWorld.clone();
      }
    });
    for (const mesh of [pole, lens] as (InstancedMesh | null)[]) if (mesh) mesh.frustumCulled = false;
    return { pole: pole as InstancedMesh | null, poleMatrix, lens: lens as InstancedMesh | null, lenses };
  }, [gltfs]);

  const root = useMemo(() => new Object3D(), []);
  const traffic = useMemo(() => createTraffic(), []);
  const extras = useMemo(() => new WeakMap<Vehicle, Extra>(), []);
  const bus = useMemo(() => createBus(), []);
  const route = useMemo(() => planBusRoute(graph, busStops), [graph, busStops]);
  const signals = useMemo(() => signalisedIntersections(graph), [graph]);
  const clock = useRef({ accumulator: 0, tick: 0, time: 0, nextId: 1, busDistance: 0 });

  useEffect(() => {
    const meshes = [...batches.flatMap((batch) => batch.parts.map((part) => part.mesh)), lights.pole, lights.lens];
    for (const mesh of meshes) if (mesh) root.add(mesh);
    return () => {
      for (const mesh of meshes) mesh?.dispose();
      root.clear();
    };
  }, [batches, lights, root]);

  useFrame((_, delta) => {
    const sim = clock.current;
    const dt = Math.min(delta, 0.05);
    const { mode } = useGameStore.getState();
    // Preset "Keramaian kota" (D4) menentukan pool kendaraan, terpisah dari kualitas grafis.
    const density = useGraphicsSettings.getState().settings.density;
    const player = { x: playerState.x, z: playerState.z, radius: MODE_RADIUS[mode] };
    const isNear = (vehicle: Vehicle) => {
      const pose = vehiclePose(graph, vehicle);
      return Math.hypot(pose.x - player.x, pose.z - player.z) <= FAR_DISTANCE;
    };

    // Simulasi tetap 15 Hz (agen jauh 5 Hz, lihat stepTrafficTiered), render diinterpolasi lewat dt.
    sim.accumulator += dt;
    while (sim.accumulator >= TICK) {
      sim.accumulator -= TICK;
      sim.tick++;
      sim.time += TICK;
      stepTrafficTiered(graph, traffic, sim.tick, Math.random, isNear, {
        gate: (edge, turn) => signalBlocks(graph, sim.time, edge, turn),
        obstacleGap: (vehicle) => playerGap(graph, vehicle, player),
      });
      const busLeg = bus.leg;
      const busS = bus.s;
      stepBus(graph, route, bus, TICK);
      // Jarak tempuh bus untuk putaran roda (0 saat berhenti di halte).
      if (bus.leg === busLeg) sim.busDistance += Math.max(0, bus.s - busS);
      else sim.busDistance += TICK * 9;

      // Spawn/despawn sekali per detik, di luar frustum kamera.
      if (sim.tick % TICK_HZ_NEAR === 0) {
        camera.getWorldDirection(VIEW_DIR);
        const halfFov = Math.atan(Math.tan(((camera.fov ?? 45) * Math.PI) / 360) * (camera.aspect ?? 1));
        updateSpawns(graph, traffic, { x: camera.position.x, z: camera.position.z, dirX: VIEW_DIR.x, dirZ: VIEW_DIR.z, halfFov }, density, Math.random, () => sim.nextId++);
      }
    }

    for (const batch of batches) for (const part of batch.parts) part.mesh.count = 0;
    for (const vehicle of traffic.vehicles) {
      let extra = extras.get(vehicle);
      if (!extra) {
        extra = { type: vehicle.id % TRAFFIC_TYPES, distance: 0, blocked: 0, honkCooldown: 0 };
        extras.set(vehicle, extra);
      }
      const batch = batches[extra.type];
      if (!batch) continue;
      extra.distance += vehicle.speed * dt;
      // ponytail: pose diambil dari tick terakhir (tanpa lerp antar tick); cukup mulus di 15 Hz untuk agen dekat.
      const pose = vehiclePose(graph, vehicle);
      addVehicle(batch.parts, pose.x, groundHeightAt(pose.x, pose.z), pose.z, pose.dirX, pose.dirZ, -extra.distance / batch.wheelRadius);

      // B8: tumpang tindih dengan pemain -> kendaraan berhenti, pemain didorong keluar. Tanpa kerusakan.
      const distance = Math.hypot(pose.x - player.x, pose.z - player.z);
      if (distance < VEHICLE_LENGTH / 2 + player.radius) {
        vehicle.speed = 0;
        const half = VEHICLE_LENGTH / 2;
        pushOutOfBoxes(playerState, player.radius, [{ minX: pose.x - half, maxX: pose.x + half, minZ: pose.z - half, maxZ: pose.z + half }]);
      }
      // Klakson kalau pemain menghalangi lebih dari 2 detik.
      extra.blocked = vehicle.speed < 0.2 && Number.isFinite(playerGap(graph, vehicle, player)) ? extra.blocked + dt : 0;
      extra.honkCooldown = Math.max(0, extra.honkCooldown - dt);
      if (extra.blocked > HONK_AFTER && extra.honkCooldown === 0) {
        extra.honkCooldown = HONK_COOLDOWN;
        // ponytail: memakai bunyi bus yang sudah ada; tambah audio.horn() kalau perlu suara klakson sendiri.
        audio.bus();
      }
    }

    const busBatch = batches[BUS];
    if (busBatch && route.edges.length > 0) {
      const pose = busPose(graph, route, bus);
      addVehicle(busBatch.parts, pose.x, groundHeightAt(pose.x, pose.z), pose.z, pose.dirX, pose.dirZ, -sim.busDistance / busBatch.wheelRadius);
    }

    // Lampu depan hanya menyala di malam hari.
    const night = isNight(dayClock.t);
    for (const batch of batches) for (const part of batch.parts) if (part.lights) part.mesh.visible = night;

    // Lampu lalu lintas di persimpangan berlampu terdekat. Lensa menghadap -Z, jadi menampilkan sumbu Z (1).
    const { pole, lens } = lights;
    if (pole) pole.count = 0;
    if (lens) lens.count = 0;
    for (const isec of signals) {
      if ((pole?.count ?? 0) >= MAX_LIGHTS) break;
      const point = graph.data.intersections[isec];
      if (!point || Math.hypot(point.x - player.x, point.z - player.z) > LIGHT_DISTANCE) continue;
      const x = point.x - POLE_CORNER;
      const z = point.z - POLE_CORNER;
      BASE.makeTranslation(x, groundHeightAt(x, z), z);
      if (pole) pole.setMatrixAt(pole.count++, SCRATCH.multiplyMatrices(BASE, lights.poleMatrix));
      if (!lens) continue;
      const lit = lampAt(isec, 1, sim.time);
      for (const face of lights.lenses) {
        lens.setMatrixAt(lens.count, SCRATCH.multiplyMatrices(BASE, face.matrix));
        lens.setColorAt(lens.count++, face.state === lit ? LAMP_ON[face.state] : LAMP_OFF);
      }
    }
    if (pole) pole.instanceMatrix.needsUpdate = true;
    if (lens) {
      lens.instanceMatrix.needsUpdate = true;
      if (lens.instanceColor) lens.instanceColor.needsUpdate = true;
    }
  });

  return <primitive object={root} />;
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, useGLTF } from '@react-three/drei';
import { Color, type InstancedMesh, type Mesh, Object3D } from 'three';
import { create } from 'zustand';
import { assetUrl } from '../app/assets';
import { dayClock, playerState } from '../game/runtime';
import { useGameStore } from '../state/gameStore';
import { mulberry32 } from '../world/worldGen';
import { groundHeightAt, worldUrl } from '../world/worldState';
import { chunkCoord, districtOf } from '../world/worldSpec';
import type { LanesData } from './laneGraph';
import { densityAt } from './density';
import { generateResidents } from './residents';
import {
  buildWalkGraph,
  createPedWorld,
  PED_LABEL_DISTANCE,
  PED_POOL,
  pedPose,
  type Pedestrian,
  setTalking,
  stepPedestrians,
  TICK_HZ,
  updatePedSpawns,
  type WalkGraph,
} from './pedestrianSim';

/** Pool warga tetap; id-nya dipakai sebagai target chat (`res_xx`). */
export const RESIDENTS = generateResidents();

const TICK = 1 / TICK_HZ;
const TURN_SMOOTHING = 6;

/** Runtime pejalan kaki yang dibaca Proximity dan panel chat. */
export const pedRuntime: { graph: WalkGraph | null; world: ReturnType<typeof createPedWorld> } = {
  graph: null,
  world: createPedWorld(),
};

/** Warga terdekat yang namanya ditampilkan (<= 6 m), supaya HUD dan label sinkron. */
export const useNearestResident = create<{ id: string | null }>()(() => ({ id: null }));

/** Pejalan kaki yang memerankan warga ini, kalau sedang ada di dunia. */
export const pedOfResident = (residentId: string): Pedestrian | undefined =>
  pedRuntime.world.peds.find((ped) => RESIDENTS[ped.residentIndex]?.id === residentId);

/** Warga berhenti dan tidak di-despawn selama panel chat terbuka. */
export function holdResident(residentId: string, talking: boolean): void {
  const index = RESIDENTS.findIndex((resident) => resident.id === residentId);
  if (index >= 0) setTalking(pedRuntime.world, index, talking);
}

/** Jumlah pejalan kaki: pool preset dikalikan kepadatan kawasan dan jam (density.ts). */
function targetCount(preset: 'low' | 'medium' | 'high', x: number, z: number, t: number): number {
  const district = districtOf(chunkCoord(x), chunkCoord(z));
  const pool = PED_POOL[preset];
  // Kepadatan Pusat Kota (14) dipakai sebagai acuan 100%.
  return Math.max(2, Math.round((pool * densityAt(district, 'pedestrian', t)) / 14));
}

/**
 * Render pejalan kaki ambient dengan satu InstancedMesh (1 draw call) dan menjalankan
 * `pedestrianSim` di 15 Hz dengan interpolasi di frame render.
 *
 * ponytail: instance memakai warna baju per varian lewat `instanceColor`, dan pose statis.
 * Atribut `_TINT` tiga region plus animasi vertex shader (walk/idle/sit) adalah bagian C3;
 * tambahkan di sini saat shader-nya siap. Blob shadow juga menyusul di C3.
 */
export function PedestrianLayer() {
  const quality = useGameStore((state) => state.quality);
  const [data, setData] = useState<LanesData | null>(null);
  const meshRef = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const timer = useRef(0);
  const nextId = useRef(0);
  const random = useRef(mulberry32(20261002));
  const yaw = useRef(new Map<number, number>());
  const gltf = useGLTF(assetUrl('ped_citizen'));
  const source = useMemo(() => {
    let found: Mesh | null = null;
    gltf.scene.traverse((child) => {
      if (!found && (child as Mesh).isMesh) found = child as Mesh;
    });
    return found as Mesh | null;
  }, [gltf]);

  useEffect(() => {
    let alive = true;
    fetch(worldUrl('lanes.json'))
      .then((response) => (response.ok ? (response.json() as Promise<LanesData>) : Promise.reject(new Error(`lanes: HTTP ${response.status}`))))
      .then((lanes) => {
        if (!alive) return;
        pedRuntime.graph = buildWalkGraph(lanes);
        setData(lanes);
      })
      .catch((error: unknown) => console.error('[pedestrian]', error));
    return () => {
      alive = false;
    };
  }, []);

  const max = PED_POOL.high;

  useFrame((state, delta) => {
    const graph = pedRuntime.graph;
    const mesh = meshRef.current;
    if (!graph || !mesh) return;
    const world = pedRuntime.world;
    world.player = { x: playerState.x, z: playerState.z };
    world.t = dayClock.t;

    timer.current += Math.min(delta, 0.25);
    let ticked = false;
    while (timer.current >= TICK) {
      timer.current -= TICK;
      stepPedestrians(graph, world, TICK, random.current);
      ticked = true;
    }

    // Spawn/despawn hanya saat ada tick simulasi, memakai kamera sebagai pusat pandangan.
    const camera = state.camera;
    const view = {
      x: camera.position.x,
      z: camera.position.z,
      dirX: playerState.x - camera.position.x,
      dirZ: playerState.z - camera.position.z,
      halfFov: Math.PI / 4,
    };
    if (ticked) updatePedSpawns(
      graph,
      world,
      view,
      Math.min(max, targetCount(quality, playerState.x, playerState.z, world.t)),
      RESIDENTS.length,
      random.current,
      () => ++nextId.current,
    );

    const dt = Math.min(delta, 0.05);
    let nearestId: string | null = null;
    let nearestDistance = PED_LABEL_DISTANCE;
    for (let i = 0; i < max; i++) {
      const ped = world.peds[i];
      if (!ped) {
        dummy.position.set(0, -50, 0);
        dummy.scale.setScalar(1);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }
      const pose = pedPose(graph, ped);
      const resident = RESIDENTS[ped.residentIndex];
      // 'talk' saat panel terbuka, 'linger' sebentar sesudahnya supaya pemain melihat warga menghadapnya.
      const talking = ped.state === 'talk' || ped.state === 'linger';
      const dx = playerState.x - pose.x;
      const dz = playerState.z - pose.z;
      const distance = Math.hypot(dx, dz);
      // Saat chat, warga menghadap pemain; kalau tidak, menghadap arah jalannya.
      const want = talking ? Math.atan2(-dx, -dz) + Math.PI : Math.atan2(-pose.dirX, -pose.dirZ) + Math.PI;
      const current = yaw.current.get(ped.id) ?? want;
      // Langsung menghadap saat chat dimulai: game loop dijeda selama panel terbuka, jadi tidak ada frame untuk berputar halus.
      const next = talking ? want : current + Math.atan2(Math.sin(want - current), Math.cos(want - current)) * (1 - Math.exp(-TURN_SMOOTHING * dt));
      yaw.current.set(ped.id, next);
      dummy.position.set(pose.x, groundHeightAt(pose.x, pose.z), pose.z);
      dummy.rotation.set(0, next, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, VARIANT_COLORS[ped.id % VARIANT_COLORS.length] as Color);
      if (resident && distance < nearestDistance) {
        nearestDistance = distance;
        nearestId = resident.id;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (useNearestResident.getState().id !== nearestId) useNearestResident.setState({ id: nearestId });
  });

  const labelId = useNearestResident((state) => state.id);
  const label = labelId ? RESIDENTS.find((resident) => resident.id === labelId) : undefined;
  const labelPed = labelId ? pedOfResident(labelId) : undefined;
  const labelPose = labelPed && pedRuntime.graph ? pedPose(pedRuntime.graph, labelPed) : null;

  if (!data || !source) return null;

  return (
    <group>
      <instancedMesh ref={meshRef} args={[source.geometry, source.material, max]} frustumCulled={false} castShadow={false} />
      {label && labelPose && (
        <Html position={[labelPose.x, groundHeightAt(labelPose.x, labelPose.z) + 2.1, labelPose.z]} center zIndexRange={[10, 0]} pointerEvents="none">
          <div className="npc-label">{label.name}</div>
        </Html>
      )}
    </group>
  );
}

/** 6 warna baju varian `ped_citizen` (lihat meta.variants di manifest aset). */
const VARIANT_COLORS = ['#2f6fdb', '#d8473a', '#3f9b5a', '#e0b12f', '#8b5bc4', '#e8e4dc'].map((hex) => new Color(hex));

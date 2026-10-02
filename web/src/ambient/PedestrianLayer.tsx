import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, useGLTF } from '@react-three/drei';
import { Color, InstancedBufferAttribute, type InstancedMesh, type Material, type Mesh, Object3D } from 'three';
import { create } from 'zustand';
import { assetUrl } from '../app/assets';
import { dayClock, playerState } from '../game/runtime';
import { useGraphicsSettings } from '../state/graphicsSettings';
import { GreetingBubbles, type GreetWalker } from './GreetingBubbles';
import { mulberry32 } from '../world/worldGen';
import { groundHeightAt, worldUrl } from '../world/worldState';
import { chunkCoord, districtOf } from '../world/worldSpec';
import type { LanesData } from './laneGraph';
import { densityAt } from './density';
import { generateResidents } from './residents';
import { ANIM_CODE, PED_ANIM_GLSL, type PedAnim, STRIDE } from './pedAnim';
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
 * C3: warna baju/celana/rambut per warga dari palet `meta.variants` lewat atribut `_TINT`,
 * dan animasi jalan/diam/duduk dihitung di vertex shader (pedAnim.ts). Tetap 1 draw call.
 *
 * ponytail: semua warga lewat jalur instanced; jalur SkinnedMesh untuk <= 4 warga terdekat dan
 * blob shadow belum dibuat. Tambahkan kalau di HP pose prosedural terlihat kaku dari dekat.
 */
export function PedestrianLayer() {
  const density = useGraphicsSettings((state) => state.settings.density);
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
  const max = PED_POOL.high;
  // Geometri di-clone supaya atribut instance tidak menempel ke cache useGLTF.
  const instanced = useMemo(() => (source ? createPedMesh(source, max) : null), [source, max]);
  useEffect(() => () => {
    instanced?.geometry.dispose();
    instanced?.material.dispose();
  }, [instanced]);
  const anim = useRef(new Map<number, { phase: number; x: number; z: number }>());

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

  const walkers = useMemo<GreetWalker[]>(() => [], []);

  useFrame((state, delta) => {
    const graph = pedRuntime.graph;
    const mesh = meshRef.current;
    if (!graph || !mesh || !instanced) return;
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
      Math.min(max, targetCount(density, playerState.x, playerState.z, world.t)),
      RESIDENTS.length,
      random.current,
      () => ++nextId.current,
    );

    const dt = Math.min(delta, 0.05);
    walkers.length = 0;
    const animAttr = instanced.anim;
    // Agen yang sudah despawn dibuang dari peta fase supaya tidak menumpuk.
    if (ticked) for (const id of anim.current.keys()) if (!world.peds.some((ped) => ped.id === id)) anim.current.delete(id);
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
      // Tinggi badan bervariasi per warga (meta.heightScale 0.92-1.06), tetap untuk id yang sama.
      dummy.scale.setScalar(0.92 + ((ped.id * 37) % 15) / 100);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      const kind: PedAnim = ped.state === 'sit' ? 'sit' : ped.state === 'walk' || ped.state === 'cross' ? 'walk' : 'idle';
      const track = anim.current.get(ped.id) ?? { phase: ped.id * 1.7, x: pose.x, z: pose.z };
      // Fase jalan mengikuti jarak tempuh (kaki tidak meluncur); diam/duduk mengikuti waktu.
      track.phase += kind === 'walk' ? (Math.hypot(pose.x - track.x, pose.z - track.z) / STRIDE) * Math.PI * 2 : dt;
      track.x = pose.x;
      track.z = pose.z;
      anim.current.set(ped.id, track);
      animAttr.setXYZ(i, ANIM_CODE[kind], track.phase % (Math.PI * 200), ped.id % VARIANTS.length);
      if (resident && !talking) walkers.push({ resident, x: pose.x, z: pose.z });
      if (resident && distance < nearestDistance) {
        nearestDistance = distance;
        nearestId = resident.id;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    animAttr.needsUpdate = true;
    if (useNearestResident.getState().id !== nearestId) useNearestResident.setState({ id: nearestId });
  });

  const labelId = useNearestResident((state) => state.id);
  const label = labelId ? RESIDENTS.find((resident) => resident.id === labelId) : undefined;
  const labelPed = labelId ? pedOfResident(labelId) : undefined;
  const labelPose = labelPed && pedRuntime.graph ? pedPose(pedRuntime.graph, labelPed) : null;

  if (!data || !instanced) return null;

  return (
    <group>
      <GreetingBubbles walkers={walkers} />
      <instancedMesh ref={meshRef} args={[instanced.geometry, instanced.material, max]} frustumCulled={false} castShadow={false} />
      {label && labelPose && (
        <Html position={[labelPose.x, groundHeightAt(labelPose.x, labelPose.z) + 2.1, labelPose.z]} center zIndexRange={[10, 0]} pointerEvents="none">
          <div className="npc-label">{label.name}</div>
        </Html>
      )}
    </group>
  );
}

/**
 * Palet `ped_citizen` dari manifest aset (meta.variants, linear RGB): [baju, celana, rambut] x 6.
 * ponytail: disalin dari manifest, bukan dibaca saat runtime. Salin ulang kalau varian di
 * tools/assets/defs/creatures.ts berubah.
 */
const VARIANTS: readonly (readonly [number, number, number])[][] = [
  [[0.0284, 0.159, 0.7084], [0.0343, 0.0513, 0.1022], [0.0242, 0.0152, 0.0116]],
  [[0.6867, 0.063, 0.0423], [0.0273, 0.0273, 0.0331], [0.0103, 0.0075, 0.006]],
  [[0.0497, 0.3278, 0.1022], [0.1022, 0.0685, 0.0423], [0.0685, 0.0296, 0.0144]],
  [[0.7454, 0.4397, 0.0284], [0.0232, 0.0356, 0.0802], [0.0242, 0.0152, 0.0116]],
  [[0.2582, 0.1046, 0.552], [0.0423, 0.0343, 0.0296], [0.147, 0.0685, 0.0232]],
  [[0.807, 0.7758, 0.7157], [0.0513, 0.0802, 0.162], [0.0075, 0.0075, 0.0075]],
];

/**
 * Geometri + material instanced warga. Atribut instance `pedAnim` = (kode animasi, fase, varian).
 * Vertex shader memilih pose dari `skinIndex.x` (rig kaku, satu bone per vertex) dan mengganti
 * warna region `_tint` (1 baju, 2 celana, 3 rambut) dengan palet varian.
 */
export function createPedMesh(source: Mesh, count: number) {
  const geometry = source.geometry.clone();
  const anim = new InstancedBufferAttribute(new Float32Array(count * 3), 3);
  geometry.setAttribute('pedAnim', anim);
  const material = (source.material as Material).clone();
  const palette = VARIANTS.flat().map(([r, g, b]) => new Color(r, g, b));
  material.onBeforeCompile = (shader) => {
    shader.uniforms.pedPalette = { value: palette };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec3 pedAnim;
attribute float _tint;
attribute vec4 skinIndex;
uniform vec3 pedPalette[${palette.length}];
${PED_ANIM_GLSL}`,
      )
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
#ifdef USE_COLOR
  if (_tint > 0.5) vColor.rgb = pedPalette[int(pedAnim.z) * 3 + int(_tint + 0.5) - 1];
#endif`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
  PedPose pedP = pedAnimPose(pedAnim.x, pedAnim.y);
  transformed = pedPoseVertex(transformed, skinIndex.x, pedP);
  transformed.y += pedP.bob;`,
      )
      // Normal ikut diputar kasar oleh bungkuk saja; cukup untuk low-poly flat shading.
      ;
  };
  // Program shader dibedakan dari material lain yang memakai sumber yang sama.
  material.customProgramCacheKey = () => 'ped-instanced-v1';
  return { geometry, material, anim };
}

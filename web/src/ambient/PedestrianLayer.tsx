import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, useGLTF } from '@react-three/drei';
import { Color, InstancedBufferAttribute, type InstancedMesh, type Material, Object3D, type SkinnedMesh } from 'three';
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
import {
  ANIM_CODE,
  bakeBindPose,
  PED_ANIM_GLSL,
  PED_MESHES,
  PED_SLOTS,
  PED_VARIANTS,
  type PedAnim,
  type PedGender,
  pedStyleMask,
  pedVariantIndex,
  splitPedsByMesh,
  STRIDE,
  pedFacing,
} from './pedAnim';
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

/** Mesh sumber pertama (SkinnedMesh) di dalam GLB warga. */
function firstSkinned(scene: Object3D): SkinnedMesh | null {
  let found: SkinnedMesh | null = null;
  scene.traverse((child) => {
    if (!found && (child as SkinnedMesh).isSkinnedMesh) found = child as SkinnedMesh;
  });
  return found;
}

/**
 * Render pejalan kaki ambient dengan dua InstancedMesh (pria `ped_citizen`, wanita
 * `ped_citizen_f`; maks 2 draw call) dan menjalankan `pedestrianSim` di 15 Hz dengan interpolasi
 * di frame render. Pejalan dibagi ke mesh menurut gender warganya (`splitPedsByMesh`), jadi warga
 * "Bu/Mbak" selalu memakai model wanita.
 *
 * C3: warna dan gaya (topi, rok, jilbab, kuncir) per warga dari palet `PED_VARIANTS` dan atribut
 * `_TINT`; animasi jalan/diam/duduk dihitung di vertex shader (pedAnim.ts). Kedua GLB memakai rig
 * yang sama, jadi pivot shader sama untuk keduanya.
 *
 * ponytail: semua warga lewat jalur instanced; jalur SkinnedMesh untuk <= 4 warga terdekat dan
 * blob shadow belum dibuat. Tambahkan kalau di HP pose prosedural terlihat kaku dari dekat.
 */
export function PedestrianLayer() {
  const density = useGraphicsSettings((state) => state.settings.density);
  const [data, setData] = useState<LanesData | null>(null);
  const maleRef = useRef<InstancedMesh>(null);
  const femaleRef = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const timer = useRef(0);
  const nextId = useRef(0);
  const random = useRef(mulberry32(20261002));
  const yaw = useRef(new Map<number, number>());
  const maleGltf = useGLTF(assetUrl(PED_MESHES[0]!.asset));
  const femaleGltf = useGLTF(assetUrl(PED_MESHES[1]!.asset));
  const max = PED_POOL.high;
  // Geometri di-clone supaya atribut instance tidak menempel ke cache useGLTF.
  // Tiap mesh berkapasitas penuh `max`: bisa saja semua pejalan yang aktif berjenis kelamin sama.
  const meshes = useMemo(() => {
    const male = firstSkinned(maleGltf.scene);
    const female = firstSkinned(femaleGltf.scene);
    return male && female ? [createPedMesh(male, max, 'm'), createPedMesh(female, max, 'f')] : null;
  }, [maleGltf, femaleGltf, max]);
  useEffect(() => () => {
    for (const mesh of meshes ?? []) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }, [meshes]);
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
    const refs = [maleRef.current, femaleRef.current];
    if (!graph || !meshes || !refs[0] || !refs[1]) return;
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
    // Agen yang sudah despawn dibuang dari peta fase supaya tidak menumpuk.
    if (ticked) for (const id of anim.current.keys()) if (!world.peds.some((ped) => ped.id === id)) anim.current.delete(id);
    let nearestId: string | null = null;
    let nearestDistance = PED_LABEL_DISTANCE;
    const { slots } = splitPedsByMesh(world.peds, RESIDENTS, max);
    for (let m = 0; m < meshes.length; m++) {
      const mesh = refs[m]!;
      const { anim: animAttr, style: styleAttr, gender } = meshes[m]!;
      const peds = slots[m]!;
      // Slot 0..peds.length-1 terisi, sisanya disembunyikan di bawah tanah (y = -50).
      for (let i = 0; i < max; i++) {
        const ped = peds[i];
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
        // Tanpa offset PI: rig menghadap -Z, jadi pedFacing sudah menghasilkan arah hadap yang benar.
        const want = talking ? pedFacing(dx, dz) : pedFacing(pose.dirX, pose.dirZ);
        const current = yaw.current.get(ped.id) ?? want;
        // Langsung menghadap saat chat dimulai: game loop dijeda selama panel terbuka, jadi tidak ada frame untuk berputar halus.
        const next = talking ? want : current + Math.atan2(Math.sin(want - current), Math.cos(want - current)) * (1 - Math.exp(-TURN_SMOOTHING * dt));
        yaw.current.set(ped.id, next);
        dummy.position.set(pose.x, groundHeightAt(pose.x, pose.z), pose.z);
        dummy.rotation.set(0, next, 0);
        // Tinggi badan per warga (meta.heightScale: pria 0.92-1.06, wanita 0.88-1.00), tetap untuk id yang sama.
        dummy.scale.setScalar(gender === 'f' ? 0.88 + ((ped.id * 37) % 13) / 100 : 0.92 + ((ped.id * 37) % 15) / 100);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);

        const kind: PedAnim = ped.state === 'sit' ? 'sit' : ped.state === 'walk' || ped.state === 'cross' ? 'walk' : 'idle';
        const track = anim.current.get(ped.id) ?? { phase: ped.id * 1.7, x: pose.x, z: pose.z };
        // Fase jalan mengikuti jarak tempuh (kaki tidak meluncur); diam/duduk mengikuti waktu.
        track.phase += kind === 'walk' ? (Math.hypot(pose.x - track.x, pose.z - track.z) / STRIDE) * Math.PI * 2 : dt;
        track.x = pose.x;
        track.z = pose.z;
        anim.current.set(ped.id, track);
        // Warna dan gaya mengikuti warga (bukan id spawn), jadi warga yang sama selalu tampil sama.
        const look = ped.residentIndex >= 0 ? ped.residentIndex : ped.id;
        animAttr.setXYZ(i, ANIM_CODE[kind], track.phase % (Math.PI * 200), pedVariantIndex(gender, look));
        styleAttr.setX(i, pedStyleMask(gender, look));
        if (resident && !talking) walkers.push({ resident, x: pose.x, z: pose.z });
        if (resident && distance < nearestDistance) {
          nearestDistance = distance;
          nearestId = resident.id;
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
      animAttr.needsUpdate = true;
      styleAttr.needsUpdate = true;
    }
    if (useNearestResident.getState().id !== nearestId) useNearestResident.setState({ id: nearestId });
  });

  const labelId = useNearestResident((state) => state.id);
  const label = labelId ? RESIDENTS.find((resident) => resident.id === labelId) : undefined;
  const labelPed = labelId ? pedOfResident(labelId) : undefined;
  const labelPose = labelPed && pedRuntime.graph ? pedPose(pedRuntime.graph, labelPed) : null;

  if (!data || !meshes) return null;

  return (
    <group>
      <GreetingBubbles walkers={walkers} />
      <instancedMesh ref={maleRef} args={[meshes[0]!.geometry, meshes[0]!.material, max]} frustumCulled={false} castShadow={false} />
      <instancedMesh ref={femaleRef} args={[meshes[1]!.geometry, meshes[1]!.material, max]} frustumCulled={false} castShadow={false} />
      {label && labelPose && (
        <Html position={[labelPose.x, groundHeightAt(labelPose.x, labelPose.z) + 2.1, labelPose.z]} center zIndexRange={[10, 0]} pointerEvents="none">
          <div className="npc-label">{label.name}</div>
        </Html>
      )}
    </group>
  );
}

/**
 * Geometri + material instanced warga. Bind pose dibakar ke ruang meter dulu (`bakeBindPose`),
 * karena POSITION di GLB terkuantisasi ke -1..1. Atribut instance `pedAnim` = (kode animasi, fase,
 * varian) dan `pedStyle` = mask grup gaya (pedStyleMask). Vertex shader memilih pose dari atribut
 * `bone`, mengempiskan vertex grup gaya yang tidak aktif, dan mengganti warna region `_tint`
 * dengan palet `PED_VARIANTS[gender]` (lihat pedTintSlot di pedAnim.ts).
 */
export function createPedMesh(source: SkinnedMesh, count: number, gender: PedGender) {
  const geometry = bakeBindPose(source);
  const anim = new InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const style = new InstancedBufferAttribute(new Float32Array(count), 1);
  geometry.setAttribute('pedAnim', anim);
  geometry.setAttribute('pedStyle', style);
  const material = (source.material as Material).clone();
  const palette = PED_VARIANTS[gender].flat().map(([r, g, b]) => new Color(r, g, b));
  material.onBeforeCompile = (shader) => {
    shader.uniforms.pedPalette = { value: palette };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec3 pedAnim;
attribute float pedStyle;
attribute float _tint;
attribute float bone;
uniform vec3 pedPalette[${palette.length}];
${PED_ANIM_GLSL}`,
      )
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
#ifdef USE_COLOR
  int pedSlot = pedStyleSlot(_tint, pedStyle);
  if (pedSlot >= 0) vColor.rgb = pedPalette[int(pedAnim.z + 0.5) * ${PED_SLOTS} + pedSlot];
#endif`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
  PedPose pedP = pedAnimPose(pedAnim.x, pedAnim.y);
  transformed = pedPoseVertex(transformed, bone, pedP);
  transformed.y += pedP.bob;
  // Grup gaya yang tidak dipakai warga ini: segitiganya dikempiskan ke satu titik (tidak tergambar).
  if (!pedStyleVisible(_tint, pedStyle)) transformed = vec3(0.0);`,
      )
      // Normal ikut diputar kasar oleh bungkuk saja; cukup untuk low-poly flat shading.
      ;
  };
  // Program shader dibedakan per gender (panjang palet uniform berbeda).
  material.customProgramCacheKey = () => `ped-instanced-v2-${gender}`;
  return { geometry, material, anim, style, gender };
}

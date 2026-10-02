import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, useGLTF } from '@react-three/drei';
import {
  BufferAttribute,
  Color,
  InstancedBufferAttribute,
  type InstancedMesh,
  Matrix4,
  type Material,
  type MeshStandardMaterial,
  Object3D,
  type SkinnedMesh,
  Vector3,
} from 'three';
import { create } from 'zustand';
import { assetUrl } from '../app/assets';
import { dayClock, playerState } from '../game/runtime';
import { useGraphicsSettings } from '../state/graphicsSettings';
import { mulberry32 } from '../world/worldGen';
import { groundHeightAt, worldUrl } from '../world/worldState';
import { chunkCoord, districtOf } from '../world/worldSpec';
import { type AmbientAgent, ambientRuntime, resetAgents } from './ambientRuntime';
import type { LanesData } from './laneGraph';
import { densityAt } from './density';
import { GreetingBubbles, type GreetWalker } from './GreetingBubbles';
import { ANIM_CODE, PED_ANIM_GLSL, type PedAnim, STRIDE } from './pedAnim';
import { generateResidents } from './residents';
import {
  buildWalkGraph,
  createPedWorld,
  PED_LABEL_DISTANCE,
  PED_POOL,
  pedPose,
  type Pedestrian,
  type PedState,
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

/** State simulasi -> klip animasi shader. */
const ANIM_OF: Record<PedState, PedAnim> = { walk: 'walk', cross: 'walk', wait: 'idle', talk: 'idle', linger: 'idle', sit: 'sit' };

/**
 * Geometri untuk InstancedMesh: rig `ped_citizen` kaku (1 joint per vertex), jadi pose bisa
 * dihitung di vertex shader tanpa SkinnedMesh. Posisi di GLB masih terkuantisasi
 * (KHR_mesh_quantization, skalanya tertanam di inverse bind matrix), jadi sekali saat load
 * tiap vertex dipindah ke ruang model lewat matriks skin rest pose-nya. Hasilnya:
 * `position` ruang model, `aBone` indeks joint, `aTintRegion` region `_TINT`.
 */
function bakePedGeometry(mesh: SkinnedMesh, scene: Object3D) {
  const geometry = mesh.geometry.clone();
  const position = geometry.getAttribute('position');
  const skinIndex = geometry.getAttribute('skinIndex');
  // GLTFLoader menurunkan nama atribut kustom jadi huruf kecil.
  const tint = geometry.getAttribute('_tint');
  scene.updateMatrixWorld(true);
  const baked = new Float32Array(position.count * 3);
  const bones = new Float32Array(position.count);
  const regions = new Float32Array(position.count);
  const matrix = new Matrix4();
  const point = new Vector3();
  for (let i = 0; i < position.count; i++) {
    const bone = skinIndex.getX(i);
    const joint = mesh.skeleton.bones[bone];
    const inverse = mesh.skeleton.boneInverses[bone];
    if (!joint || !inverse) throw new Error(`ped_citizen: joint ${bone} tidak ada`);
    matrix.multiplyMatrices(joint.matrixWorld, inverse).premultiply(mesh.bindMatrixInverse).multiply(mesh.bindMatrix);
    point.fromBufferAttribute(position, i).applyMatrix4(matrix).toArray(baked, i * 3);
    bones[i] = bone;
    regions[i] = tint ? tint.getX(i) : 0;
  }
  geometry.setAttribute('position', new BufferAttribute(baked, 3));
  geometry.setAttribute('aBone', new BufferAttribute(bones, 1));
  geometry.setAttribute('aTintRegion', new BufferAttribute(regions, 1));
  geometry.deleteAttribute('skinIndex');
  geometry.deleteAttribute('skinWeight');
  geometry.deleteAttribute('_tint');
  // Rest pose rig ini hanya translasi (rotasi identitas), jadi normal tidak perlu dibake ulang.
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Material dengan animasi vertex: `aAnim` (kode klip, fase) dan warna per instance
 * (`aShirt`/`aPants`/`aHair`) disisipkan ke shader standar, jadi tetap satu draw call.
 */
function pedMaterial(source: Material): Material {
  const material = (source as MeshStandardMaterial).clone();
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aBone;
attribute float aTintRegion;
attribute vec3 aShirt;
attribute vec3 aPants;
attribute vec3 aHair;
/** x = kode klip (0 idle, 1 walk, 2 sit), y = fase (radian). */
attribute vec2 aAnim;
${PED_ANIM_GLSL}`,
      )
      // Normal diputar bersama vertex-nya: beda pose dari titik yang digeser sedikit sepanjang normal.
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
  {
    PedPose pedN = pedAnimPose(aAnim.x, aAnim.y);
    vec3 base = pedPoseVertex(position, aBone, pedN);
    objectNormal = normalize(pedPoseVertex(position + objectNormal * 0.02, aBone, pedN) - base);
  }`,
      )
      .replace(
        '#include <begin_vertex>',
        `PedPose pedP = pedAnimPose(aAnim.x, aAnim.y);
  vec3 transformed = pedPoseVertex(position, aBone, pedP) + vec3(0.0, pedP.bob, 0.0);`,
      )
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
  if (aTintRegion > 0.5) {
    vec3 pedTint = aTintRegion < 1.5 ? aShirt : (aTintRegion < 2.5 ? aPants : aHair);
    vColor.rgb = pedTint;
  }`,
      );
  };
  material.customProgramCacheKey = () => 'pedAnim';
  return material;
}

/**
 * Render pejalan kaki ambient dengan satu InstancedMesh (1 draw call) dan menjalankan
 * `pedestrianSim` di 15 Hz dengan interpolasi di frame render. Pose walk/idle/sit dihitung
 * di vertex shader (pedAnim.ts), warna baju/celana/rambut per instance dari `meta.variants`.
 *
 * ponytail: tinggi badan seragam (meta.heightScale belum dipakai) dan tidak ada blob shadow;
 * tambahkan atribut skala per instance kalau variasi siluet terasa kurang.
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
  /** Fase animasi per pejalan: jalan maju dengan jarak tempuh, idle/sit dengan waktu. */
  const phase = useRef(new Map<number, number>());
  const gltf = useGLTF(assetUrl('ped_citizen'));
  const source = useMemo(() => {
    let found: SkinnedMesh | null = null;
    gltf.scene.traverse((child) => {
      if (!found && (child as SkinnedMesh).isSkinnedMesh) found = child as SkinnedMesh;
    });
    return found as SkinnedMesh | null;
  }, [gltf]);
  const geometry = useMemo(() => (source ? bakePedGeometry(source, gltf.scene) : null), [source, gltf]);
  const material = useMemo(() => (source ? pedMaterial(source.material as Material) : null), [source]);

  const max = PED_POOL.high;
  /** Atribut per instance; dialokasikan sekali untuk pool penuh. */
  const attributes = useMemo(
    () => ({
      shirt: new InstancedBufferAttribute(new Float32Array(max * 3), 3),
      pants: new InstancedBufferAttribute(new Float32Array(max * 3), 3),
      hair: new InstancedBufferAttribute(new Float32Array(max * 3), 3),
      anim: new InstancedBufferAttribute(new Float32Array(max * 2), 2),
    }),
    [max],
  );
  /** Objek agen yang diterbitkan ke ambientRuntime dan ke gelembung sapaan; dipakai ulang. */
  const published = useMemo(() => [] as AmbientAgent[], []);
  const walkers = useMemo(() => [] as GreetWalker[], []);

  useEffect(() => {
    if (!geometry) return;
    geometry.setAttribute('aShirt', attributes.shirt);
    geometry.setAttribute('aPants', attributes.pants);
    geometry.setAttribute('aHair', attributes.hair);
    geometry.setAttribute('aAnim', attributes.anim);
  }, [geometry, attributes]);

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

  useEffect(
    () => () => {
      resetAgents(ambientRuntime.peds);
    },
    [],
  );

  useFrame((state, delta) => {
    const graph = pedRuntime.graph;
    const mesh = meshRef.current;
    if (!graph || !mesh) return;
    const world = pedRuntime.world;
    world.player = { x: playerState.x, z: playerState.z };
    world.t = dayClock.t;
    // Kendaraan dan lampu penyeberangan nyata dari AmbientLayer (ambientRuntime).
    world.vehicles = ambientRuntime.vehicles;
    world.pedGreen = (x, z, axis) => ambientRuntime.pedGreen?.(x, z, axis) ?? true;

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
    let nearestId: string | null = null;
    let nearestDistance = PED_LABEL_DISTANCE;
    resetAgents(ambientRuntime.peds);
    let walkerCount = 0;
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

      // Fase: jalan ikut jarak tempuh (satu putaran per STRIDE), idle/sit ikut waktu.
      const anim = ANIM_OF[ped.state];
      const step = anim === 'walk' ? (ped.speed * dt * Math.PI * 2) / STRIDE : dt * 2;
      const nextPhase = ((phase.current.get(ped.id) ?? ped.id) + step) % (Math.PI * 2);
      phase.current.set(ped.id, nextPhase);
      attributes.anim.setXY(i, ANIM_CODE[anim], nextPhase);
      setVariant(attributes, i, ped.id);

      const agent = (published[i] ??= { x: 0, z: 0, speed: 0 });
      agent.x = pose.x;
      agent.z = pose.z;
      agent.speed = ped.speed;
      ambientRuntime.peds.push(agent);

      // Gelembung sapaan hanya untuk warga yang belum/tidak sedang diajak bicara.
      if (resident && !talking) {
        const walker = (walkers[walkerCount] ??= { resident, x: 0, z: 0 });
        walker.resident = resident;
        walker.x = pose.x;
        walker.z = pose.z;
        walkerCount++;
      }
      if (resident && distance < nearestDistance) {
        nearestDistance = distance;
        nearestId = resident.id;
      }
    }
    walkers.length = walkerCount;
    mesh.instanceMatrix.needsUpdate = true;
    for (const attribute of Object.values(attributes)) attribute.needsUpdate = true;
    if (useNearestResident.getState().id !== nearestId) useNearestResident.setState({ id: nearestId });
  });

  const labelId = useNearestResident((state) => state.id);
  const label = labelId ? RESIDENTS.find((resident) => resident.id === labelId) : undefined;
  const labelPed = labelId ? pedOfResident(labelId) : undefined;
  const labelPose = labelPed && pedRuntime.graph ? pedPose(pedRuntime.graph, labelPed) : null;

  if (!data || !geometry || !material) return null;

  return (
    <group>
      <instancedMesh ref={meshRef} args={[geometry, material, max]} frustumCulled={false} castShadow={false} />
      <GreetingBubbles walkers={walkers} />
      {label && labelPose && (
        <Html position={[labelPose.x, groundHeightAt(labelPose.x, labelPose.z) + 2.1, labelPose.z]} center zIndexRange={[10, 0]} pointerEvents="none">
          <div className="npc-label">{label.name}</div>
        </Html>
      )}
    </group>
  );
}

/** 6 varian `ped_citizen` (meta.variants di manifest aset): [baju, celana, rambut]. */
const VARIANTS = [
  ['#2f6fdb', '#34405a', '#2b211c'],
  ['#d8473a', '#2e2e33', '#1a1512'],
  ['#3f9b5a', '#5a4a3a', '#4a3020'],
  ['#e0b12f', '#2a3550', '#2b211c'],
  ['#8b5bc4', '#3a3430', '#6b4a2a'],
  ['#e8e4dc', '#405070', '#151515'],
].map((variant) => variant.map((hex) => new Color(hex).convertSRGBToLinear()));

type PedAttributes = Record<'shirt' | 'pants' | 'hair' | 'anim', InstancedBufferAttribute>;

/** Warna varian untuk slot instance `index`; dipilih dari id pejalan supaya stabil (26 instance, ditulis tiap frame). */
function setVariant(attributes: PedAttributes, index: number, pedId: number): void {
  const [shirt, pants, hair] = VARIANTS[pedId % VARIANTS.length] ?? [];
  if (!shirt || !pants || !hair) return;
  attributes.shirt.setXYZ(index, shirt.r, shirt.g, shirt.b);
  attributes.pants.setXYZ(index, pants.r, pants.g, pants.b);
  attributes.hair.setXYZ(index, hair.r, hair.g, hair.b);
}

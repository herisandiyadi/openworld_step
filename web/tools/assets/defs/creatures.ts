import { MeshBuilder } from '../lib/builder';
import { tintRegions } from '../lib/gltf';
import { type Vec3, deg } from '../lib/math';
import { PALETTE, hex, type Rgb } from '../lib/palette';
import { BONES, IDLE, SIT, WALK, buildBody, buildRigDocument, type RigBone, type RigClip } from './humanoid';
import type { AssetDef } from './types';

/**
 * Warga dan hewan ambient (C3, C4). Semua rig kaku (satu joint per vertex), jadi runtime punya dua jalur:
 * - jauh: InstancedMesh + vertex shader, JOINTS_0 dipakai sebagai indeks bagian tubuh dan pose
 *   dihitung prosedural dari klip yang sama (rumus di `meta.vertexAnim`);
 * - dekat (<= 4 agen): SkinnedMesh biasa dengan klip GLB.
 * `_TINT` (0 = tetap, 1..n = region) memilih warna dari palet instance; palet ada di `meta.variants`.
 */

const TAU = Math.PI * 2;
const rx = (a: number): Vec3 => [a, 0, 0];
const srgb = (c: Rgb) => c.map((v) => Number(v.toFixed(4)));

// --- C3: warga ------------------------------------------------------------------------------------

// Warna penanda region; nilai sebenarnya datang dari palet instance.
const CITIZEN_REGIONS: [Rgb, number][] = [
  [PALETTE.hoodie, 1],
  [PALETTE.hoodieDark, 1],
  [PALETTE.jeans, 2],
  [PALETTE.hair, 3],
];

/** 6 variasi: [baju, celana, rambut] (linear RGB, siap jadi atribut instance). */
const CITIZEN_VARIANTS = [
  ['#2f6fdb', '#34405a', '#2b211c'],
  ['#d8473a', '#2e2e33', '#1a1512'],
  ['#3f9b5a', '#5a4a3a', '#4a3020'],
  ['#e0b12f', '#2a3550', '#2b211c'],
  ['#8b5bc4', '#3a3430', '#6b4a2a'],
  ['#e8e4dc', '#405070', '#151515'],
].map((v) => v.map((c) => srgb(hex(c))));

function buildCitizen() {
  const builder = buildBody({
    skin: PALETTE.skinTan,
    hair: PALETTE.hair,
    eye: PALETTE.eye,
    shirt: PALETTE.hoodie,
    shirtDark: PALETTE.hoodieDark,
    pants: PALETTE.jeans,
    shoe: PALETTE.sole,
    sole: PALETTE.sole,
  });
  const tint = tintRegions(builder, CITIZEN_REGIONS);
  return buildRigDocument('ped_citizen', BONES, 1, [{ name: 'ped_citizen', builder, tint }], [IDLE, WALK, SIT]);
}

// --- C4: hewan ------------------------------------------------------------------------------------

interface QuadSpec {
  id: string;
  /** Tinggi pinggul/bahu, panjang badan, lebar badan. */
  legLength: number;
  bodyLength: number;
  bodyWidth: number;
  bodyHeight: number;
  headSize: number;
  tailLength: number;
  fur: Rgb;
  furDark: Rgb;
  maxTriangles: number;
}

/** Rig berkaki empat: root, body (pembawa translasi), head, tail, 4 kaki. Hewan menghadap -Z. */
function quadBones(q: QuadSpec): RigBone[] {
  const y = q.legLength;
  const hz = q.bodyLength / 2 - 0.03;
  const hx = q.bodyWidth / 2 - 0.02;
  return [
    { name: 'root', parent: -1, rest: [0, 0, 0] },
    { name: 'body', parent: 0, rest: [0, y + q.bodyHeight / 2, 0] },
    { name: 'head', parent: 1, rest: [0, y + q.bodyHeight * 0.8, -q.bodyLength / 2] },
    { name: 'tail', parent: 1, rest: [0, y + q.bodyHeight * 0.75, q.bodyLength / 2] },
    { name: 'leg_FL', parent: 1, rest: [-hx, y, -hz] },
    { name: 'leg_FR', parent: 1, rest: [hx, y, -hz] },
    { name: 'leg_BL', parent: 1, rest: [-hx, y, hz] },
    { name: 'leg_BR', parent: 1, rest: [hx, y, hz] },
  ];
}

function quadMesh(q: QuadSpec, bones: RigBone[], extras?: (b: MeshBuilder, at: (n: string) => Vec3) => void): MeshBuilder {
  const b = new MeshBuilder();
  const idx = (n: string) => bones.findIndex((bone) => bone.name === n);
  const at = (n: string) => bones[idx(n)]?.rest ?? [0, 0, 0];
  const [, by] = at('body');
  b.box([q.bodyWidth, q.bodyHeight, q.bodyLength], { at: [0, by, 0], color: q.fur, bone: idx('body') });
  const head = at('head');
  const h = q.headSize;
  b.box([h, h * 0.9, h * 1.15], { at: [head[0], head[1] + h * 0.25, head[2] - h * 0.3], color: q.fur, bone: idx('head') });
  // Leher: menutup celah antara kepala dan badan di tampilan samping.
  b.box([h * 0.6, h * 0.6, h * 0.5], { at: [0, head[1] - h * 0.1, head[2] + h * 0.22], color: q.furDark, bone: idx('head') });
  b.box([h * 0.5, h * 0.4, h * 0.4], { at: [0, head[1] + h * 0.1, head[2] - h * 0.95], color: q.furDark, bone: idx('head') });
  for (const s of [-1, 1]) {
    b.frustum({ radiusBottom: h * 0.18, radiusTop: 0, height: h * 0.4, segments: 3 }, { at: [s * h * 0.3, head[1] + h * 0.72, head[2] - h * 0.3], color: q.furDark, bone: idx('head') });
    b.box([h * 0.12, h * 0.12, 0.01], { at: [s * h * 0.22, head[1] + h * 0.42, head[2] - h * 0.86], color: PALETTE.eye, bone: idx('head') });
  }
  const tail = at('tail');
  b.bar(tail, [0, tail[1] + q.tailLength * 0.5, tail[2] + q.tailLength * 0.85], h * 0.18, { color: q.furDark, bone: idx('tail') });
  for (const leg of ['leg_FL', 'leg_FR', 'leg_BL', 'leg_BR']) {
    const p = at(leg);
    b.frustum({ radiusBottom: q.bodyWidth * 0.14, radiusTop: q.bodyWidth * 0.16, height: q.legLength, segments: 4 }, { at: [p[0], 0, p[2]], color: q.furDark, bone: idx(leg) });
  }
  extras?.(b, at);
  if (b.triangleCount > q.maxTriangles) throw new Error(`${q.id}: segitiga ${b.triangleCount} > ${q.maxTriangles}`);
  return b;
}

/** Siklus kaki diagonal (trot); `swing` = amplitudo ayunan kaki, `bob` = naik-turun badan. */
const gait = (name: string, duration: number, swing: number, bob: number): RigClip => ({
  name,
  duration,
  pose: (p) => {
    const s = Math.sin(TAU * p);
    return {
      rot: {
        leg_FL: rx(swing * s),
        leg_BR: rx(swing * s),
        leg_FR: rx(-swing * s),
        leg_BL: rx(-swing * s),
        head: rx(deg(4) * Math.sin(2 * TAU * p)),
        tail: [deg(10), deg(20) * s, 0],
      },
      hips: [0, bob * Math.abs(Math.cos(TAU * p)) - bob, 0],
    };
  },
});

/** Duduk: badan miring ke belakang, kaki belakang terlipat. */
const sitClip = (q: QuadSpec): RigClip => ({
  name: 'anim_Sit',
  duration: 3,
  pose: (p) => ({
    rot: {
      body: rx(deg(28)),
      head: rx(deg(-24 + 3 * Math.sin(TAU * p))),
      leg_FL: rx(deg(-28)),
      leg_FR: rx(deg(-28)),
      leg_BL: rx(deg(62)),
      leg_BR: rx(deg(62)),
      tail: [deg(-40), deg(10) * Math.sin(TAU * p), 0],
    },
    hips: [0, -q.legLength * 0.45, 0],
  }),
});

const sniffClip = (q: QuadSpec): RigClip => ({
  name: 'anim_Sniff',
  duration: 2,
  pose: (p) => ({
    rot: {
      body: rx(deg(-8)),
      head: [deg(-38 + 4 * Math.sin(4 * TAU * p)), deg(14) * Math.sin(TAU * p), 0],
      tail: [deg(20), deg(25) * Math.sin(2 * TAU * p), 0],
    },
    hips: [0, -q.legLength * 0.08, 0],
  }),
});

const CAT: QuadSpec = { id: 'animal_cat', legLength: 0.16, bodyLength: 0.42, bodyWidth: 0.15, bodyHeight: 0.14, headSize: 0.12, tailLength: 0.3, fur: PALETTE.furGrey, furDark: PALETTE.furDark, maxTriangles: 600 };
const DOG: QuadSpec = { id: 'animal_dog', legLength: 0.28, bodyLength: 0.62, bodyWidth: 0.22, bodyHeight: 0.22, headSize: 0.18, tailLength: 0.22, fur: PALETTE.wood, furDark: PALETTE.woodDark, maxTriangles: 800 };

const FUR_REGIONS = (q: QuadSpec): [Rgb, number][] => [[q.fur, 1], [q.furDark, 2]];

function buildQuad(q: QuadSpec, clips: RigClip[]) {
  const bones = quadBones(q);
  const builder = quadMesh(q, bones);
  return buildRigDocument(q.id, bones, 1, [{ name: q.id, builder, tint: tintRegions(builder, FUR_REGIONS(q)) }], clips);
}

// --- C4: merpati (<= 150 segitiga, kawanan instanced) ---------------------------------------------

const PIGEON_BONES: RigBone[] = [
  { name: 'root', parent: -1, rest: [0, 0, 0] },
  { name: 'body', parent: 0, rest: [0, 0.12, 0] },
  { name: 'head', parent: 1, rest: [0, 0.17, -0.07] },
  { name: 'wing_L', parent: 1, rest: [-0.05, 0.15, 0] },
  { name: 'wing_R', parent: 1, rest: [0.05, 0.15, 0] },
];

function buildPigeon() {
  const b = new MeshBuilder();
  const grey = PALETTE.metalLight;
  const dark = PALETTE.metalDark;
  b.blob({ radius: 0.07, stretch: [0.8, 0.75, 1.3] }, { at: [0, 0.12, 0], color: grey, bone: 1 });
  b.box([0.05, 0.02, 0.09], { at: [0, 0.12, 0.12], rot: [0.3, 0, 0], color: dark, bone: 1 });
  b.blob({ radius: 0.035 }, { at: [0, 0.2, -0.09], color: dark, bone: 2 });
  b.frustum({ radiusBottom: 0.008, radiusTop: 0, height: 0.025, segments: 3 }, { at: [0, 0.2, -0.12], rot: [-Math.PI / 2, 0, 0], color: PALETTE.beak, bone: 2 });
  for (const [s, bone] of [[-1, 3], [1, 4]] as const) {
    b.box([0.14, 0.01, 0.1], { at: [s * 0.12, 0.15, 0.01], color: grey, bone });
    b.bar([s * 0.02, 0.06, 0], [s * 0.02, 0, -0.01], 0.012, { color: PALETTE.beak, bone: 1 });
  }
  if (b.triangleCount > 150) throw new Error(`bird_pigeon: segitiga ${b.triangleCount} > 150`);
  const peck: RigClip = {
    name: 'anim_Peck',
    duration: 1.2,
    pose: (p) => {
      // Dua patukan cepat lalu diam; bentuk pulsa tetap periodik supaya loop mulus.
      const dip = Math.max(0, Math.sin(TAU * p * 2)) ** 2;
      return { rot: { body: rx(deg(-25) * dip), head: rx(deg(-35) * dip), wing_L: [0, 0, 0], wing_R: [0, 0, 0] } };
    },
  };
  const fly: RigClip = {
    name: 'anim_Fly',
    duration: 0.3,
    pose: (p) => {
      const flap = deg(55) * Math.sin(TAU * p);
      return { rot: { wing_L: [0, 0, -flap], wing_R: [0, 0, flap], body: rx(deg(-10)) }, hips: [0, 0.02 * Math.sin(TAU * p), 0] };
    },
  };
  const walk: RigClip = {
    name: 'anim_Walk',
    duration: 0.6,
    pose: (p) => ({ rot: { head: rx(deg(10) * Math.sin(TAU * p)), body: [0, 0, deg(5) * Math.sin(TAU * p)] } }),
  };
  return buildRigDocument('bird_pigeon', PIGEON_BONES, 1, [{ name: 'bird_pigeon', builder: b, tint: tintRegions(b, [[grey, 1]]) }], [peck, fly, walk]);
}

const ANIMAL_TAGS = ['animal', 'ambient', 'city'];
const furVariants = (colors: string[][]) => colors.map((v) => v.map((c) => srgb(hex(c))));
const VERTEX_ANIM = 'rigid: JOINTS_0 = indeks bagian; pose per bagian = rotasi di sekitar rest joint (lihat klip)';

export const creatureAssets: AssetDef[] = [
  {
    id: 'ped_citizen',
    category: 'npc',
    tags: ['character', 'city', 'npc', 'ambient', 'pedestrian'],
    collider: { type: 'capsule', radius: 0.3, height: 1.75, center: [0, 0.875, 0] },
    requiredAnimations: ['anim_Idle', 'anim_Walk', 'anim_Sit'],
    previews: [
      { clip: 'anim_Walk', phase: 0.25 },
      { clip: 'anim_Sit', phase: 0 },
    ],
    meta: { tintAttribute: '_TINT', tintRegions: ['shirt', 'pants', 'hair'], variants: CITIZEN_VARIANTS, heightScale: [0.92, 1.06], vertexAnim: VERTEX_ANIM, sitHeight: 0.45 },
    build: buildCitizen,
  },
  {
    id: 'animal_cat',
    category: 'animal',
    tags: [...ANIMAL_TAGS, 'cat', 'residential', 'park'],
    collider: { type: 'capsule', radius: 0.1, height: 0.35, center: [0, 0.18, 0] },
    requiredAnimations: ['anim_Walk', 'anim_Run', 'anim_Sit'],
    previews: [{ clip: 'anim_Run', phase: 0.25 }, { clip: 'anim_Sit', phase: 0 }],
    meta: { tintAttribute: '_TINT', tintRegions: ['fur', 'furDark'], variants: furVariants([['#9a948c', '#4a4440'], ['#e08a3a', '#b0602a'], ['#2a2a2e', '#141416']]), vertexAnim: VERTEX_ANIM },
    build: () => buildQuad(CAT, [gait('anim_Walk', 0.8, deg(22), 0.005), gait('anim_Run', 0.4, deg(42), 0.02), sitClip(CAT)]),
  },
  {
    id: 'animal_dog',
    category: 'animal',
    tags: [...ANIMAL_TAGS, 'dog', 'residential', 'park'],
    collider: { type: 'capsule', radius: 0.16, height: 0.6, center: [0, 0.3, 0] },
    requiredAnimations: ['anim_Walk', 'anim_Run', 'anim_Sit', 'anim_Sniff'],
    previews: [{ clip: 'anim_Run', phase: 0.25 }, { clip: 'anim_Sniff', phase: 0.25 }],
    meta: { tintAttribute: '_TINT', tintRegions: ['fur', 'furDark'], variants: furVariants([['#b07a45', '#8a5c32'], ['#e8e0cc', '#a89a80'], ['#2e2a28', '#1a1816']]), sizes: [0.75, 1.0], vertexAnim: VERTEX_ANIM },
    build: () => buildQuad(DOG, [gait('anim_Walk', 0.9, deg(24), 0.008), gait('anim_Run', 0.45, deg(45), 0.03), sitClip(DOG), sniffClip(DOG)]),
  },
  {
    id: 'bird_pigeon',
    category: 'animal',
    tags: [...ANIMAL_TAGS, 'bird', 'plaza', 'park', 'flock'],
    collider: { type: 'capsule', radius: 0.08, height: 0.22, center: [0, 0.11, 0] },
    requiredAnimations: ['anim_Peck', 'anim_Fly', 'anim_Walk'],
    previews: [{ clip: 'anim_Peck', phase: 0.125 }, { clip: 'anim_Fly', phase: 0.25 }],
    meta: { tintAttribute: '_TINT', tintRegions: ['feather'], vertexAnim: VERTEX_ANIM },
    build: buildPigeon,
  },
];

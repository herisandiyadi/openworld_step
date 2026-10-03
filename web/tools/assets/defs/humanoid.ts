import type { Document, Material, Node } from '@gltf-transform/core';
import { MeshBuilder } from '../lib/builder';
import { addMesh, createAccessor, createBaseDocument } from '../lib/gltf';
import { solveTwoBone } from '../lib/ik';
import { type Vec3, deg, quatFromEuler } from '../lib/math';
import { PALETTE, type Rgb } from '../lib/palette';
import { ANIM, BIKE, SKATE } from '../../../src/game/vehicleSpec';

export type BoneName =
  | 'root'
  | 'hips'
  | 'spine'
  | 'chest'
  | 'head'
  | 'upperArm_L'
  | 'lowerArm_L'
  | 'upperArm_R'
  | 'lowerArm_R'
  | 'upperLeg_L'
  | 'lowerLeg_L'
  | 'upperLeg_R'
  | 'lowerLeg_R';

interface BoneDef {
  name: BoneName;
  parent: number;
  /** Rest position in model space (rest rotations are identity). */
  rest: Vec3;
}

/** Shared 13-bone humanoid rig. Character faces -Z; its right side is +X. */
export const BONES: BoneDef[] = [
  { name: 'root', parent: -1, rest: [0, 0, 0] },
  { name: 'hips', parent: 0, rest: [0, 0.95, 0] },
  { name: 'spine', parent: 1, rest: [0, 1.05, 0] },
  { name: 'chest', parent: 2, rest: [0, 1.25, 0] },
  { name: 'head', parent: 3, rest: [0, 1.48, 0] },
  { name: 'upperArm_L', parent: 3, rest: [-0.22, 1.42, 0] },
  { name: 'lowerArm_L', parent: 5, rest: [-0.22, 1.14, 0] },
  { name: 'upperArm_R', parent: 3, rest: [0.22, 1.42, 0] },
  { name: 'lowerArm_R', parent: 7, rest: [0.22, 1.14, 0] },
  { name: 'upperLeg_L', parent: 1, rest: [-0.1, 0.92, 0] },
  { name: 'lowerLeg_L', parent: 9, rest: [-0.1, 0.5, 0] },
  { name: 'upperLeg_R', parent: 1, rest: [0.1, 0.92, 0] },
  { name: 'lowerLeg_R', parent: 11, rest: [0.1, 0.5, 0] },
];

const UPPER_ARM = 0.28;
const FOREARM_TO_HAND = 0.265;
const THIGH = 0.42;
const SHIN_TO_SOLE = 0.5;

export function boneIndex(name: BoneName): number {
  const index = BONES.findIndex((bone) => bone.name === name);
  if (index < 0) throw new Error(`Unknown bone ${name}`);
  return index;
}

function boneRest(name: BoneName): Vec3 {
  const bone = BONES[boneIndex(name)];
  if (!bone) throw new Error(`Unknown bone ${name}`);
  return bone.rest;
}

export interface BodySpec {
  skin: Rgb;
  hair: Rgb;
  eye: Rgb;
  shirt: Rgb;
  shirtDark: Rgb;
  pants: Rgb;
  shoe: Rgb;
  sole: Rgb;
  /** Extra rigid parts (backpack, apron, cap...). Use `bone` to attach. */
  extras?: (builder: MeshBuilder) => void;
}

/** Faceted low-poly body, rigidly skinned (one joint per vertex). */
export function buildBody(spec: BodySpec): MeshBuilder {
  const b = new MeshBuilder();
  const down: Vec3 = [Math.PI, 0, 0];
  const limb = (bone: BoneName, length: number, radiusAtJoint: number, radiusAtEnd: number, color: Rgb) =>
    b.frustum(
      { radiusBottom: radiusAtJoint, radiusTop: radiusAtEnd, height: length, segments: 6 },
      { at: boneRest(bone), rot: down, color, bone: boneIndex(bone) },
    );

  b.box([0.32, 0.17, 0.2], { at: [0, 0.94, 0], color: spec.pants, bone: boneIndex('hips') });
  b.box([0.33, 0.2, 0.2], { at: [0, 1.12, 0], color: spec.shirt, bone: boneIndex('spine') });
  b.box([0.4, 0.26, 0.23], { at: [0, 1.33, 0], color: spec.shirt, bone: boneIndex('chest') });
  b.box([0.26, 0.05, 0.2], { at: [0, 1.47, 0.02], color: spec.shirtDark, bone: boneIndex('chest') });

  const head = boneIndex('head');
  b.frustum({ radiusBottom: 0.055, radiusTop: 0.05, height: 0.09, segments: 6, capBottom: false, capTop: false }, {
    at: [0, 1.45, 0],
    color: spec.skin,
    bone: head,
  });
  b.blob({ radius: 0.13, stretch: [0.95, 1.05, 1], subdivide: true }, { at: [0, 1.62, 0], color: spec.skin, bone: head });
  b.blob({ radius: 0.137, stretch: [1, 0.62, 1.02], subdivide: true }, { at: [0, 1.69, 0.012], color: spec.hair, bone: head });
  b.box([0.035, 0.045, 0.02], { at: [0.05, 1.635, -0.122], color: spec.eye, bone: head });
  b.box([0.035, 0.045, 0.02], { at: [-0.05, 1.635, -0.122], color: spec.eye, bone: head });

  for (const side of ['L', 'R'] as const) {
    const x = side === 'R' ? 0.22 : -0.22;
    limb(`upperArm_${side}`, UPPER_ARM, 0.062, 0.055, spec.shirt);
    limb(`lowerArm_${side}`, 0.22, 0.052, 0.045, spec.shirt);
    b.box([0.075, 0.09, 0.085], { at: [x, 0.875, 0], color: spec.skin, bone: boneIndex(`lowerArm_${side}`) });

    const legX = side === 'R' ? 0.1 : -0.1;
    limb(`upperLeg_${side}`, THIGH, 0.082, 0.07, spec.pants);
    limb(`lowerLeg_${side}`, 0.42, 0.066, 0.056, spec.pants);
    const shin = boneIndex(`lowerLeg_${side}`);
    b.box([0.12, 0.08, 0.25], { at: [legX, 0.05, -0.04], color: spec.shoe, bone: shin });
    b.box([0.125, 0.025, 0.255], { at: [legX, 0.0125, -0.04], color: spec.sole, bone: shin });
  }

  spec.extras?.(b);
  return b;
}

// --- Karakter yang bisa dikustomisasi (NEXT_FEATURES 9.3) ---------------------------------------
// Satu GLB per gender berisi semua varian sebagai node mesh terpisah; runtime hanya menyalakan
// node terpilih. Bagian ber-slot (rambut/baju/celana) dibangun dengan vertex colour abu-abu:
// warnanya datang dari material yang di-clone runtime, jadi palet bisa diubah tanpa rebuild aset.
// ponytail: pratinjau PNG di asset-previews jadi abu-abu untuk bagian ber-slot dan menampilkan
// semua varian sekaligus; kalau perlu pratinjau per kombinasi, render per node di build.ts.

export type Gender = 'm' | 'f';

/** Vertex colour bagian ber-slot: hanya faktor bayangan, hue dari material runtime. */
const shade = (factor: number): Rgb => {
  const v = Math.min(1, factor);
  return [v, v, v];
};

export type Slot = 'skin' | 'hair' | 'shirt' | 'pants';

export interface CharacterPart {
  name: string;
  builder: MeshBuilder;
  /** Slot material; tanpa slot = material palet biasa. */
  slot?: Slot;
  /** Atribut `_TINT` per vertex (lihat lib/gltf.ts tintRegions). */
  tint?: number[];
}

const DOWN: Vec3 = [Math.PI, 0, 0];

/** `armX` = jarak bahu dari sumbu tengah untuk rig per gender (lihat rigFor); hanya dipakai tulang lengan. */
function limb(b: MeshBuilder, bone: BoneName, height: number, radiusBottom: number, radiusTop: number, color: Rgb, lift = 0, armX?: number): void {
  const rest = boneRest(bone);
  const x = armX !== undefined && bone.includes('Arm') ? Math.sign(rest[0]) * armX : rest[0];
  b.frustum(
    { radiusBottom, radiusTop, height, segments: 6 },
    { at: [x, rest[1] - lift, rest[2]], rot: DOWN, color, bone: boneIndex(bone) },
  );
}

/**
 * Proporsi per gender. Rig (BONES) sama untuk keduanya supaya semua klip bisa dipakai bersama;
 * beda bentuk murni dari geometri. Wanita: bahu jauh lebih sempit, pinggang kecil, pinggul lebih
 * lebar dari bahu, leher dan anggota badan lebih tipis, sepatu lebih kecil, torso berdada.
 */
export interface Figure {
  /** Setengah lebar X bahu/dada (baju). */
  shoulder: number;
  chestDepth: number;
  /** Setengah lebar X pinggang. */
  waistX: number;
  waistZ: number;
  /** Setengah lebar X panggul (celana). */
  hipX: number;
  hipZ: number;
  neck: number;
  armUpper: number;
  armLower: number;
  legUpper: number;
  legLower: number;
  /** Radius tonjolan dada; 0 = rata. */
  bust: number;
  /** Peregangan blob kepala (wanita: lebih sempit dan lebih lonjong = rahang lebih halus). */
  headStretch: Vec3;
  shoe: Vec3;
  /** Jarak X tulang bahu/lengan dari tengah. Pria 0.22 (= BONES), wanita lebih sempit. */
  armX: number;
}

export const FIGURES: Record<Gender, Figure> = {
  m: {
    shoulder: 0.205,
    chestDepth: 0.115,
    waistX: 0.15,
    waistZ: 0.093,
    hipX: 0.148,
    hipZ: 0.088,
    neck: 0.057,
    armUpper: 0.057,
    armLower: 0.047,
    legUpper: 0.073,
    legLower: 0.058,
    bust: 0,
    headStretch: [0.97, 1.03, 1],
    shoe: [0.125, 0.08, 0.26],
    armX: 0.22,
  },
  f: {
    shoulder: 0.15,
    chestDepth: 0.102,
    waistX: 0.112,
    waistZ: 0.075,
    hipX: 0.152,
    hipZ: 0.085,
    neck: 0.044,
    armUpper: 0.046,
    armLower: 0.038,
    legUpper: 0.066,
    legLower: 0.05,
    bust: 0.058,
    headStretch: [0.91, 1.07, 0.97],
    shoe: [0.098, 0.062, 0.215],
    armX: 0.19,
  },
};

/**
 * Rig per gender: sama dengan BONES kecuali posisi X lengan (bahu wanita lebih sempit). Klip hanya
 * berisi rotasi + translasi hips, dan IK sepeda hanya memakai Y/Z bahu, jadi semua klip tetap cocok.
 */
export function rigFor(gender: Gender): BoneDef[] {
  const armX = FIGURES[gender].armX;
  return BONES.map((bone) => (bone.name.includes('Arm') ? { ...bone, rest: [Math.sign(bone.rest[0]) * armX, bone.rest[1], bone.rest[2]] } : bone));
}

/** Sepatu + mata: bagian yang warnanya tetap (bukan slot), jadi node dasar pemegang skeleton. */
function baseBody(gender: Gender, spec: Pick<BodySpec, 'eye' | 'shoe' | 'sole'>): MeshBuilder {
  const b = new MeshBuilder();
  const f = FIGURES[gender];
  const head = boneIndex('head');
  // Mata: putih + pupil, supaya wajah terbaca dari kamera game.
  for (const x of [0.052, -0.052]) {
    b.box([0.05, 0.034, 0.016], { at: [x, 1.636, -0.121], color: PALETTE.white, bone: head });
    b.box([0.026, 0.026, 0.016], { at: [x, 1.633, -0.126], color: spec.eye, bone: head });
  }

  for (const side of ['L', 'R'] as const) {
    const legX = side === 'R' ? 0.1 : -0.1;
    const shin = boneIndex(`lowerLeg_${side}`);
    const [sx, sy, sz] = f.shoe;
    // Sepatu bertingkat (bukan sekadar kotak): bagian depan lebih rendah + sol tipis di y = 0.
    b.box([sx, sy, sz * 0.62], { at: [legX, 0.025 + sy / 2, -0.04 + sz * 0.17], color: spec.shoe, bone: shin });
    b.box([sx * 0.92, sy * 0.62, sz * 0.46], { at: [legX, 0.025 + sy * 0.31, -0.04 - sz * 0.27], color: spec.shoe, bone: shin });
    b.box([sx * 1.04, 0.025, sz], { at: [legX, 0.0125, -0.04], color: spec.sole, bone: shin });
    if (gender === 'f') {
      // Hak kecil di belakang: siluet sepatu wanita lebih ramping dan tidak kotak.
      b.box([sx * 0.7, 0.03, sz * 0.2], { at: [legX, 0.04, -0.04 + sz * 0.38], color: spec.sole, bone: shin });
    }
  }
  return b;
}

/** Kulit: kepala, leher, telinga, lengan, tangan, kaki. Slot `skin` = warna kulit bisa dipilih. */
function skinPart(gender: Gender): MeshBuilder {
  const b = new MeshBuilder();
  const f = FIGURES[gender];
  const head = boneIndex('head');
  b.frustum({ radiusBottom: f.neck, radiusTop: f.neck * 0.9, height: 0.1, segments: 6, capBottom: false, capTop: false }, {
    at: [0, 1.44, 0],
    color: shade(1),
    bone: head,
  });
  b.blob({ radius: 0.13, stretch: f.headStretch, subdivide: true }, { at: [0, 1.62, 0], color: shade(1), bone: head });
  // Hidung + telinga: profil samping tidak lagi bulat polos.
  b.box([0.026, 0.038, 0.03], { at: [0, 1.605, -0.124], color: shade(0.95), bone: head });
  for (const x of [0.123, -0.123]) b.box([0.018, 0.05, 0.035], { at: [x * f.headStretch[0], 1.615, 0.005], color: shade(0.93), bone: head });

  for (const side of ['L', 'R'] as const) {
    const x = side === 'R' ? f.armX : -f.armX;
    limb(b, `upperArm_${side}`, UPPER_ARM, f.armUpper, f.armLower * 1.02, shade(1), 0, f.armX);
    limb(b, `lowerArm_${side}`, 0.22, f.armLower, f.armLower * 0.86, shade(1), 0, f.armX);
    b.box([f.armLower * 1.55, 0.09, 0.08], { at: [x, 0.875, 0], color: shade(1), bone: boneIndex(`lowerArm_${side}`) });

    limb(b, `upperLeg_${side}`, THIGH, f.legUpper, f.legLower * 1.06, shade(1));
    limb(b, `lowerLeg_${side}`, 0.42, f.legLower, f.legLower * 0.84, shade(1));
  }
  return b;
}

/** Aksesori bawaan per gender: jam tangan (pria) / giwang (wanita). Selalu terlihat. */
function trinketPart(gender: Gender): MeshBuilder {
  const b = new MeshBuilder();
  if (gender === 'm') {
    const wrist = boneIndex('lowerArm_L');
    b.box([0.05, 0.03, 0.055], { at: [-0.22, 0.935, 0], color: PALETTE.metalDark, bone: wrist });
    b.box([0.03, 0.012, 0.03], { at: [-0.244, 0.935, 0], color: PALETTE.metalLight, bone: wrist });
  } else {
    const head = boneIndex('head');
    for (const x of [0.118, -0.118]) b.box([0.016, 0.03, 0.016], { at: [x, 1.585, 0.005], color: PALETTE.gold, bone: head });
  }
  return b;
}

/** Setengah-lebar badan tiap gaya: dipakai cek tembus (baju harus melingkupi pinggang celana). */
interface Clothing {
  name: string;
  builder: MeshBuilder;
  /** Setengah ukuran X/Z pada pinggang. */
  waist: [number, number];
}

/**
 * Torso berpinggang: tiga ruas (pinggang -> perut -> dada) supaya siluet wanita mengecil di
 * pinggang dan melebar di dada/panggul, bukan satu kotak lurus seperti versi lama.
 */
function torso(b: MeshBuilder, f: Figure, hemY: number, pad: number): void {
  const spine = boneIndex('spine');
  const chest = boneIndex('chest');
  const waistX = f.waistX + pad;
  const waistZ = f.waistZ + pad;
  const shoulder = f.shoulder + pad;
  const depth = f.chestDepth + pad;

  // Pinggang (hem baju -> 1.14): ruas tersempit.
  b.box([waistX * 2, 1.14 - hemY, waistZ * 2], { at: [0, (hemY + 1.14) / 2, 0], color: shade(1), bone: spine });
  // Peralihan ke dada.
  const midX = (waistX + shoulder) / 2;
  const midZ = (waistZ + depth) / 2;
  b.box([midX * 2, 0.1, midZ * 2], { at: [0, 1.19, 0], color: shade(1), bone: spine });
  // Dada/bahu.
  b.box([shoulder * 2, 0.26, depth * 2], { at: [0, 1.33, 0], color: shade(1), bone: chest });
  b.box([shoulder * 1.3, 0.05, depth * 1.75], { at: [0, 1.47, 0.02], color: shade(0.8), bone: chest });
  if (f.bust > 0) {
    for (const x of [0.062, -0.062]) {
      b.blob({ radius: f.bust, stretch: [1, 0.82, 0.95] }, { at: [x, 1.335, -depth * 0.8], color: shade(1), bone: chest });
    }
  }
}

/** Garis pinggang: pita tipis di ruas tersempit, menegaskan siluet jam pasir dari kamera game. */
function waistband(b: MeshBuilder, f: Figure, pad: number): void {
  const x = f.waistX + pad + 0.004;
  const z = f.waistZ + pad + 0.004;
  b.box([x * 2, 0.05, z * 2], { at: [0, 1.1, 0], color: shade(0.6), bone: boneIndex('spine') });
}

function sleeves(b: MeshBuilder, f: Figure, long: boolean): void {
  for (const side of ['L', 'R'] as const) {
    limb(b, `upperArm_${side}`, long ? UPPER_ARM : 0.14, f.armUpper + 0.013, (long ? f.armLower : f.armUpper) + 0.008, shade(1), 0, f.armX);
    if (long) limb(b, `lowerArm_${side}`, 0.19, f.armLower + 0.01, f.armLower * 0.9 + 0.008, shade(1), 0, f.armX);
  }
}

function shirtParts(gender: Gender): Clothing[] {
  const f = FIGURES[gender];
  const spine = boneIndex('spine');
  const chest = boneIndex('chest');
  const waistOf = (pad: number): [number, number] => [f.waistX + pad, f.waistZ + pad];

  // 0: kaos (pria lengan pendek lurus, wanita potongan pendek dengan tali tipis di bahu).
  const kaos = new MeshBuilder();
  torso(kaos, f, 1.02, 0.015);
  sleeves(kaos, f, false);
  if (gender === 'f') {
    kaos.box([f.shoulder * 1.1, 0.03, 0.05], { at: [0, 1.46, -f.chestDepth * 0.6], color: shade(0.88), bone: chest });
    waistband(kaos, f, 0.015);
  } else {
    kaos.box([0.16, 0.05, 0.02], { at: [0, 1.28, -f.chestDepth - 0.03], color: shade(0.82), bone: chest });
  }

  // 1: hoodie/cardigan.
  const hoodie = new MeshBuilder();
  torso(hoodie, f, 1.0, 0.024);
  sleeves(hoodie, f, true);
  hoodie.blob({ radius: 0.115, stretch: [1.05, 0.65, 0.78] }, { at: [0, 1.48, 0.1], color: shade(0.85), bone: chest });
  if (gender === 'f') waistband(hoodie, f, 0.024);
  else hoodie.box([0.22, 0.1, 0.03], { at: [0, 1.13, -(f.waistZ + 0.05)], color: shade(0.8), bone: spine });

  // 2: kemeja (pria: kerah + placket) / blus (wanita: kerah V + lengan balon).
  const kemeja = new MeshBuilder();
  torso(kemeja, f, 0.98, 0.032);
  sleeves(kemeja, f, true);
  kemeja.box([0.035, 0.22, 0.02], { at: [0, 1.12, -(f.waistZ + 0.055)], color: shade(0.85), bone: spine });
  if (gender === 'f') {
    for (const x of [0.055, -0.055]) {
      kemeja.box([0.05, 0.11, 0.02], { at: [x, 1.42, -(f.chestDepth + 0.05)], color: shade(0.92), bone: chest });
    }
    kemeja.box([f.shoulder * 1.6, 0.05, 0.1], { at: [0, 1.44, -0.03], color: shade(0.9), bone: chest });
    waistband(kemeja, f, 0.032);
  } else {
    kemeja.box([0.19, 0.06, 0.1], { at: [0, 1.45, -0.055], color: shade(0.9), bone: chest });
    // Tas selempang: detail khas pria, melintang dari bahu ke pinggang.
    kemeja.box([0.3, 0.045, 0.03], { at: [0, 1.36, -(f.chestDepth + 0.04)], color: shade(0.7), bone: chest });
  }

  return [
    { name: 'shirt_0', builder: kaos, waist: waistOf(0.015) },
    { name: 'shirt_1', builder: hoodie, waist: waistOf(0.024) },
    { name: 'shirt_2', builder: kemeja, waist: waistOf(0.032) },
  ];
}

function hips(b: MeshBuilder, f: Figure): void {
  b.box([f.hipX * 2, 0.17, f.hipZ * 2], { at: [0, 0.94, 0], color: shade(1), bone: boneIndex('hips') });
}

function pantsParts(gender: Gender): Clothing[] {
  const f = FIGURES[gender];
  // Pinggang celana selalu di dalam badan baju (cek tembus di buildCustomCharacter).
  const waist: [number, number] = [f.waistX, f.waistZ];

  const jeans = new MeshBuilder();
  hips(jeans, f);
  const pendek = new MeshBuilder();
  hips(pendek, f);
  const ketiga = new MeshBuilder();
  hips(ketiga, f);

  for (const side of ['L', 'R'] as const) {
    limb(jeans, `upperLeg_${side}`, THIGH, f.legUpper + 0.014, f.legLower + 0.016, shade(1));
    limb(jeans, `lowerLeg_${side}`, 0.4, f.legLower + 0.013, f.legLower + 0.004, shade(1));
    limb(pendek, `upperLeg_${side}`, gender === 'f' ? 0.2 : 0.24, f.legUpper + 0.017, f.legUpper + 0.008, shade(1));
    if (gender === 'm') {
      // Jogger: pipa kaki + karet di pergelangan.
      limb(ketiga, `upperLeg_${side}`, THIGH, f.legUpper + 0.017, f.legLower + 0.019, shade(1));
      limb(ketiga, `lowerLeg_${side}`, 0.34, f.legLower + 0.016, f.legLower, shade(1));
      limb(ketiga, `lowerLeg_${side}`, 0.08, f.legLower + 0.004, f.legLower, shade(0.85), 0.34);
    }
  }
  if (gender === 'f') {
    // Rok A-line: kerucut terbalik dari panggul ke atas lutut, dipasang di tulang hips.
    ketiga.frustum({ radiusBottom: 0.235, radiusTop: f.hipX + 0.02, height: 0.3, segments: 8, capTop: false }, {
      at: [0, 0.6, 0],
      color: shade(1),
      bone: boneIndex('hips'),
    });
    ketiga.frustum({ radiusBottom: 0.238, radiusTop: 0.228, height: 0.035, segments: 8, capTop: false, capBottom: false }, {
      at: [0, 0.6, 0],
      color: shade(0.86),
      bone: boneIndex('hips'),
    });
  }

  return [
    { name: 'pants_0', builder: jeans, waist },
    { name: 'pants_1', builder: pendek, waist },
    { name: 'pants_2', builder: ketiga, waist },
  ];
}

/** Gaya rambut: 3 per gender. `hair_0..2`, semua memakai slot warna `hair`. */
function hairParts(gender: Gender): MeshBuilder[] {
  const head = boneIndex('head');
  const cap = (b: MeshBuilder, lift = 0, scale = 1): void => {
    b.blob({ radius: 0.137 * scale, stretch: [1, 0.62, 1.02], subdivide: true }, { at: [0, 1.69 + lift, 0.012], color: shade(1), bone: head });
    // Tengkuk: menutup belakang kepala sampai bawah garis rambut, supaya dari samping tidak ada
    // bidang kulit polos di antara rambut dan leher.
    b.box([0.2 * scale, 0.14, 0.09], { at: [0, 1.605 + lift, 0.082], color: shade(0.9), bone: head });
  };

  if (gender === 'm') {
    const cepak = new MeshBuilder();
    cap(cepak, 0, 0.99);
    cepak.box([0.2, 0.03, 0.08], { at: [0, 1.714, -0.1], color: shade(0.93), bone: head });

    const belah = new MeshBuilder();
    cap(belah);
    // Belah samping: satu sisi lebih tebal dan menjuntai ke dahi.
    belah.box([0.13, 0.055, 0.1], { at: [0.055, 1.73, -0.085], color: shade(0.95), bone: head });
    belah.box([0.07, 0.11, 0.06], { at: [-0.115, 1.68, -0.05], color: shade(0.9), bone: head });

    const jambul = new MeshBuilder();
    cap(jambul);
    jambul.box([0.15, 0.1, 0.1], { at: [0, 1.765, -0.06], color: shade(1), bone: head });
    jambul.box([0.11, 0.06, 0.07], { at: [0, 1.8, -0.035], color: shade(0.97), bone: head });
    return [cepak, belah, jambul];
  }

  // Wanita: tiga gaya panjang yang jelas berbeda dari rambut cepak pria.
  const bob = new MeshBuilder();
  cap(bob, 0.004, 1.03);
  bob.box([0.27, 0.22, 0.2], { at: [0, 1.6, 0.04], color: shade(0.94), bone: head });
  for (const x of [0.13, -0.13]) bob.box([0.055, 0.2, 0.17], { at: [x, 1.6, -0.01], color: shade(0.97), bone: head });
  bob.box([0.2, 0.045, 0.06], { at: [0, 1.735, -0.095], color: shade(1), bone: head });

  const ponytail = new MeshBuilder();
  cap(ponytail, 0.004, 1.02);
  ponytail.box([0.24, 0.12, 0.14], { at: [0, 1.655, 0.07], color: shade(0.93), bone: head });
  ponytail.blob({ radius: 0.062, stretch: [1, 1.1, 1] }, { at: [0, 1.655, 0.145], color: shade(0.88), bone: head });
  // Ekor kuda menjuntai ke belakang-bawah.
  ponytail.frustum({ radiusBottom: 0.032, radiusTop: 0.055, height: 0.34, segments: 6 }, {
    at: [0, 1.33, 0.165],
    rot: [deg(-14), 0, 0],
    color: shade(1),
    bone: head,
  });
  ponytail.box([0.17, 0.05, 0.05], { at: [0, 1.74, -0.09], color: shade(1), bone: head });
  // Helai samping sampai rahang: dari depan ekor kuda tidak terlihat, jadi wajah tetap dibingkai rambut.
  for (const x of [0.118, -0.118]) ponytail.box([0.04, 0.26, 0.055], { at: [x, 1.555, -0.07], color: shade(0.97), bone: head });

  const panjang = new MeshBuilder();
  cap(panjang, 0.004, 1.03);
  // Tirai rambut panjang sampai punggung tengah (tulang chest) + helai depan di dua sisi.
  panjang.box([0.28, 0.2, 0.19], { at: [0, 1.61, 0.045], color: shade(0.95), bone: head });
  panjang.box([0.26, 0.3, 0.1], { at: [0, 1.37, 0.095], color: shade(0.9), bone: boneIndex('chest') });
  panjang.box([0.22, 0.09, 0.08], { at: [0, 1.2, 0.08], color: shade(0.84), bone: boneIndex('chest') });
  for (const x of [0.125, -0.125]) panjang.box([0.06, 0.34, 0.14], { at: [x, 1.52, -0.015], color: shade(0.99), bone: head });
  return [bob, ponytail, panjang];
}

/**
 * Ekspresi: alis + mulut (+ bulu mata dan bibir berwarna untuk wanita) di depan kepala.
 * 0 = senyum, 1 = datar, 2 = ceria.
 */
function facePart(index: number, gender: Gender, line: Rgb, lip: Rgb): MeshBuilder {
  const b = new MeshBuilder();
  const head = boneIndex('head');
  const female = gender === 'f';
  const browY = index === 2 ? 1.678 : index === 1 ? 1.666 : 1.671;
  const browW = female ? 0.042 : 0.05;
  const browH = female ? 0.009 : 0.015;
  for (const x of [0.052, -0.052]) {
    b.box([browW, browH, 0.015], { at: [x, browY, -0.126], color: line, bone: head });
    // Bulu mata: garis halus di atas mata, hanya wanita (mata terlihat lebih besar dan lembut).
    if (female) b.box([0.052, 0.008, 0.014], { at: [x, 1.651, -0.128], color: line, bone: head });
  }
  const mouth = female ? lip : line;
  if (index === 1) {
    b.box([female ? 0.042 : 0.055, female ? 0.016 : 0.012, 0.015], { at: [0, 1.57, -0.127], color: mouth, bone: head });
  } else if (index === 0) {
    b.box([female ? 0.03 : 0.035, female ? 0.016 : 0.012, 0.015], { at: [0, 1.566, -0.127], color: mouth, bone: head });
    for (const x of [0.024, -0.024]) b.box([0.015, female ? 0.015 : 0.012, 0.014], { at: [x, 1.575, -0.125], color: mouth, bone: head });
  } else {
    b.box([female ? 0.048 : 0.055, female ? 0.03 : 0.035, 0.015], { at: [0, 1.567, -0.127], color: mouth, bone: head });
  }
  // Pipi merona: menegaskan wajah wanita dari kamera game.
  if (female) for (const x of [0.085, -0.085]) b.box([0.032, 0.018, 0.012], { at: [x, 1.6, -0.112], color: lip, bone: head });
  return b;
}

/** Aksesori pilihan: 1 = kacamata, 2 = topi. Index 0 = tanpa aksesori (tidak ada node). */
function accessoryParts(gender: Gender): MeshBuilder[] {
  const head = boneIndex('head');

  const kacamata = new MeshBuilder();
  for (const x of [0.052, -0.052]) {
    kacamata.box([0.058, 0.042, 0.012], { at: [x, 1.636, -0.132], color: PALETTE.lens, bone: head });
    kacamata.box([0.064, 0.048, 0.006], { at: [x, 1.636, -0.137], color: PALETTE.cap, bone: head });
  }
  kacamata.box([0.03, 0.008, 0.008], { at: [0, 1.636, -0.134], color: PALETTE.cap, bone: head });
  for (const x of [0.105, -0.105]) kacamata.box([0.01, 0.008, 0.1], { at: [x, 1.636, -0.085], color: PALETTE.cap, bone: head });

  const topi = new MeshBuilder();
  if (gender === 'm') {
    topi.frustum({ radiusBottom: 0.142, radiusTop: 0.118, height: 0.085, segments: 8 }, { at: [0, 1.7, 0.012], color: PALETTE.cap, bone: head });
    topi.box([0.2, 0.022, 0.13], { at: [0, 1.705, -0.165], color: PALETTE.cap, bone: head });
  } else {
    // Topi bucket bertepi lebar + pita: jelas berbeda dari topi bisbol pria.
    topi.frustum({ radiusBottom: 0.145, radiusTop: 0.12, height: 0.08, segments: 8 }, { at: [0, 1.715, 0.012], color: PALETTE.white, bone: head });
    topi.frustum({ radiusBottom: 0.23, radiusTop: 0.148, height: 0.03, segments: 10, capTop: false }, { at: [0, 1.705, 0.012], color: PALETTE.white, bone: head });
    topi.frustum({ radiusBottom: 0.15, radiusTop: 0.148, height: 0.022, segments: 8, capTop: false, capBottom: false }, { at: [0, 1.735, 0.012], color: PALETTE.lip, bone: head });
  }
  return [kacamata, topi];
}

/**
 * GLB kustomisasi: node dasar (sepatu/mata) + kulit + 3 rambut + 3 baju + 3 celana + 3 ekspresi +
 * 2 aksesori sebagai node terpisah. Melempar error (dilaporkan validator `npm run assets`) kalau
 * ada kombinasi baju x celana yang saling menembus atau budget segitiga terlampaui.
 * ponytail: cek tembus memakai aturan "pinggang celana harus di dalam badan baju" di XZ, bukan uji
 * potong per pose. Rok memakai pinggang yang sama dengan celana, jadi aturan ini masih berlaku.
 */
export function buildCustomCharacter(
  id: string,
  gender: Gender,
  body: Pick<BodySpec, 'skin' | 'eye' | 'shoe' | 'sole'>,
  slotColors: Record<Slot, Rgb>,
  clips: Clip[],
): Document {
  const shirts = shirtParts(gender);
  const pants = pantsParts(gender);
  for (const shirt of shirts) {
    for (const trouser of pants) {
      const gapX = shirt.waist[0] - trouser.waist[0];
      const gapZ = shirt.waist[1] - trouser.waist[1];
      if (gapX < 0.01 || gapZ < 0.005) {
        throw new Error(`${shirt.name} x ${trouser.name} menembus di pinggang (gap ${gapX.toFixed(3)}/${gapZ.toFixed(3)} m)`);
      }
    }
  }

  const base = baseBody(gender, body);
  const skin = skinPart(gender);
  const trinket = trinketPart(gender);
  const hairs = hairParts(gender);
  const faces = [0, 1, 2].map((i) => facePart(i, gender, body.eye, PALETTE.lip));
  const accessories = accessoryParts(gender);
  // Perhiasan bawaan ikut node dasar (warna tetap, selalu terlihat) supaya draw call tidak naik.
  for (let i = 0; i < trinket.positions.length; i += 3) {
    base.positions.push(trinket.positions[i] ?? 0, trinket.positions[i + 1] ?? 0, trinket.positions[i + 2] ?? 0);
  }
  base.normals.push(...trinket.normals);
  base.colors.push(...trinket.colors);
  base.joints.push(...trinket.joints);
  const offset = (base.positions.length - trinket.positions.length) / 3;
  base.indices.push(...trinket.indices.map((index) => index + offset));

  const parts: CharacterPart[] = [
    { name: id, builder: base },
    { name: 'skin', builder: skin, slot: 'skin' },
    ...hairs.map((builder, i): CharacterPart => ({ name: `hair_${i}`, builder, slot: 'hair' })),
    ...shirts.map((s): CharacterPart => ({ name: s.name, builder: s.builder, slot: 'shirt' })),
    ...pants.map((p): CharacterPart => ({ name: p.name, builder: p.builder, slot: 'pants' })),
    ...faces.map((builder, i): CharacterPart => ({ name: `face_${i}`, builder })),
    ...accessories.map((builder, i): CharacterPart => ({ name: `acc_${i + 1}`, builder })),
  ];

  const total = parts.reduce((sum, part) => sum + part.builder.triangleCount, 0);
  const biggest = (list: MeshBuilder[]) => Math.max(...list.map((item) => item.triangleCount));
  const visible =
    base.triangleCount +
    skin.triangleCount +
    biggest(hairs) +
    biggest(shirts.map((s) => s.builder)) +
    biggest(pants.map((p) => p.builder)) +
    biggest(faces) +
    biggest(accessories);
  // Batas naik dari 3500/2000: node varian bertambah dari 11 ke 16 (3 rambut, rok, 2 aksesori).
  if (total > 5000) throw new Error(`Total segitiga ${total} > 5000`);
  if (visible > 2600) throw new Error(`Segitiga terlihat ${visible} > 2600`);

  return buildRigDocument(id, rigFor(gender), boneIndex('hips'), parts, clips, slotColors);
}

export interface Pose {
  /** Local Euler rotations (radians, XYZ). Missing bones stay at rest. */
  rot: Partial<Record<BoneName, Vec3>>;
  /** Offset added to the hips rest position. */
  hips?: Vec3;
}

export interface Clip {
  name: string;
  duration: number;
  /** `phase` in [0, 1); clips must be periodic so the last key equals the first (seamless loop). */
  pose: (phase: number) => Pose;
}

const TAU = Math.PI * 2;
const rx = (angle: number): Vec3 => [angle, 0, 0];

export const IDLE: Clip = {
  name: 'anim_Idle',
  duration: ANIM.idleCycle,
  pose: (p) => {
    const s = Math.sin(TAU * p);
    return {
      rot: {
        chest: rx(deg(1.5 * s)),
        head: [deg(-1 * s), deg(4 * Math.sin(TAU * p + 1)), 0],
        upperArm_L: [0, 0, deg(-5 - s)],
        upperArm_R: [0, 0, deg(5 + s)],
        lowerArm_L: rx(deg(8)),
        lowerArm_R: rx(deg(8)),
      },
      hips: [0, 0.004 * s, 0],
    };
  },
};

export const WALK: Clip = {
  name: 'anim_Walk',
  duration: ANIM.walkCycle,
  pose: (p) => {
    const a = TAU * p;
    const s = Math.sin(a);
    const c = Math.cos(a);
    return {
      rot: {
        upperLeg_R: rx(deg(28 * s)),
        upperLeg_L: rx(deg(-28 * s)),
        lowerLeg_R: rx(deg(-5 - 40 * Math.max(0, c))),
        lowerLeg_L: rx(deg(-5 - 40 * Math.max(0, -c))),
        upperArm_R: [deg(-22 * s), 0, deg(4)],
        upperArm_L: [deg(22 * s), 0, deg(-4)],
        lowerArm_R: rx(deg(18)),
        lowerArm_L: rx(deg(18)),
        spine: [deg(-3), deg(-5 * s), 0],
      },
      hips: [0, 0.02 * Math.cos(2 * a) - 0.02, 0],
    };
  },
};

export const RUN: Clip = {
  name: 'anim_Run',
  duration: ANIM.runCycle,
  pose: (p) => {
    const a = TAU * p;
    const s = Math.sin(a);
    const c = Math.cos(a);
    return {
      rot: {
        upperLeg_R: rx(deg(45 * s)),
        upperLeg_L: rx(deg(-45 * s)),
        lowerLeg_R: rx(deg(-25 - 60 * Math.max(0, c))),
        lowerLeg_L: rx(deg(-25 - 60 * Math.max(0, -c))),
        upperArm_R: [deg(-45 * s), 0, deg(6)],
        upperArm_L: [deg(45 * s), 0, deg(-6)],
        lowerArm_R: rx(deg(75)),
        lowerArm_L: rx(deg(75)),
        spine: [deg(-12), deg(-8 * s), 0],
        head: rx(deg(8)),
      },
      hips: [0, 0.04 * Math.cos(2 * a) - 0.05, 0],
    };
  },
};

/** Riding stance on the deck: legs solved with IK so both soles stay on SKATE.deckTopY. */
export const SKATE_RIDE: Clip = {
  name: 'anim_Skate',
  duration: ANIM.skateCycle,
  pose: (p) => {
    const a = TAU * p;
    const s = Math.sin(a);
    const hips: Vec3 = [0.02 * s, 0.05 + 0.01 * Math.sin(2 * a), 0];
    const hipY = boneRest('upperLeg_R')[1] + hips[1];
    const right = solveTwoBone({ y: hipY, z: hips[2] }, { y: SKATE.deckTopY, z: -0.17 }, THIGH, SHIN_TO_SOLE, true);
    const left = solveTwoBone({ y: hipY, z: hips[2] }, { y: SKATE.deckTopY, z: 0.15 }, THIGH, SHIN_TO_SOLE, true);
    return {
      rot: {
        upperLeg_R: rx(right.upper),
        lowerLeg_R: rx(right.lower),
        upperLeg_L: rx(left.upper),
        lowerLeg_L: rx(left.lower),
        spine: [deg(-10), deg(-8), deg(-3 * s)],
        head: [deg(8), deg(8), 0],
        upperArm_R: [deg(10 * s), 0, deg(25 + 5 * s)],
        upperArm_L: [deg(-10 * s), 0, deg(-25 + 5 * s)],
        lowerArm_R: rx(deg(20)),
        lowerArm_L: rx(deg(20)),
      },
      hips,
    };
  },
};

/** Seated pedalling pose; one clip loop = one crank turn. Feet and hands are IK'd onto pedals/grips. */
export const BIKE_RIDE: Clip = {
  name: 'anim_Bike',
  duration: ANIM.bikeCycle,
  pose: (p) => {
    const hips: Vec3 = [0, BIKE.saddleTopY + 0.095 - boneRest('hips')[1], BIKE.saddleZ];
    const lean = deg(-35);
    const spineLean = lean * 0.6;
    const hipY = boneRest('upperLeg_R')[1] + hips[1];

    const leg = (crankAngle: number) => {
      const pedalY = BIKE.crankY + BIKE.crankLength * Math.sin(crankAngle);
      const pedalZ = BIKE.crankZ - BIKE.crankLength * Math.cos(crankAngle);
      return solveTwoBone({ y: hipY, z: hips[2] }, { y: pedalY + 0.02, z: pedalZ }, THIGH, SHIN_TO_SOLE, true);
    };
    const crank = -TAU * p;
    const right = leg(crank);
    const left = leg(crank + Math.PI);

    const spineY = boneRest('spine')[1] + hips[1];
    const spineZ = hips[2];
    const chestLen = boneRest('chest')[1] - boneRest('spine')[1];
    const shoulderLen = boneRest('upperArm_R')[1] - boneRest('chest')[1];
    const chestY = spineY + chestLen * Math.cos(spineLean);
    const chestZ = spineZ + chestLen * Math.sin(spineLean);
    const shoulderY = chestY + shoulderLen * Math.cos(lean);
    const shoulderZ = chestZ + shoulderLen * Math.sin(lean);
    const dy = BIKE.gripY - shoulderY;
    const dz = BIKE.gripZ - shoulderZ;
    const local = { y: dy * Math.cos(lean) + dz * Math.sin(lean), z: -dy * Math.sin(lean) + dz * Math.cos(lean) };
    const arm = solveTwoBone({ y: 0, z: 0 }, local, UPPER_ARM, FOREARM_TO_HAND, false);

    return {
      rot: {
        spine: rx(spineLean),
        chest: rx(lean - spineLean),
        head: rx(-lean * 0.8),
        upperLeg_R: rx(right.upper),
        lowerLeg_R: rx(right.lower),
        upperLeg_L: rx(left.upper),
        lowerLeg_L: rx(left.lower),
        upperArm_R: rx(arm.upper),
        lowerArm_R: rx(arm.lower),
        upperArm_L: rx(arm.upper),
        lowerArm_L: rx(arm.lower),
      },
      hips,
    };
  },
};

export const TALK: Clip = {
  name: 'anim_Talk',
  duration: ANIM.talkCycle,
  pose: (p) => {
    const a = TAU * p;
    const s = Math.sin(a);
    return {
      rot: {
        upperArm_R: [deg(45 + 8 * s), 0, deg(12)],
        lowerArm_R: rx(deg(55 + 15 * Math.sin(2 * a))),
        upperArm_L: [deg(5), 0, deg(-6)],
        lowerArm_L: rx(deg(10)),
        head: [deg(4 * Math.sin(2 * a)), deg(8 * s), 0],
        chest: rx(deg(2 * s)),
      },
      hips: [0, 0.004 * s, 0],
    };
  },
};

/** Duduk di bangku (C9/C10): panggul turun ke tinggi dudukan 0.45 m, kaki menekuk 80 derajat. */
export const SIT: Clip = {
  name: 'anim_Sit',
  duration: 3,
  pose: (p) => {
    const s = Math.sin(TAU * p);
    return {
      rot: {
        upperLeg_R: rx(deg(88)),
        upperLeg_L: rx(deg(88)),
        lowerLeg_R: rx(deg(-86)),
        lowerLeg_L: rx(deg(-86)),
        spine: rx(deg(-4 + 1.5 * s)),
        chest: rx(deg(2 * s)),
        head: [deg(2 * s), deg(5 * Math.sin(TAU * p + 1)), 0],
        upperArm_R: [deg(18), 0, deg(7)],
        upperArm_L: [deg(18), 0, deg(-7)],
        lowerArm_R: rx(deg(35)),
        lowerArm_L: rx(deg(35)),
      },
      // Panggul turun ke tinggi dudukan; telapak kaki tetap menyentuh tanah (y ~ 0).
      hips: [0, -0.43, 0],
    };
  },
};

const ANIMATION_FPS = 30;

/** Builds a skinned GLB document: joints, inverse bind matrices, mesh, and sampled looping clips. */
export function buildCharacterDocument(id: string, body: BodySpec, clips: Clip[]): Document {
  return buildSkinnedDocument(id, [{ name: id, builder: buildBody(body) }], clips);
}

/** Satu node mesh ber-skin per part, semua memakai skin yang sama. Slot material diberi warna bawaan (pratinjau). */
function buildSkinnedDocument(id: string, parts: CharacterPart[], clips: Clip[], slotColors?: Record<Slot, Rgb>): Document {
  return buildRigDocument(id, BONES, boneIndex('hips'), parts, clips, slotColors);
}

export interface RigBone {
  name: string;
  parent: number;
  /** Posisi rest di ruang model (rotasi rest = identitas). */
  rest: Vec3;
}

export interface RigClip {
  name: string;
  duration: number;
  /** `hips` = offset translasi untuk tulang `moverIndex`. */
  pose: (phase: number) => { rot: Partial<Record<string, Vec3>>; hips?: Vec3 };
}

/** Rig kaku generik (humanoid, hewan): satu joint per vertex, satu skin dipakai semua part. */
export function buildRigDocument(
  id: string,
  bones: RigBone[],
  moverIndex: number,
  parts: CharacterPart[],
  clips: RigClip[],
  slotColors?: Record<Slot, Rgb>,
): Document {
  const { doc, material } = createBaseDocument();
  const slotMaterials = new Map<Slot, Material>();
  const materialFor = (slot: Slot | undefined): Material => {
    if (!slot) return material;
    let slotMaterial = slotMaterials.get(slot);
    if (!slotMaterial) {
      const color = slotColors?.[slot] ?? [1, 1, 1];
      slotMaterial = doc.createMaterial(slot).setBaseColorFactor([...color, 1]).setMetallicFactor(0).setRoughnessFactor(0.85);
      slotMaterials.set(slot, slotMaterial);
    }
    return slotMaterial;
  };

  const joints: Node[] = bones.map((bone) => {
    const parent = bones[bone.parent];
    const local: Vec3 = parent
      ? [bone.rest[0] - parent.rest[0], bone.rest[1] - parent.rest[1], bone.rest[2] - parent.rest[2]]
      : bone.rest;
    return doc.createNode(`bone_${bone.name}`).setTranslation(local);
  });
  bones.forEach((bone, i) => {
    const node = joints[i];
    const parent = joints[bone.parent];
    if (node && parent) parent.addChild(node);
  });

  const inverseBind = new Float32Array(bones.length * 16);
  bones.forEach((bone, i) => {
    inverseBind.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -bone.rest[0], -bone.rest[1], -bone.rest[2], 1], i * 16);
  });
  const rootJoint = joints[0];
  if (!rootJoint) throw new Error('Rig has no root');
  const skin = doc.createSkin(`skin_${id}`).setSkeleton(rootJoint).setInverseBindMatrices(createAccessor(doc, 'MAT4', inverseBind));
  joints.forEach((joint) => skin.addJoint(joint));

  // Skinned mesh nodes and skeleton sit at the scene root (glTF: parent transforms don't affect skinned meshes).
  const scene = doc.createScene(id).addChild(rootJoint);
  for (const part of parts) {
    const mesh = addMesh(doc, part.name, [{ builder: part.builder, material: materialFor(part.slot), tint: part.tint }], true);
    scene.addChild(doc.createNode(part.name).setMesh(mesh).setSkin(skin));
  }
  doc.getRoot().setDefaultScene(scene);

  const hipsIndex = moverIndex;
  const hipsRest = bones[moverIndex]?.rest ?? [0, 0, 0];
  for (const clip of clips) {
    const frames = Math.max(2, Math.round(clip.duration * ANIMATION_FPS));
    const times = new Float32Array(frames + 1);
    const rotations = bones.map(() => new Float32Array((frames + 1) * 4));
    const hipsTranslation = new Float32Array((frames + 1) * 3);

    for (let frame = 0; frame <= frames; frame++) {
      times[frame] = (frame / frames) * clip.duration;
      const pose = clip.pose(frame === frames ? 0 : frame / frames);
      bones.forEach((bone, i) => rotations[i]?.set(quatFromEuler(pose.rot[bone.name] ?? [0, 0, 0]), frame * 4));
      const offset = pose.hips ?? [0, 0, 0];
      hipsTranslation.set([hipsRest[0] + offset[0], hipsRest[1] + offset[1], hipsRest[2] + offset[2]], frame * 3);
    }

    const animation = doc.createAnimation(clip.name);
    const input = createAccessor(doc, 'SCALAR', times);
    const addTrack = (node: Node, path: 'rotation' | 'translation', values: Float32Array) => {
      const sampler = doc
        .createAnimationSampler()
        .setInput(input)
        .setOutput(createAccessor(doc, path === 'rotation' ? 'VEC4' : 'VEC3', values))
        .setInterpolation('LINEAR');
      const channel = doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler);
      animation.addSampler(sampler).addChannel(channel);
    };

    bones.forEach((_, i) => {
      const node = joints[i];
      const values = rotations[i];
      if (i > 0 && node && values) addTrack(node, 'rotation', values);
    });
    const hipsNode = joints[hipsIndex];
    if (hipsNode) addTrack(hipsNode, 'translation', hipsTranslation);
  }

  return doc;
}
import { MeshBuilder } from '../lib/builder';
import { tintRegions } from '../lib/gltf';
import { type Vec3, deg } from '../lib/math';
import { PALETTE, hex, type Rgb } from '../lib/palette';
import { BONES, IDLE, SIT, WALK, boneIndex, buildRigDocument, type BoneName, type RigBone, type RigClip } from './humanoid';
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
// Dua GLB warga (pria `ped_citizen`, wanita `ped_citizen_f`), masing-masing SATU primitive yang
// di-instance runtime (PedestrianLayer: maks 2 draw call warga). Keduanya memakai rig BONES yang
// sama persis dengan humanoid.ts, jadi pivot sendi di pedAnim.ts (pinggul 0.95, paha 0.92, lutut
// 0.5, bahu 1.42, siku 1.14) tetap berlaku; yang beda hanya geometri. Rotasi prosedural hanya di
// sumbu X, jadi posisi X lengan/kaki boleh berbeda (bahu wanita lebih sempit) tanpa pivot baru.
//
// `_TINT` per vertex = region + 8 * grup (kembaran GLSL/TS ada di src/ambient/pedAnim.ts):
// region 0 warna tetap, 1 baju, 2 bawahan (celana/rok), 3 rambut, 4 aksen (sepatu/topi pria,
// jilbab wanita), 5 kaki wanita (kulit kalau rok, warna bawahan kalau celana).
// grup 0 selalu, 1 rok, 2 kuncir, 3 rambut terurai, 4 jilbab, 5 rambut dasar (hilang saat jilbab),
// 6 topi. Grup yang tidak aktif untuk gaya instance itu dikempiskan di vertex shader.

const REGION = { fixed: 0, shirt: 1, bottom: 2, hair: 3, accent: 4, legs: 5 } as const;
const GROUP = { always: 0, skirt: 1, ponytail: 2, looseHair: 3, hijab: 4, baseHair: 5, cap: 6 } as const;
const tintCode = (region: number, group: number = GROUP.always) => region + 8 * group;

/** Mencatat kode `_TINT` per vertex saat bagian ditambahkan (tanpa mencocokkan warna). */
class Tagged {
  readonly b = new MeshBuilder();
  readonly tint: number[] = [];
  add(code: number, draw: (b: MeshBuilder) => void): void {
    const before = this.b.vertexCount;
    draw(this.b);
    for (let i = before; i < this.b.vertexCount; i++) this.tint.push(code);
  }
}

const DOWN: Vec3 = [Math.PI, 0, 0];
const restOf = (name: BoneName): Vec3 => BONES[boneIndex(name)]!.rest;
/** Silinder anggota badan dari sendi ke bawah; `x` menggeser sumbu X (rotasi tetap di sumbu X). */
const limbAt = (b: MeshBuilder, bone: BoneName, x: number, length: number, r0: number, r1: number, color: Rgb, lift = 0, segments = 6) => {
  const rest = restOf(bone);
  b.frustum({ radiusBottom: r0, radiusTop: r1, height: length, segments }, { at: [x, rest[1] - lift, rest[2]], rot: DOWN, color, bone: boneIndex(bone) });
};

// Warna pratinjau (PNG) saja; runtime mengganti region 1..5 dengan palet varian.
const SHOW = {
  shirtM: hex('#2f6fdb'),
  shirtF: hex('#d65a8a'),
  pants: PALETTE.jeans,
  skirt: hex('#5a3d7a'),
  hair: PALETTE.hair,
  hijab: hex('#2f9c8f'),
  shoeM: hex('#e8e4dc'),
  shoeF: hex('#7a2f3a'),
  collar: PALETTE.white,
  belt: hex('#2a1f18'),
  lips: hex('#b0464e'),
  watch: hex('#1f1f24'),
} as const;

/** Kepala bersama: leher, kepala, mata, alis. */
function head(t: Tagged, brow: Rgb): void {
  const h = boneIndex('head');
  t.add(0, (b) => {
    b.frustum({ radiusBottom: 0.055, radiusTop: 0.05, height: 0.09, segments: 6, capBottom: false, capTop: false }, { at: [0, 1.45, 0], color: PALETTE.skinTan, bone: h });
    b.blob({ radius: 0.13, stretch: [0.95, 1.05, 1], subdivide: true }, { at: [0, 1.62, 0], color: PALETTE.skinTan, bone: h });
    for (const x of [0.05, -0.05]) {
      b.box([0.035, 0.045, 0.02], { at: [x, 1.635, -0.122], color: PALETTE.eye, bone: h });
      b.box([0.045, 0.012, 0.015], { at: [x, 1.672, -0.124], color: brow, bone: h });
    }
  });
}

/** Warga pria: kaos lengan pendek berkerah, ikat pinggang, jam tangan, rambut berponi, topi opsional. */
function buildCitizenMale(): Tagged {
  const t = new Tagged();
  const hips = boneIndex('hips');
  const spine = boneIndex('spine');
  const chest = boneIndex('chest');
  const h = boneIndex('head');
  head(t, PALETTE.hair);

  t.add(tintCode(REGION.bottom), (b) => b.box([0.32, 0.17, 0.2], { at: [0, 0.94, 0], color: SHOW.pants, bone: hips }));
  t.add(0, (b) => b.box([0.325, 0.035, 0.205], { at: [0, 1.015, 0], color: SHOW.belt, bone: hips }));
  t.add(tintCode(REGION.shirt), (b) => {
    b.box([0.34, 0.2, 0.21], { at: [0, 1.13, 0], color: SHOW.shirtM, bone: spine });
    b.box([0.42, 0.26, 0.24], { at: [0, 1.33, 0], color: SHOW.shirtM, bone: chest });
    b.box([0.28, 0.05, 0.21], { at: [0, 1.47, 0.02], color: SHOW.shirtM, bone: chest });
  });
  // Kerah polo: dua lidah di depan leher + kancing.
  t.add(0, (b) => {
    for (const s of [-1, 1]) b.box([0.07, 0.035, 0.03], { at: [s * 0.045, 1.465, -0.1], rot: [0, 0, s * 0.35], color: SHOW.collar, bone: chest });
    b.box([0.02, 0.1, 0.012], { at: [0, 1.41, -0.121], color: SHOW.collar, bone: chest });
  });

  for (const side of ['L', 'R'] as const) {
    const sx = side === 'R' ? 1 : -1;
    const x = sx * 0.225;
    // Lengan pendek (baju), sisanya kulit.
    t.add(tintCode(REGION.shirt), (b) => limbAt(b, `upperArm_${side}`, x, 0.16, 0.068, 0.064, SHOW.shirtM));
    t.add(0, (b) => {
      limbAt(b, `upperArm_${side}`, x, 0.14, 0.052, 0.048, PALETTE.skinTan, 0.14);
      limbAt(b, `lowerArm_${side}`, x, 0.22, 0.048, 0.042, PALETTE.skinTan);
      b.box([0.075, 0.09, 0.085], { at: [x, 0.875, 0], color: PALETTE.skinTan, bone: boneIndex(`lowerArm_${side}`) });
    });
    if (side === 'L') t.add(0, (b) => b.box([0.1, 0.03, 0.1], { at: [x, 0.94, 0], color: SHOW.watch, bone: boneIndex('lowerArm_L') }));

    const legX = sx * 0.1;
    t.add(tintCode(REGION.bottom), (b) => {
      limbAt(b, `upperLeg_${side}`, legX, 0.42, 0.084, 0.072, SHOW.pants);
      limbAt(b, `lowerLeg_${side}`, legX, 0.4, 0.068, 0.06, SHOW.pants);
    });
    const shin = boneIndex(`lowerLeg_${side}`);
    // Sneaker: badan sepatu (aksen) + sol + ujung putih.
    t.add(tintCode(REGION.accent), (b) => b.box([0.12, 0.085, 0.25], { at: [legX, 0.055, -0.04], color: SHOW.shoeM, bone: shin }));
    t.add(0, (b) => {
      b.box([0.126, 0.028, 0.26], { at: [legX, 0.014, -0.04], color: PALETTE.sole, bone: shin });
      b.box([0.1, 0.04, 0.03], { at: [legX, 0.05, -0.17], color: PALETTE.white, bone: shin });
    });
  }

  // Rambut pendek: tempurung + jambang (selalu), poni miring hanya kalau tidak bertopi (grup baseHair).
  t.add(tintCode(REGION.hair), (b) => {
    b.blob({ radius: 0.137, stretch: [1, 0.62, 1.02], subdivide: true }, { at: [0, 1.69, 0.012], color: SHOW.hair, bone: h });
    for (const s of [-1, 1]) b.box([0.024, 0.07, 0.05], { at: [s * 0.124, 1.635, 0.0], color: SHOW.hair, bone: h });
  });
  t.add(tintCode(REGION.hair, GROUP.baseHair), (b) =>
    b.box([0.2, 0.05, 0.06], { at: [0.02, 1.715, -0.11], rot: [0.3, 0, -0.12], color: SHOW.hair, bone: h }),
  );
  // Topi (opsional per warga): tempurung + lidah topi ke depan.
  t.add(tintCode(REGION.accent, GROUP.cap), (b) => {
    b.blob({ radius: 0.142, stretch: [1, 0.6, 1.03] }, { at: [0, 1.715, 0.012], color: SHOW.shoeM, bone: h });
    b.box([0.2, 0.018, 0.12], { at: [0, 1.715, -0.17], rot: [-0.12, 0, 0], color: SHOW.shoeM, bone: h });
  });
  return t;
}

/**
 * Warga wanita: bahu dan lengan lebih ramping, pinggang ramping, pinggul lebih lebar, kaki lebih
 * kecil. Gaya per warga lewat grup `_TINT`: rok (atau celana), rambut terurai atau kuncir, jilbab.
 * Rok menempel di bone hips (kaku) supaya tidak ikut terbelah saat paha berayun.
 */
function buildCitizenFemale(): Tagged {
  const t = new Tagged();
  const hips = boneIndex('hips');
  const spine = boneIndex('spine');
  const chest = boneIndex('chest');
  const h = boneIndex('head');
  head(t, PALETTE.hair);
  // Bibir kecil supaya wajah terbaca feminin dari dekat.
  t.add(0, (b) => b.box([0.045, 0.016, 0.015], { at: [0, 1.568, -0.126], color: SHOW.lips, bone: h }));

  t.add(tintCode(REGION.bottom), (b) => b.box([0.34, 0.17, 0.21], { at: [0, 0.93, 0], color: SHOW.skirt, bone: hips }));
  t.add(tintCode(REGION.shirt), (b) => {
    // Pinggang ramping, dada sedikit lebih kecil dari pria, bahu sempit.
    b.box([0.27, 0.2, 0.18], { at: [0, 1.12, 0], color: SHOW.shirtF, bone: spine });
    b.box([0.33, 0.24, 0.21], { at: [0, 1.33, 0], color: SHOW.shirtF, bone: chest });
    b.box([0.24, 0.05, 0.19], { at: [0, 1.465, 0.02], color: SHOW.shirtF, bone: chest });
    b.blob({ radius: 0.075, stretch: [1.5, 0.75, 0.6] }, { at: [0, 1.3, -0.085], color: SHOW.shirtF, bone: chest });
    // Ujung blus melebar di pinggul.
    b.frustum({ radiusBottom: 0.19, radiusTop: 0.155, height: 0.09, segments: 8 }, { at: [0, 0.99, 0], color: SHOW.shirtF, bone: spine });
  });
  // Rok selutut: bagian atas kaku di pinggul, bagian bawah dua panel yang menempel di paha. Dengan
  // begitu rok ikut mengayun saat jalan dan mendatar di atas paha saat duduk (tidak menembus bangku).
  t.add(tintCode(REGION.bottom, GROUP.skirt), (b) => {
    b.frustum({ radiusBottom: 0.215, radiusTop: 0.18, height: 0.12, segments: 8 }, { at: [0, 0.84, 0], color: SHOW.skirt, bone: hips });
    for (const side of ['L', 'R'] as const) {
      const sx = side === 'R' ? 1 : -1;
      b.frustum({ radiusBottom: 0.13, radiusTop: 0.115, height: 0.26, segments: 6 }, { at: [sx * 0.095, 0.56, 0], color: SHOW.skirt, bone: boneIndex(`upperLeg_${side}`) });
    }
  });

  for (const side of ['L', 'R'] as const) {
    const sx = side === 'R' ? 1 : -1;
    const x = sx * 0.19;
    t.add(tintCode(REGION.shirt), (b) => limbAt(b, `upperArm_${side}`, x, 0.14, 0.058, 0.054, SHOW.shirtF));
    t.add(0, (b) => {
      limbAt(b, `upperArm_${side}`, x, 0.15, 0.044, 0.04, PALETTE.skinTan, 0.13);
      limbAt(b, `lowerArm_${side}`, x, 0.22, 0.04, 0.034, PALETTE.skinTan);
      b.box([0.06, 0.08, 0.07], { at: [x, 0.88, 0], color: PALETTE.skinTan, bone: boneIndex(`lowerArm_${side}`) });
    });
    if (side === 'R') t.add(0, (b) => b.box([0.085, 0.022, 0.085], { at: [x, 0.94, 0], color: hex('#d8b25a'), bone: boneIndex('lowerArm_R') }));

    const legX = sx * 0.085;
    // Kaki: kulit di bawah rok, berwarna bawahan kalau bercelana (region 5).
    t.add(tintCode(REGION.legs), (b) => {
      limbAt(b, `upperLeg_${side}`, legX, 0.42, 0.074, 0.06, PALETTE.skinTan);
      limbAt(b, `lowerLeg_${side}`, legX, 0.42, 0.056, 0.044, PALETTE.skinTan);
    });
    const shin = boneIndex(`lowerLeg_${side}`);
    // Flat shoes kecil dengan sol.
    t.add(0, (b) => {
      b.box([0.09, 0.06, 0.2], { at: [legX, 0.04, -0.035], color: SHOW.shoeF, bone: shin });
      b.box([0.094, 0.02, 0.205], { at: [legX, 0.01, -0.035], color: PALETTE.sole, bone: shin });
    });
  }

  // Rambut dasar (tempurung + poni), disembunyikan saat berjilbab.
  t.add(tintCode(REGION.hair, GROUP.baseHair), (b) => {
    b.blob({ radius: 0.14, stretch: [1.02, 0.66, 1.04], subdivide: true }, { at: [0, 1.685, 0.012], color: SHOW.hair, bone: h });
    b.box([0.22, 0.045, 0.05], { at: [0, 1.7, -0.115], rot: [0.35, 0, 0], color: SHOW.hair, bone: h });
  });
  // Rambut panjang terurai sampai punggung, dengan sisi membingkai wajah.
  t.add(tintCode(REGION.hair, GROUP.looseHair), (b) => {
    b.box([0.27, 0.4, 0.09], { at: [0, 1.46, 0.095], color: SHOW.hair, bone: h });
    for (const s of [-1, 1]) b.box([0.06, 0.3, 0.16], { at: [s * 0.125, 1.52, 0.02], color: SHOW.hair, bone: h });
  });
  // Kuncir kuda: ikatan di belakang kepala + ekor yang menjuntai.
  t.add(tintCode(REGION.hair, GROUP.ponytail), (b) => {
    b.blob({ radius: 0.05 }, { at: [0, 1.66, 0.14], color: SHOW.hair, bone: h });
    b.frustum({ radiusBottom: 0.025, radiusTop: 0.05, height: 0.28, segments: 5 }, { at: [0, 1.36, 0.17], rot: [-0.15, 0, 0], color: SHOW.hair, bone: h });
  });
  // Jilbab: menutup kepala dan leher, wajah tetap terbuka, menjuntai ke bahu.
  t.add(tintCode(REGION.accent, GROUP.hijab), (b) => {
    b.blob({ radius: 0.148, stretch: [1.02, 0.84, 1.06], subdivide: true }, { at: [0, 1.665, 0.018], color: SHOW.hijab, bone: h });
    for (const s of [-1, 1]) b.box([0.05, 0.22, 0.2], { at: [s * 0.13, 1.55, 0.02], color: SHOW.hijab, bone: h });
    b.box([0.27, 0.24, 0.1], { at: [0, 1.53, 0.09], color: SHOW.hijab, bone: h });
    b.box([0.2, 0.06, 0.06], { at: [0, 1.47, -0.075], color: SHOW.hijab, bone: h });
    b.frustum({ radiusBottom: 0.22, radiusTop: 0.09, height: 0.15, segments: 8 }, { at: [0, 1.35, 0.005], color: SHOW.hijab, bone: chest });
  });
  return t;
}

/** Batas segitiga per warga (aset instanced, HP): semua bagian termasuk grup gaya yang tersembunyi. */
const CITIZEN_MAX_TRIANGLES = 1100;

function buildCitizenDoc(id: string, tagged: Tagged) {
  if (tagged.b.triangleCount > CITIZEN_MAX_TRIANGLES) throw new Error(`${id}: segitiga ${tagged.b.triangleCount} > ${CITIZEN_MAX_TRIANGLES}`);
  if (tagged.tint.length !== tagged.b.vertexCount) throw new Error(`${id}: tint ${tagged.tint.length} != vertex ${tagged.b.vertexCount}`);
  return buildRigDocument(id, BONES, 1, [{ name: id, builder: tagged.b, tint: tagged.tint }], [IDLE, WALK, SIT]);
}

/**
 * Palet varian (linear RGB). Pria: [baju, celana, rambut, sepatu/topi]; wanita: [baju, bawahan,
 * rambut, jilbab]. Runtime menyalinnya di src/ambient/pedAnim.ts (PED_VARIANTS) dan
 * pedAnim.test.ts memastikan salinannya sama dengan manifest.
 */
const toLinear = (rows: string[][]) => rows.map((v) => v.map((c) => srgb(hex(c))));
const CITIZEN_VARIANTS = toLinear([
  ['#2f6fdb', '#34405a', '#2b211c', '#e8e4dc'],
  ['#d8473a', '#2e2e33', '#1a1512', '#2a2a2e'],
  ['#3f9b5a', '#5a4a3a', '#4a3020', '#8a5a3b'],
  ['#e0b12f', '#2a3550', '#2b211c', '#e8e4dc'],
  ['#8b5bc4', '#3a3430', '#6b4a2a', '#1f3a6b'],
  ['#e8e4dc', '#405070', '#151515', '#b03030'],
]);
const CITIZEN_F_VARIANTS = toLinear([
  ['#e86a9a', '#3a2f55', '#2b211c', '#f0c8d8'],
  ['#f2f0ea', '#2a3550', '#1a1512', '#2f9c8f'],
  ['#e8a03a', '#5a3a2a', '#4a3020', '#7a4fb0'],
  ['#4fa3d8', '#e8e4dc', '#1a1512', '#1f3a6b'],
  ['#9b3a5a', '#2e2e33', '#6b4a2a', '#e8b02a'],
  ['#6abf7a', '#34405a', '#2b211c', '#efe6d0'],
  ['#c45ad0', '#2a2a2e', '#151515', '#d8473a'],
  ['#f0d24a', '#6b4a7a', '#4a3020', '#3a7a4a'],
]);

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
    tags: ['character', 'city', 'npc', 'ambient', 'pedestrian', 'male'],
    collider: { type: 'capsule', radius: 0.3, height: 1.75, center: [0, 0.875, 0] },
    requiredAnimations: ['anim_Idle', 'anim_Walk', 'anim_Sit'],
    previews: [
      { clip: 'anim_Walk', phase: 0.25 },
      { clip: 'anim_Sit', phase: 0 },
    ],
    meta: { gender: 'm', tintAttribute: '_TINT', tintEncoding: 'region + 8 * group', tintRegions: ['shirt', 'pants', 'hair', 'accent'], styleGroups: ['cap', 'baseHair'], variants: CITIZEN_VARIANTS, heightScale: [0.92, 1.06], vertexAnim: VERTEX_ANIM, sitHeight: 0.45 },
    build: () => buildCitizenDoc('ped_citizen', buildCitizenMale()),
  },
  {
    id: 'ped_citizen_f',
    category: 'npc',
    tags: ['character', 'city', 'npc', 'ambient', 'pedestrian', 'female'],
    collider: { type: 'capsule', radius: 0.28, height: 1.7, center: [0, 0.85, 0] },
    requiredAnimations: ['anim_Idle', 'anim_Walk', 'anim_Sit'],
    previews: [
      { clip: 'anim_Walk', phase: 0.25 },
      { clip: 'anim_Sit', phase: 0 },
    ],
    // Pratinjau PNG menampilkan semua grup gaya sekaligus (rok + jilbab + rambut); runtime hanya satu kombinasi.
    meta: { gender: 'f', tintAttribute: '_TINT', tintEncoding: 'region + 8 * group', tintRegions: ['shirt', 'bottom', 'hair', 'hijab', 'legs'], styleGroups: ['skirt', 'ponytail', 'looseHair', 'hijab', 'baseHair'], variants: CITIZEN_F_VARIANTS, heightScale: [0.88, 1.0], vertexAnim: VERTEX_ANIM, sitHeight: 0.45 },
    build: () => buildCitizenDoc('ped_citizen_f', buildCitizenFemale()),
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
/**
 * Animasi prosedural warga (TASKS C3). Rumusnya ditulis dua kali: sebagai fungsi TS yang diuji,
 * dan sebagai GLSL (`PED_ANIM_GLSL`) yang dipakai vertex shader instanced. Keduanya harus sama,
 * jadi `pedAnim.test.ts` mengunci nilai-nilai pentingnya.
 *
 * Semua sudut dalam radian, rotasi di sekitar sumbu X, tanda mengikuti konvensi right-handed
 * (sudut positif memutar +Y ke +Z). Warga menghadap -Z, jadi sudut NEGATIF = ke depan.
 * Pivot sendi dalam METER dari rest pose GLB `ped_citizen` (pinggul y=0.95, paha 0.92, lutut 0.5,
 * bahu 1.42, siku 1.14) — geometrinya dibakar ke ruang meter dulu oleh `bakeBindPose`.
 */

import { BufferAttribute, type BufferGeometry, Matrix4, type SkinnedMesh, Vector3 } from 'three';

export type PedAnim = 'idle' | 'walk' | 'sit';

/** Gender warga; menentukan GLB mana yang dipakai (ped_citizen / ped_citizen_f). */
export type PedGender = 'm' | 'f';

/**
 * Dua mesh warga, satu InstancedMesh per mesh (maks 2 draw call warga).
 * Indeksnya juga indeks di PED_MESHES.
 */
export const PED_MESHES = [
  { gender: 'm' as PedGender, asset: 'ped_citizen' as const },
  { gender: 'f' as PedGender, asset: 'ped_citizen_f' as const },
];

/** Warga dengan gender 'f' WAJIB dirender memakai mesh wanita (indeks 1). */
export const pedMeshIndex = (resident: { gender: PedGender } | undefined): number => (resident?.gender === 'f' ? 1 : 0);

/**
 * Grup gaya di atribut `_TINT` aset warga: `_TINT = region + 8 * grup` (lihat
 * tools/assets/defs/creatures.ts). Grup 0 selalu terlihat; grup lain hanya kalau bit-nya
 * menyala di atribut instance `pedStyle`, vertex lain dikempiskan di vertex shader.
 */
export const PED_GROUP = { always: 0, skirt: 1, ponytail: 2, looseHair: 3, hijab: 4, baseHair: 5, cap: 6 } as const;
const bit = (group: number) => 2 ** (group - 1);

/**
 * Gaya tetap per warga (dari indeks warga, bukan id spawn), supaya satu warga selalu tampil sama.
 * `generateResidents` menyelang gender (genap pria, ganjil wanita), jadi variasi memakai
 * `k = floor(indeks / 2)` = urutan warga di dalam gendernya.
 * Pria: 1 dari 4 bertopi (poni `baseHair` disembunyikan supaya tidak menembus topi).
 * Wanita: 1 dari 3 berjilbab, sisanya bergantian kuncir / rambut terurai; 4 dari 5 berok
 * (yang tidak berok bercelana panjang: region `legs` ikut warna bawahan).
 */
export function pedStyleMask(gender: PedGender, residentIndex: number): number {
  const k = Math.floor(Math.max(0, residentIndex) / 2);
  if (gender === 'm') return k % 4 === 1 ? bit(PED_GROUP.cap) : bit(PED_GROUP.baseHair);
  const hijab = k % 3 === 0;
  const hair = hijab ? bit(PED_GROUP.hijab) : bit(PED_GROUP.baseHair) + bit(k % 2 === 0 ? PED_GROUP.ponytail : PED_GROUP.looseHair);
  const skirt = k % 5 !== 2 ? bit(PED_GROUP.skirt) : 0;
  return hair + skirt;
}

/** Bit grup menyala? Dipakai test dan (lewat `pedStyle`) vertex shader. */
export const pedHasGroup = (mask: number, group: number): boolean => Math.floor(mask / bit(group)) % 2 === 1;

/**
 * Palet varian warga (linear RGB), disalin dari `meta.variants` di tools/assets/defs/creatures.ts.
 * Pria: [baju, celana, rambut, aksen sepatu/topi]; wanita: [baju, bawahan, rambut, jilbab].
 * pedAnim.test.ts membandingkan salinan ini dengan public/assets/manifest.json, jadi kalau varian
 * di creatures.ts berubah, salin ulang ke sini.
 */
export const PED_VARIANTS: Record<PedGender, readonly (readonly [number, number, number])[][]> = {
  m: [
    [[0.0284, 0.159, 0.7084], [0.0343, 0.0513, 0.1022], [0.0242, 0.0152, 0.0116], [0.807, 0.7758, 0.7157]],
    [[0.6867, 0.063, 0.0423], [0.0273, 0.0273, 0.0331], [0.0103, 0.0075, 0.006], [0.0232, 0.0232, 0.0273]],
    [[0.0497, 0.3278, 0.1022], [0.1022, 0.0685, 0.0423], [0.0685, 0.0296, 0.0144], [0.2542, 0.1022, 0.0437]],
    [[0.7454, 0.4397, 0.0284], [0.0232, 0.0356, 0.0802], [0.0242, 0.0152, 0.0116], [0.807, 0.7758, 0.7157]],
    [[0.2582, 0.1046, 0.552], [0.0423, 0.0343, 0.0296], [0.147, 0.0685, 0.0232], [0.0137, 0.0423, 0.147]],
    [[0.807, 0.7758, 0.7157], [0.0513, 0.0802, 0.162], [0.0075, 0.0075, 0.0075], [0.4342, 0.0296, 0.0296]],
  ],
  f: [
    [[0.807, 0.1441, 0.3231], [0.0423, 0.0284, 0.0908], [0.0242, 0.0152, 0.0116], [0.8714, 0.5776, 0.6867]],
    [[0.8879, 0.8714, 0.8228], [0.0232, 0.0356, 0.0802], [0.0103, 0.0075, 0.006], [0.0284, 0.3325, 0.2747]],
    [[0.807, 0.3515, 0.0423], [0.1022, 0.0423, 0.0232], [0.0685, 0.0296, 0.0144], [0.1946, 0.0782, 0.4342]],
    [[0.0782, 0.3663, 0.6867], [0.807, 0.7758, 0.7157], [0.0103, 0.0075, 0.006], [0.0137, 0.0423, 0.147]],
    [[0.3278, 0.0423, 0.1022], [0.0273, 0.0273, 0.0331], [0.147, 0.0685, 0.0232], [0.807, 0.4342, 0.0232]],
    [[0.1441, 0.521, 0.1946], [0.0343, 0.0513, 0.1022], [0.0242, 0.0152, 0.0116], [0.8632, 0.7913, 0.6308]],
    [[0.552, 0.1022, 0.6308], [0.0232, 0.0232, 0.0273], [0.0075, 0.0075, 0.0075], [0.6867, 0.063, 0.0423]],
    [[0.8714, 0.6445, 0.0685], [0.147, 0.0685, 0.1946], [0.0685, 0.0296, 0.0144], [0.0423, 0.1946, 0.0685]],
  ],
};

/** Varian warna tetap per warga (indeks warga, bukan id spawn). */
export const pedVariantIndex = (gender: PedGender, residentIndex: number): number =>
  Math.floor(Math.max(0, residentIndex) / 2) % PED_VARIANTS[gender].length;

/** Region `_TINT` yang diwarnai palet (0 = warna vertex tetap). */
export const PED_REGION = { fixed: 0, shirt: 1, bottom: 2, hair: 3, accent: 4, legs: 5 } as const;

/** Vertex dengan kode `_TINT` ini terlihat untuk gaya `mask`? Kembaran `pedStyleVisible` di GLSL. */
export function pedVertexVisible(tint: number, mask: number): boolean {
  const group = Math.floor(tint / 8);
  return group === 0 || pedHasGroup(mask, group);
}

/**
 * Slot palet (0..3 = baju, bawahan, rambut, aksen) untuk vertex ini, atau -1 kalau memakai warna
 * vertex. Region `legs` = kulit di bawah rok, warna bawahan kalau tidak berok.
 * Kembaran `pedStyleSlot` di GLSL.
 */
export function pedTintSlot(tint: number, mask: number): number {
  const region = tint % 8;
  if (region === PED_REGION.fixed) return -1;
  if (region === PED_REGION.legs) return pedHasGroup(mask, PED_GROUP.skirt) ? -1 : 1;
  return region - 1;
}

/** Jumlah warna per varian di palet shader. */
export const PED_SLOTS = 4;

/**
 * Bagi pejalan ke slot instance per mesh (0 pria, 1 wanita) menurut gender warganya. Urutan
 * stabil, tiap pejalan muncul di tepat satu mesh, dan tidak ada slot melebihi `capacity`
 * (kelebihan dibuang dan dilaporkan supaya tidak menimpa slot lain).
 */
export function splitPedsByMesh<P extends { residentIndex: number }>(
  peds: readonly P[],
  residents: readonly { gender: PedGender }[],
  capacity: number,
): { slots: [P[], P[]]; dropped: number } {
  const slots: [P[], P[]] = [[], []];
  let dropped = 0;
  for (const ped of peds) {
    const list = pedMeshIndex(residents[ped.residentIndex]) === 1 ? slots[1] : slots[0];
    if (list.length < capacity) list.push(ped);
    else dropped += 1;
  }
  return { slots, dropped };
}

/** Kode state yang dikirim ke shader sebagai atribut instance. */
export const ANIM_CODE: Record<PedAnim, number> = { idle: 0, walk: 1, sit: 2 };

/** Panjang satu langkah (m); fase berputar 2*pi setiap jarak ini. */
export const STRIDE = 1.5;
/** Turunnya pinggul saat duduk (m), sama dengan `hips` klip SIT; telapak kaki tetap di tanah. */
export const SIT_DROP = 0.43;

export interface PedPose {
  /** Ayunan paha di sekitar pivot paha; positif = kaki ke depan. */
  thighL: number;
  thighR: number;
  /** Tekukan lutut (>= 0); shader memutarnya ke belakang supaya lutut tidak menekuk ke depan. */
  kneeL: number;
  kneeR: number;
  /** Ayunan lengan di sekitar bahu; positif = ke depan, berlawanan dengan paha sisi yang sama. */
  armL: number;
  armR: number;
  /** Tekukan siku (>= 0), lengan bawah ke depan. */
  elbow: number;
  /** Membungkuk ke depan dari pinggul (badan atas saja, kaki tidak ikut). */
  lean: number;
  /** Naik-turun badan (m); negatif berarti turun. */
  bob: number;
}

const DEG = Math.PI / 180;

/**
 * Pose pada fase tertentu, meniru klip IDLE/WALK/SIT di tools/assets/defs/humanoid.ts.
 * `phase` naik seiring jarak tempuh untuk 'walk' (lihat STRIDE), dan seiring waktu untuk
 * 'idle'/'sit' supaya napas dan gelisahnya tidak serempak.
 */
export function pedAnimPose(anim: PedAnim, phase: number): PedPose {
  if (anim === 'sit') {
    // Duduk: paha ke depan 88 derajat, lutut menekuk 86 derajat, badan sedikit maju.
    const fidget = 0.02 * Math.sin(phase * 0.7);
    return {
      thighL: 88 * DEG,
      thighR: 88 * DEG,
      kneeL: 86 * DEG,
      kneeR: 86 * DEG,
      armL: 18 * DEG + fidget,
      armR: 18 * DEG - fidget,
      elbow: 35 * DEG,
      lean: 4 * DEG + fidget,
      bob: -SIT_DROP,
    };
  }
  if (anim === 'idle') {
    // Diam: napas halus saja, kaki tegak.
    const breath = Math.sin(phase * 2);
    return { thighL: 0, thighR: 0, kneeL: 0, kneeR: 0, armL: 0, armR: 0, elbow: 8 * DEG, lean: 1.5 * DEG * breath, bob: 0.004 * breath };
  }
  // Jalan: paha kiri dan kanan berlawanan fase, lengan berlawanan dengan paha sisi yang sama.
  const swing = Math.sin(phase);
  const c = Math.cos(phase);
  return {
    thighL: -28 * DEG * swing,
    thighR: 28 * DEG * swing,
    // Lutut menekuk saat kaki diayun ke depan (seperti klip WALK).
    kneeL: (5 + 40 * Math.max(0, -c)) * DEG,
    kneeR: (5 + 40 * Math.max(0, c)) * DEG,
    armL: 22 * DEG * swing,
    armR: -22 * DEG * swing,
    elbow: 18 * DEG,
    lean: 3 * DEG,
    // Dua kali per langkah: badan naik saat kaki menapak.
    bob: 0.02 * Math.cos(phase * 2) - 0.02,
  };
}

/**
 * GLSL kembaran `pedAnimPose` plus helper rotasi dan pemilihan pivot per bone.
 * Disisipkan ke vertex shader lewat onBeforeCompile; lihat PedestrianLayer.
 */
export const PED_ANIM_GLSL = /* glsl */ `
struct PedPose { float thighL; float thighR; float kneeL; float kneeR; float armL; float armR; float elbow; float lean; float bob; };

PedPose pedAnimPose(float anim, float phase) {
  const float DEG = 0.017453293;
  if (anim > 1.5) {
    float fidget = 0.02 * sin(phase * 0.7);
    return PedPose(88.0 * DEG, 88.0 * DEG, 86.0 * DEG, 86.0 * DEG, 18.0 * DEG + fidget, 18.0 * DEG - fidget, 35.0 * DEG, 4.0 * DEG + fidget, -${SIT_DROP.toFixed(2)});
  }
  if (anim < 0.5) {
    float breath = sin(phase * 2.0);
    return PedPose(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 8.0 * DEG, 1.5 * DEG * breath, 0.004 * breath);
  }
  float swing = sin(phase);
  float c = cos(phase);
  return PedPose(
    -28.0 * DEG * swing, 28.0 * DEG * swing,
    (5.0 + 40.0 * max(0.0, -c)) * DEG, (5.0 + 40.0 * max(0.0, c)) * DEG,
    22.0 * DEG * swing, -22.0 * DEG * swing, 18.0 * DEG, 3.0 * DEG, 0.02 * cos(phase * 2.0) - 0.02
  );
}

/** Rotasi titik di sekitar pivot pada sumbu X (sudut positif memutar +Y ke +Z, yaitu ke depan untuk kaki). */
vec3 pedRotX(vec3 point, vec3 pivot, float angle) {
  vec3 d = point - pivot;
  float c = cos(angle);
  float s = sin(angle);
  return pivot + vec3(d.x, c * d.y - s * d.z, s * d.y + c * d.z);
}

/**
 * Pose satu vertex dalam meter (geometri hasil bakeBindPose). \`bone\` = indeks joint
 * 0 root, 1 hips, 2 spine, 3 chest, 4 head, 5/6 lengan kiri, 7/8 lengan kanan,
 * 9/10 kaki kiri, 11/12 kaki kanan.
 */
vec3 pedPoseVertex(vec3 pos, float bone, PedPose pose) {
  if (bone > 8.5) {
    float left = bone < 10.5 ? 1.0 : 0.0;
    float x = mix(0.1, -0.1, left);
    // Tulang bawah (10, 12) menekuk ke belakang di lutut dulu, lalu ikut ayunan paha.
    if (abs(bone - 10.0) < 0.5 || abs(bone - 12.0) < 0.5) pos = pedRotX(pos, vec3(x, 0.5, 0.0), -mix(pose.kneeR, pose.kneeL, left));
    return pedRotX(pos, vec3(x, 0.92, 0.0), mix(pose.thighR, pose.thighL, left));
  }
  if (bone > 4.5) {
    float left = bone < 6.5 ? 1.0 : 0.0;
    float x = mix(0.22, -0.22, left);
    if (abs(bone - 6.0) < 0.5 || abs(bone - 8.0) < 0.5) pos = pedRotX(pos, vec3(x, 1.14, 0.0), pose.elbow);
    pos = pedRotX(pos, vec3(x, 1.42, 0.0), mix(pose.armR, pose.armL, left));
  }
  // Badan atas (spine ke atas, termasuk lengan) membungkuk ke depan (-Z) dari pinggul.
  if (bone > 1.5) pos = pedRotX(pos, vec3(0.0, 0.95, 0.0), -pose.lean);
  return pos;
}

/** Bit grup gaya (1..7) menyala di mask? Kembaran pedHasGroup. */
bool pedHasGroup(float mask, float group) {
  return mod(floor(mask / exp2(group - 1.0) + 0.001), 2.0) > 0.5;
}

/** Kembaran pedVertexVisible: tint = region + 8 * grup. */
bool pedStyleVisible(float tint, float mask) {
  float group = floor(tint / 8.0 + 0.001);
  return group < 0.5 || pedHasGroup(mask, group);
}

/** Kembaran pedTintSlot: -1 = warna vertex, 0..3 = slot palet. */
int pedStyleSlot(float tint, float mask) {
  float region = tint - 8.0 * floor(tint / 8.0 + 0.001);
  if (region < 0.5) return -1;
  if (region > 4.5) return pedHasGroup(mask, ${PED_GROUP.skirt}.0) ? -1 : 1;
  return int(region + 0.5) - 1;
}
`;

/**
 * Memanggang bind pose SkinnedMesh rigid ke geometri biasa dalam METER. GLB-nya terkuantisasi
 * (KHR_mesh_quantization): POSITION berada di -1..1 dan skala meternya tersimpan di inverse bind
 * matrices, jadi tiap vertex dikali `boneWorld * boneInverse * bindMatrix` milik bone-nya.
 * Hasil: position/normal float meter, color, _tint, dan `bone` (float) pengganti skinIndex.
 * ponytail: hanya skinIndex.x yang dipakai (rig kaku, 1 bone per vertex); rig dengan blend weight
 * butuh skinning penuh di sini.
 */
export function bakeBindPose(mesh: SkinnedMesh): BufferGeometry {
  const source = mesh.geometry;
  const { bones, boneInverses } = mesh.skeleton;
  bones[0]?.updateWorldMatrix(true, true);
  const matrices = bones.map((bone, j) => new Matrix4().multiplyMatrices(bone.matrixWorld, boneInverses[j]!).multiply(mesh.bindMatrix));
  const position = source.getAttribute('position');
  const normal = source.getAttribute('normal');
  const skin = source.getAttribute('skinIndex');
  const count = position.count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const bone = new Float32Array(count);
  const v = new Vector3();
  for (let i = 0; i < count; i++) {
    const j = skin.getX(i);
    const m = matrices[j]!;
    bone[i] = j;
    v.fromBufferAttribute(position, i).applyMatrix4(m).toArray(pos, i * 3);
    if (normal) v.fromBufferAttribute(normal, i).transformDirection(m).toArray(nor, i * 3);
  }
  const geometry = source.clone();
  for (const name of ['skinIndex', 'skinWeight']) geometry.deleteAttribute(name);
  geometry.setAttribute('position', new BufferAttribute(pos, 3));
  if (normal) geometry.setAttribute('normal', new BufferAttribute(nor, 3));
  geometry.setAttribute('bone', new BufferAttribute(bone, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
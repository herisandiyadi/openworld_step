/**
 * Animasi prosedural warga (TASKS C3). Rumusnya ditulis dua kali: sebagai fungsi TS yang diuji,
 * dan sebagai GLSL (`PED_ANIM_GLSL`) yang dipakai vertex shader instanced. Keduanya harus sama,
 * jadi `pedAnim.test.ts` mengunci nilai-nilai pentingnya.
 *
 * Sudut dalam radian, rotasi di sekitar sumbu X (ayun maju/mundur). Pivot sendi diambil dari
 * rest pose GLB `ped_citizen` (bone_hips di y=0.95, paha 0.92, lutut 0.5, bahu 1.42, siku 1.14).
 */

export type PedAnim = 'idle' | 'walk' | 'sit';

/** Kode state yang dikirim ke shader sebagai atribut instance. */
export const ANIM_CODE: Record<PedAnim, number> = { idle: 0, walk: 1, sit: 2 };

/** Panjang satu langkah (m); fase berputar 2*pi setiap jarak ini. */
export const STRIDE = 1.5;
/** Turunnya pinggul saat duduk (m), sama dengan meta.sitHeight di manifest aset. */
export const SIT_DROP = 0.45;

export interface PedPose {
  /** Ayunan paha kiri/kanan di sekitar pivot paha. */
  thighL: number;
  thighR: number;
  /** Tekukan lutut; selalu >= 0 karena lutut hanya menekuk ke belakang. */
  kneeL: number;
  kneeR: number;
  /** Ayunan lengan di sekitar bahu, berlawanan dengan paha sisi yang sama. */
  armL: number;
  armR: number;
  /** Tekukan siku, selalu >= 0. */
  elbow: number;
  /** Membungkuk dari pinggul (badan atas saja, kaki tidak ikut). */
  lean: number;
  /** Naik-turun badan (m); negatif berarti turun. */
  bob: number;
}

/**
 * Pose pada fase tertentu. `phase` naik seiring jarak tempuh untuk 'walk' (lihat STRIDE),
 * dan seiring waktu untuk 'idle'/'sit' supaya napas dan gelisahnya tidak serempak.
 */
export function pedAnimPose(anim: PedAnim, phase: number): PedPose {
  if (anim === 'sit') {
    // Duduk: paha ke depan ~90 derajat, lutut menekuk balik, badan sedikit maju.
    const fidget = 0.02 * Math.sin(phase * 0.7);
    return {
      thighL: -Math.PI / 2,
      thighR: -Math.PI / 2,
      kneeL: Math.PI / 2,
      kneeR: Math.PI / 2,
      armL: -0.25 + fidget,
      armR: -0.25 - fidget,
      elbow: 0.5,
      lean: 0.12 + fidget,
      bob: -SIT_DROP,
    };
  }
  if (anim === 'idle') {
    // Diam: napas halus saja, kaki tegak.
    const breath = Math.sin(phase * 0.5);
    return { thighL: 0, thighR: 0, kneeL: 0, kneeR: 0, armL: 0.03 * breath, armR: 0.03 * breath, elbow: 0.08, lean: 0.02 * breath, bob: 0.01 * breath };
  }
  // Jalan: paha kiri dan kanan berlawanan fase, lengan mengikuti paha sisi seberang.
  const swing = Math.sin(phase);
  const opposite = Math.sin(phase + Math.PI);
  return {
    thighL: 0.55 * swing,
    thighR: 0.55 * opposite,
    // Lutut menekuk saat kaki di belakang; max(0, ...) menjaga lutut tidak membengkok ke depan.
    kneeL: Math.max(0, 0.9 * Math.sin(phase - 0.6)),
    kneeR: Math.max(0, 0.9 * Math.sin(phase + Math.PI - 0.6)),
    armL: 0.45 * opposite,
    armR: 0.45 * swing,
    elbow: 0.3,
    lean: 0.06,
    // Dua kali per langkah: badan naik saat kaki menapak.
    bob: 0.025 * Math.cos(phase * 2),
  };
}

/**
 * GLSL kembaran `pedAnimPose` plus helper rotasi dan pemilihan pivot per bone.
 * Disisipkan ke vertex shader lewat onBeforeCompile; lihat PedestrianLayer.
 */
export const PED_ANIM_GLSL = /* glsl */ `
struct PedPose { float thighL; float thighR; float kneeL; float kneeR; float armL; float armR; float elbow; float lean; float bob; };

PedPose pedAnimPose(float anim, float phase) {
  PedPose p;
  if (anim > 1.5) {
    float fidget = 0.02 * sin(phase * 0.7);
    p = PedPose(-1.5707963, -1.5707963, 1.5707963, 1.5707963, -0.25 + fidget, -0.25 - fidget, 0.5, 0.12 + fidget, -${SIT_DROP.toFixed(2)});
  } else if (anim < 0.5) {
    float breath = sin(phase * 0.5);
    p = PedPose(0.0, 0.0, 0.0, 0.0, 0.03 * breath, 0.03 * breath, 0.08, 0.02 * breath, 0.01 * breath);
  } else {
    float swing = sin(phase);
    float opposite = sin(phase + 3.1415927);
    p = PedPose(
      0.55 * swing, 0.55 * opposite,
      max(0.0, 0.9 * sin(phase - 0.6)), max(0.0, 0.9 * sin(phase + 3.1415927 - 0.6)),
      0.45 * opposite, 0.45 * swing, 0.3, 0.06, 0.025 * cos(phase * 2.0)
    );
  }
  return p;
}

/** Rotasi titik di sekitar pivot pada sumbu X. */
vec3 pedRotX(vec3 point, vec3 pivot, float angle) {
  vec3 d = point - pivot;
  float c = cos(angle);
  float s = sin(angle);
  return pivot + vec3(d.x, c * d.y - s * d.z, s * d.y + c * d.z);
}

/**
 * Pose satu vertex. \`bone\` = indeks joint dari skinIndex.x (rig rigid: 1 bone per vertex).
 * 0 root, 1 hips, 2 spine, 3 chest, 4 head, 5/6 lengan kiri, 7/8 lengan kanan,
 * 9/10 kaki kiri, 11/12 kaki kanan.
 */
vec3 pedPoseVertex(vec3 pos, float bone, PedPose pose) {
  if (bone >= 9.0) {
    float left = bone < 11.0 ? 1.0 : 0.0;
    float x = mix(0.1, -0.1, left);
    float thigh = mix(pose.thighR, pose.thighL, left);
    float knee = mix(pose.kneeR, pose.kneeL, left);
    // Tulang bawah (10, 12) menekuk di lutut dulu, lalu ikut ayunan paha.
    if (bone == 10.0 || bone == 12.0) pos = pedRotX(pos, vec3(x, 0.5, 0.0), knee);
    pos = pedRotX(pos, vec3(x, 0.92, 0.0), thigh);
    return pos;
  }
  if (bone >= 5.0) {
    float left = bone < 7.0 ? 1.0 : 0.0;
    float x = mix(0.22, -0.22, left);
    float arm = mix(pose.armR, pose.armL, left);
    if (bone == 6.0 || bone == 8.0) pos = pedRotX(pos, vec3(x, 1.14, 0.0), pose.elbow);
    pos = pedRotX(pos, vec3(x, 1.42, 0.0), arm);
  }
  // Badan atas (spine ke atas, termasuk lengan) membungkuk dari pinggul; kaki tidak ikut.
  if (bone >= 2.0) pos = pedRotX(pos, vec3(0.0, 0.95, 0.0), pose.lean);
  return pos;
}
`;

/**
 * Rig + retarget prototipe hero slim (Notion 11.6).
 *
 * Sumber `slim_urban_hero.glb` adalah mesh statis Blender: 56 mesh node datar
 * (tanpa hierarki tulang), 12 material, ~27k tris, tanpa skin dan tanpa animasi.
 * Script ini menormalkan tinggi ke TARGET_HEIGHT, menyusun rig 13 tulang dengan
 * anchor anatomis dari bounds node sumber, menskin tiap node ke tulangnya lewat
 * peta nama bagian (weight 1.0), lalu meretarget klip rotation-only yang sudah ada
 * di defs/humanoid (Idle, Walk, Run, Sit, Talk).
 *
 * Output tetap artefak referensi (tools/reference/), bukan aset runtime: jalur
 * runtime hero tetap procedural rigged char_hero_m / char_hero_f.
 *
 * Usage: npx vite-node tools/reference/rig_slim_reference.ts
 */
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { dequantize, meshopt, simplify, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join as pathJoin, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { boundsOf, evaluateScene, type Triangle } from '../assets/lib/evaluate';
import { encodePng } from '../assets/lib/png';
import { composeSheet, renderTile, type View } from '../assets/lib/render';
import { quatFromEuler, type Vec3 } from '../assets/lib/math';
import { IDLE, RUN, SIT, TALK, WALK, type BoneName, type Clip } from '../assets/defs/humanoid';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(HERE, '../..');
const SOURCE = process.env.SLIM ?? '/root/.hermes/profiles/ui_ux_designer/cache/scratch/owc/urban/slim_urban_hero.glb';
const OUT_GLB = pathJoin(WEB_ROOT, 'tools/reference/slim_hero_rigged.glb');
const OUT_PNG = pathJoin(WEB_ROOT, 'asset-previews/slim_hero_rigged.png');

const TARGET_HEIGHT = 1.75;
/** Hero mobile budget (Notion 11.4): 8.000–25.000 tris. Aim for the middle of the band. */
const TARGET_TRIANGLES = 12000;
const FPS = 30;
const TILE = 256;
const VIEWS: View[] = [
  { yawDeg: 180, elevationDeg: 12, label: 'front' },
  { yawDeg: 225, elevationDeg: 25, label: 'three-quarter' },
  { yawDeg: 90, elevationDeg: 8, label: 'side' },
  { yawDeg: 0, elevationDeg: 25, label: 'back' },
  { yawDeg: 180, elevationDeg: 55, label: 'game-camera' },
];

/**
 * Rig 13 tulang, penamaan sejajar runtime supaya klip humanoid bisa dipakai.
 * Rest ditulis dalam SATUAN SUMBER (satuan node slim_urban_hero.glb) dan dikali
 * `scale` saat dipakai, karena mesh juga diskala ke TARGET_HEIGHT. Titik pivot
 * diambil dari node sumber: Pelvis 1.40, Waist 1.58, Chest 1.86, Neck 2.14,
 * UpperArm 1.80, ForeArm 1.36, Thigh top 1.40, Shin knee 0.82.
 */
const BONES: { name: BoneName; parent: number; rest: Vec3 }[] = [
  { name: 'root', parent: -1, rest: [0, 0, 0] },
  { name: 'hips', parent: 0, rest: [0, 1.4, 0] },
  { name: 'spine', parent: 1, rest: [0, 1.58, 0] },
  { name: 'chest', parent: 2, rest: [0, 1.86, 0] },
  { name: 'head', parent: 3, rest: [0, 2.14, 0] },
  { name: 'upperArm_L', parent: 3, rest: [-0.35, 1.8, 0] },
  { name: 'lowerArm_L', parent: 5, rest: [-0.42, 1.36, 0.03] },
  { name: 'upperArm_R', parent: 3, rest: [0.35, 1.8, 0] },
  { name: 'lowerArm_R', parent: 7, rest: [0.42, 1.36, 0.03] },
  { name: 'upperLeg_L', parent: 1, rest: [-0.14, 1.4, 0] },
  { name: 'lowerLeg_L', parent: 9, rest: [-0.135, 0.82, 0] },
  { name: 'upperLeg_R', parent: 1, rest: [0.14, 1.4, 0] },
  { name: 'lowerLeg_R', parent: 11, rest: [0.135, 0.82, 0] },
];
const boneIndex = (name: BoneName): number => BONES.findIndex((b) => b.name === name);

function boneForNode(nodeName: string): BoneName {
  if (/^(Sole_L|Sneak_L|Shin_L)/.test(nodeName)) return 'lowerLeg_L';
  if (/^(Sole_R|Sneak_R|Shin_R)/.test(nodeName)) return 'lowerLeg_R';
  if (/^Thigh_L/.test(nodeName)) return 'upperLeg_L';
  if (/^Thigh_R/.test(nodeName)) return 'upperLeg_R';
  if (/^(Pelvis|Hem)/.test(nodeName)) return 'hips';
  if (/^Waist/.test(nodeName)) return 'spine';
  if (/^(Chest|Chain)/.test(nodeName)) return 'chest';
  if (/^UpperArm_L/.test(nodeName)) return 'upperArm_L';
  if (/^UpperArm_R/.test(nodeName)) return 'upperArm_R';
  if (/^(ForeArm_L|Hand_L)/.test(nodeName)) return 'lowerArm_L';
  if (/^(ForeArm_R|Hand_R)/.test(nodeName)) return 'lowerArm_R';
  return 'head';
}


/** Sendi yang dihaluskan: vertex dalam BLEND_RADIUS dari sendi dicampur dengan tulang induknya. */
const BLEND_RADIUS = 0.07;

/**
 * Smooth skinning dua tulang. `bone` adalah tulang utama dari peta nama bagian.
 * Jika vertex berada dekat pangkal tulang (joint dengan parent), bobotnya dibagi ke parent
 * dengan falloff linear: di sendi 50/50, di luar BLEND_RADIUS 100% ke `bone`.
 * Posisi sendi diambil dari scaledRest (world space, sudah diskala).
 */
function smoothWeights(x: number, y: number, z: number, bone: number): [number, number, number, number] {
  const parent = BONES[bone]!.parent;
  if (parent < 0) return [bone, 1, bone, 0];
  const joint = SCALED_REST[bone]!;
  const dist = Math.hypot(x - joint[0], y - joint[1], z - joint[2]);
  if (dist >= BLEND_RADIUS) return [bone, 1, bone, 0];
  const t = 0.5 * (1 - dist / BLEND_RADIUS); // 0.5 di sendi, 0 di batas
  return [bone, 1 - t, parent, t];
}
let SCALED_REST: Vec3[] = [];

async function main(): Promise<void> {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

  const source = await io.read(SOURCE);
  await source.transform(dequantize());
  await MeshoptSimplifier.ready;
  // Decimate BEFORE rigging: weld/simplify would otherwise rebuild vertices and drop the
  // per-vertex JOINTS/WEIGHTS blend that smoothWeights writes below.
  const sourceTriangles = source.getRoot().listMeshes().reduce((sum, m) => sum + m.listPrimitives().reduce((k, pr) => k + (pr.getIndices()?.getCount() ?? 0) / 3, 0), 0);
  await source.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: TARGET_TRIANGLES / sourceTriangles, error: 0.02, lockBorder: true }));
  const sourceBounds = boundsOf(evaluateScene(source));
  const sourceHeight = sourceBounds.max[1]! - sourceBounds.min[1]!;
  const scale = TARGET_HEIGHT / sourceHeight;

  const root = source.getRoot();
  SCALED_REST = BONES.map((bone) => bone.rest.map((v) => v * scale) as Vec3);
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const joints: number[] = [];
  const weights: number[] = [];
  const indices: number[] = [];
  let vertexCount = 0;
  const materialNames = new Set<string>();

  const local = new Matrix4();
  const quat = new Quaternion();
  const v = new Vector3();
  const n = new Vector3();

  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const bone = boneIndex(boneForNode(node.getName()));
    const t = node.getTranslation();
    const r = node.getRotation();
    const s = node.getScale();
    quat.set(r[0]!, r[1]!, r[2]!, r[3]!);
    local.compose(new Vector3(t[0]!, t[1]!, t[2]!), quat, new Vector3(s[0]!, s[1]!, s[2]!));

    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute('POSITION');
      const normal = prim.getAttribute('NORMAL');
      if (!position) continue;
      const count = position.getCount();
      const posArr = position.getArray();
      const nrmArr = normal?.getArray();
      const material = prim.getMaterial();
      if (material) materialNames.add(material.getName());
      const base = material?.getBaseColorFactor() ?? [1, 1, 1, 1];

      const offset = vertexCount;
      for (let i = 0; i < count; i++) {
        v.set(posArr[i * 3]!, posArr[i * 3 + 1]!, posArr[i * 3 + 2]!).applyMatrix4(local).multiplyScalar(scale);
        positions.push(v.x, v.y, v.z);
        if (nrmArr) {
          n.set(nrmArr[i * 3]!, nrmArr[i * 3 + 1]!, nrmArr[i * 3 + 2]!).applyQuaternion(quat).normalize();
          normals.push(n.x, n.y, n.z);
        } else normals.push(0, 1, 0);
        colors.push(base[0] ?? 1, base[1] ?? 1, base[2] ?? 1, 1);
        const [j0, w0, j1, w1] = smoothWeights(v.x, v.y, v.z, bone);
        joints.push(j0, j1, 0, 0);
        weights.push(w0, w1, 0, 0);
      }
      const primIndices = prim.getIndices()?.getArray();
      if (primIndices) for (let i = 0; i < primIndices.length; i++) indices.push(offset + primIndices[i]!);
      else for (let i = 0; i < count; i++) indices.push(offset + i);
      vertexCount += count;
    }
  }

  const doc = new Document();
  doc.getRoot().getAsset().generator = 'openworld-city slim hero rig (Notion 11.6)';
  const buffer = doc.createBuffer('buffer');
  const acc = (type: 'SCALAR' | 'VEC3' | 'VEC4', array: Float32Array | Uint16Array | Uint32Array) =>
    doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);

  const scaledRest = BONES.map((bone) => bone.rest.map((v) => v * scale) as Vec3);
  const jointNodes = BONES.map((bone, i) => {
    const rest = scaledRest[i]!;
    const localPos: Vec3 = bone.parent >= 0
      ? [rest[0] - scaledRest[bone.parent]![0], rest[1] - scaledRest[bone.parent]![1], rest[2] - scaledRest[bone.parent]![2]]
      : rest;
    return doc.createNode(`bone_${bone.name}`).setTranslation(localPos);
  });
  BONES.forEach((bone, i) => {
    const parent = jointNodes[bone.parent];
    if (parent) parent.addChild(jointNodes[i]!);
  });

  const inverseBind = new Float32Array(BONES.length * 16);
  scaledRest.forEach((rest, i) => {
    inverseBind.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -rest[0], -rest[1], -rest[2], 1], i * 16);
  });
  const skin = doc.createSkin('skin_slim_hero').setSkeleton(jointNodes[0]!);
  const ibmAccessor = doc.createAccessor('inverseBind').setType('MAT4').setArray(inverseBind).setBuffer(buffer);
  skin.setInverseBindMatrices(ibmAccessor);
  jointNodes.forEach((joint) => skin.addJoint(joint));

  const material = doc.createMaterial('mat_slim_atlas').setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(0).setRoughnessFactor(0.75);
  const mesh = doc.createMesh('slim_hero');
  mesh.addPrimitive(
    doc
      .createPrimitive()
      .setAttribute('POSITION', acc('VEC3', new Float32Array(positions)))
      .setAttribute('NORMAL', acc('VEC3', new Float32Array(normals)))
      .setAttribute('COLOR_0', acc('VEC4', new Float32Array(colors)))
      .setAttribute('JOINTS_0', acc('VEC4', new Uint16Array(joints)))
      .setAttribute('WEIGHTS_0', acc('VEC4', new Float32Array(weights)))
      .setIndices(acc('SCALAR', vertexCount > 65535 ? new Uint32Array(indices) : new Uint16Array(indices)))
      .setMaterial(material),
  );

  const scene = doc.createScene('slim_hero').addChild(jointNodes[0]!);
  scene.addChild(doc.createNode('slim_hero').setMesh(mesh).setSkin(skin));
  doc.getRoot().setDefaultScene(scene);

  const clips: Clip[] = [IDLE, WALK, RUN, SIT, TALK];
  const hipsRest = scaledRest[boneIndex('hips')]!;
  for (const clip of clips) {
    const frames = Math.max(2, Math.round(clip.duration * FPS));
    const times = new Float32Array(frames + 1);
    const rotations = BONES.map(() => new Float32Array((frames + 1) * 4));
    const hipsTranslation = new Float32Array((frames + 1) * 3);
    for (let frame = 0; frame <= frames; frame++) {
      times[frame] = (frame / frames) * clip.duration;
      const pose = clip.pose(frame === frames ? 0 : frame / frames);
      BONES.forEach((bone, i) => rotations[i]!.set(quatFromEuler(pose.rot[bone.name] ?? [0, 0, 0]), frame * 4));
      const offset = pose.hips ?? [0, 0, 0];
      hipsTranslation.set([hipsRest[0] + offset[0], hipsRest[1] + offset[1], hipsRest[2] + offset[2]], frame * 3);
    }
    const animation = doc.createAnimation(clip.name);
    const input = acc('SCALAR', times);
    const addTrack = (node: (typeof jointNodes)[number], path: 'rotation' | 'translation', values: Float32Array) => {
      const sampler = doc
        .createAnimationSampler()
        .setInput(input)
        .setOutput(acc(path === 'rotation' ? 'VEC4' : 'VEC3', values))
        .setInterpolation('LINEAR');
      animation.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler));
    };
    BONES.forEach((_, i) => {
      if (i > 0) addTrack(jointNodes[i]!, 'rotation', rotations[i]!);
    });
    addTrack(jointNodes[boneIndex('hips')]!, 'translation', hipsTranslation);
  }

  const before = sourceTriangles;
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const glb = await io.writeBinary(doc);
  await mkdir(dirname(OUT_GLB), { recursive: true });
  await writeFile(OUT_GLB, glb);

  const triangles: Triangle[] = evaluateScene(doc);
  const tiles = VIEWS.map((view) => renderTile(triangles, view, TILE));
  const sheet = composeSheet(tiles, TILE, 5);
  await mkdir(dirname(OUT_PNG), { recursive: true });
  await writeFile(OUT_PNG, encodePng(sheet.width, sheet.height, sheet.rgb));

  const outBounds = boundsOf(triangles);
  const size = (b: { min: number[]; max: number[] }) => b.max.map((val, i) => Number((val - (b.min[i] ?? 0)).toFixed(3)));
  const triangleTotal = doc.getRoot().listMeshes().reduce((sum, m) => sum + m.listPrimitives().reduce((k, pr) => k + (pr.getIndices()?.getCount() ?? 0) / 3, 0), 0);
  console.log(JSON.stringify({
    source: { triangles: 27028, size: size(sourceBounds) },
    rigged: {
      triangles: triangleTotal,
      trianglesBeforeDecimate: before,
      vertices: vertexCount,
      materials: materialNames.size,
      bones: BONES.length,
      animations: doc.getRoot().listAnimations().map((a) => a.getName()),
      size: size(outBounds),
      scaleApplied: Number(scale.toFixed(4)),
      bytes: glb.byteLength,
    },
    out: { glb: OUT_GLB, png: OUT_PNG },
  }, null, 2));
}

await main();

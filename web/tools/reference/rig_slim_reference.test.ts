/**
 * Guard untuk artefak referensi rig slim hero (Notion 11.6).
 *
 * Membaca GLB yang dihasilkan `rig_slim_reference.ts` dan memastikan kontrak yang
 * dipakai saat implementasi runtime tidak rusak: 13 tulang, 5 klip yang namanya
 * cocok dengan defs/humanoid, tinggi mendekati TARGET_HEIGHT, skin lengkap, dan
 * setiap vertex punya bobot total 1.
 */
import { NodeIO, type Document } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { boundsOf, evaluateScene } from '../assets/lib/evaluate';

const GLB = fileURLToPath(new URL('./slim_hero_rigged.glb', import.meta.url));
const EXPECTED_CLIPS = ['anim_Idle', 'anim_Walk', 'anim_Run', 'anim_Sit', 'anim_Talk'];
const TARGET_HEIGHT = 1.75;

let doc: Document;

beforeAll(async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  doc = await io.readBinary(await readFile(GLB));
  await doc.transform(dequantize());
});

describe('slim_hero_rigged.glb', () => {
  it('has one skin with 13 joints and a root at the origin', () => {
    const skins = doc.getRoot().listSkins();
    expect(skins).toHaveLength(1);
    expect(skins[0]!.listJoints()).toHaveLength(13);
    const rootBone = skins[0]!.listJoints()[0]!;
    expect(rootBone.getName()).toBe('bone_root');
    expect(rootBone.getTranslation()).toEqual([0, 0, 0]);
  });

  it('exposes every runtime clip by name', () => {
    const names = doc.getRoot().listAnimations().map((a) => a.getName()).sort();
    expect(names).toEqual([...EXPECTED_CLIPS].sort());
  });

  it('skins every vertex with unit total weight and a valid joint index', () => {
    const joints = doc.getRoot().listSkins()[0]!.listJoints().length;
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const j = prim.getAttribute('JOINTS_0');
        const w = prim.getAttribute('WEIGHTS_0');
        expect(j).not.toBeNull();
        expect(w).not.toBeNull();
        const ja = j!.getArray();
        const wa = w!.getArray();
        for (let i = 0; i < ja.length; i += 4) {
          expect(ja[i]!).toBeGreaterThanOrEqual(0);
          expect(ja[i]!).toBeLessThan(joints);
          const sum = wa[i]! + wa[i + 1]! + wa[i + 2]! + wa[i + 3]!;
          expect(Math.abs(sum - 1)).toBeLessThan(1e-3);
        }
      }
    }
  });

  it('keeps a single material and stands at the runtime height', () => {
    expect(doc.getRoot().listMaterials()).toHaveLength(1);
    const b = boundsOf(evaluateScene(doc));
    expect(b.min[1]!).toBeGreaterThanOrEqual(-0.02);
    expect(b.max[1]! - b.min[1]!).toBeCloseTo(TARGET_HEIGHT, 1);
  });
});

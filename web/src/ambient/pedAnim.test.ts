import { readFileSync } from 'node:fs';
import type { SkinnedMesh } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { describe, expect, it } from 'vitest';
import { bakeBindPose, PED_ANIM_GLSL, pedAnimPose, SIT_DROP, STRIDE } from './pedAnim';

describe('animasi prosedural warga', () => {
  it('saat jalan kaki kiri dan kanan berayun berlawanan, lutut tidak pernah menekuk ke depan', () => {
    for (let i = 0; i < 64; i++) {
      const pose = pedAnimPose('walk', (i / 64) * Math.PI * 2);
      expect(pose.thighL).toBeCloseTo(-pose.thighR);
      expect(pose.armL).toBeCloseTo(-pose.armR);
      // Lengan berlawanan dengan paha sisi yang sama.
      expect(Math.sign(pose.armL) * Math.sign(pose.thighL)).toBeLessThanOrEqual(0);
      expect(pose.kneeL).toBeGreaterThanOrEqual(0);
      expect(pose.kneeR).toBeGreaterThanOrEqual(0);
    }
  });

  it('duduk menurunkan pinggul setinggi bangku dan paha mendatar ke depan', () => {
    const pose = pedAnimPose('sit', 1);
    expect(pose.bob).toBe(-SIT_DROP);
    expect(pose.thighL).toBeCloseTo((88 * Math.PI) / 180);
  });

  it('diam hampir tidak bergerak, dan GLSL memakai konstanta yang sama', () => {
    const pose = pedAnimPose('idle', 2);
    expect(Math.abs(pose.thighL) + Math.abs(pose.kneeL)).toBe(0);
    expect(Math.abs(pose.bob)).toBeLessThan(0.02);
    expect(STRIDE).toBeGreaterThan(0);
    expect(PED_ANIM_GLSL).toContain(`-${SIT_DROP.toFixed(2)}`);
    expect(PED_ANIM_GLSL).toContain('-28.0 * DEG * swing, 28.0 * DEG * swing');
  });

  it('bind pose GLB terkuantisasi dibakar ke meter: tinggi 0..1.775 m dan bone sesuai pivot', async () => {
    const file = readFileSync('public/assets/ped_citizen.glb');
    const gltf = await new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '');
    let mesh: SkinnedMesh | undefined;
    gltf.scene.traverse((child) => {
      if ((child as SkinnedMesh).isSkinnedMesh) mesh = child as SkinnedMesh;
    });
    const geometry = bakeBindPose(mesh!);
    const box = geometry.boundingBox!;
    expect(box.min.y).toBeCloseTo(0, 2);
    expect(box.max.y).toBeCloseTo(1.775, 2);
    expect(geometry.getAttribute('skinIndex')).toBeUndefined();
    // Lutut kiri (bone 10) seluruhnya di bawah pivot paha 0.92, kepala (4) di atas bahu 1.42.
    const pos = geometry.getAttribute('position');
    const bone = geometry.getAttribute('bone');
    for (let i = 0; i < pos.count; i++) {
      if (bone.getX(i) === 10) expect(pos.getY(i)).toBeLessThan(0.92);
      if (bone.getX(i) === 4) expect(pos.getY(i)).toBeGreaterThan(1.3);
    }
  });
});

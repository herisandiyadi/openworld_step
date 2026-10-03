import { readFileSync } from 'node:fs';
import type { SkinnedMesh } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { describe, expect, it } from 'vitest';
import {
  bakeBindPose,
  PED_ANIM_GLSL,
  PED_GROUP,
  PED_MESHES,
  PED_VARIANTS,
  pedAnimPose,
  pedHasGroup,
  pedMeshIndex,
  pedStyleMask,
  pedTintSlot,
  pedVariantIndex,
  pedVertexVisible,
  SIT_DROP,
  splitPedsByMesh,
  STRIDE,
} from './pedAnim';
import { generateResidents } from './residents';

async function loadPed(id: string): Promise<SkinnedMesh> {
  const file = readFileSync(`public/assets/${id}.glb`);
  const gltf = await new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '');
  let mesh: SkinnedMesh | undefined;
  gltf.scene.traverse((child) => {
    if ((child as SkinnedMesh).isSkinnedMesh) mesh = child as SkinnedMesh;
  });
  return mesh!;
}

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

  it.each(['ped_citizen', 'ped_citizen_f'])('bind pose %s dibakar ke meter: bone sesuai pivot rig bersama', async (id) => {
    const geometry = bakeBindPose(await loadPed(id));
    const box = geometry.boundingBox!;
    expect(box.min.y).toBeCloseTo(0, 2);
    expect(box.max.y).toBeGreaterThan(1.74);
    expect(box.max.y).toBeLessThan(1.83);
    expect(geometry.getAttribute('skinIndex')).toBeUndefined();
    // Lutut kiri (bone 10) seluruhnya di bawah pivot paha 0.92, kepala (4) di atas bahu 1.42.
    const pos = geometry.getAttribute('position');
    const bone = geometry.getAttribute('bone');
    const tint = geometry.getAttribute('_tint');
    expect(tint.count).toBe(pos.count);
    for (let i = 0; i < pos.count; i++) {
      if (bone.getX(i) === 10) expect(pos.getY(i)).toBeLessThan(0.92);
      // Rambut panjang/jilbab wanita ikut bone kepala dan menjuntai sampai ~1.26 m, masih jauh di atas pinggul.
      if (bone.getX(i) === 4) expect(pos.getY(i)).toBeGreaterThan(1.2);
    }
  });

  it('model wanita lebih ramping di bahu dan punya grup rok/jilbab/kuncir', async () => {
    const width = (geometry: ReturnType<typeof bakeBindPose>, minY: number, maxY: number) => {
      const pos = geometry.getAttribute('position');
      let w = 0;
      for (let i = 0; i < pos.count; i++) if (pos.getY(i) > minY && pos.getY(i) < maxY) w = Math.max(w, Math.abs(pos.getX(i)));
      return w;
    };
    const male = bakeBindPose(await loadPed('ped_citizen'));
    const female = bakeBindPose(await loadPed('ped_citizen_f'));
    // Bahu/lengan atas (y 1.25-1.45): wanita jelas lebih sempit.
    expect(width(female, 1.25, 1.45)).toBeLessThan(width(male, 1.25, 1.45) - 0.025);
    const groups = (geometry: ReturnType<typeof bakeBindPose>) => {
      const tint = geometry.getAttribute('_tint');
      const out = new Set<number>();
      for (let i = 0; i < tint.count; i++) out.add(Math.floor(tint.getX(i) / 8));
      return out;
    };
    const f = groups(female);
    for (const g of [PED_GROUP.skirt, PED_GROUP.ponytail, PED_GROUP.looseHair, PED_GROUP.hijab, PED_GROUP.baseHair]) expect(f.has(g)).toBe(true);
    expect(groups(male).has(PED_GROUP.cap)).toBe(true);
  });
});

describe('pemetaan gender warga ke mesh', () => {
  const residents = generateResidents();

  it('warga Bu/Mbak memakai mesh wanita, Pak/Mas memakai mesh pria', () => {
    for (const r of residents) {
      const mesh = PED_MESHES[pedMeshIndex(r)]!;
      expect(mesh.gender).toBe(r.gender);
      expect(mesh.asset).toBe(/^(Bu|Mbak) /.test(r.name) ? 'ped_citizen_f' : 'ped_citizen');
    }
    // Pejalan tanpa warga (residentIndex -1) jatuh ke mesh pria, bukan error.
    expect(pedMeshIndex(undefined)).toBe(0);
  });

  it('splitPedsByMesh: tiap pejalan tepat di satu mesh sesuai gendernya, urutan stabil, tidak melebihi kapasitas', () => {
    const peds = Array.from({ length: 26 }, (_, i) => ({ id: 100 + i, residentIndex: (i * 7) % residents.length }));
    peds.push({ id: 999, residentIndex: -1 });
    const { slots, dropped } = splitPedsByMesh(peds, residents, 26);
    expect(dropped).toBe(0);
    expect(slots[0].length + slots[1].length).toBe(peds.length);
    const ids = [...slots[0], ...slots[1]].map((p) => p.id);
    expect(new Set(ids).size).toBe(peds.length);
    for (const ped of slots[1]) expect(residents[ped.residentIndex]!.gender).toBe('f');
    for (const ped of slots[0]) expect(residents[ped.residentIndex]?.gender ?? 'm').toBe('m');
    // Urutan dalam tiap mesh mengikuti urutan world.peds.
    expect(slots[1].map((p) => p.id)).toEqual(peds.filter((p) => residents[p.residentIndex]?.gender === 'f').map((p) => p.id));
    // Kapasitas kecil: kelebihan dibuang dan dihitung, tidak menimpa slot.
    const tight = splitPedsByMesh(peds, residents, 3);
    expect(tight.slots[0].length).toBeLessThanOrEqual(3);
    expect(tight.slots[1].length).toBe(3);
    expect(tight.slots[0].length + tight.slots[1].length + tight.dropped).toBe(peds.length);
  });

  it('gaya per warga tetap dan masuk akal: wanita berambut atau berjilbab, pria bertopi menyembunyikan poni', () => {
    let hijab = 0;
    let skirt = 0;
    let cap = 0;
    residents.forEach((r, index) => {
      const mask = pedStyleMask(r.gender, index);
      expect(pedStyleMask(r.gender, index)).toBe(mask);
      expect(pedHasGroup(mask, PED_GROUP.cap) && pedHasGroup(mask, PED_GROUP.baseHair)).toBe(false);
      if (r.gender === 'f') {
        // Tepat satu dari: jilbab, atau rambut dasar + (kuncir xor terurai).
        const h = pedHasGroup(mask, PED_GROUP.hijab);
        const tail = pedHasGroup(mask, PED_GROUP.ponytail);
        const loose = pedHasGroup(mask, PED_GROUP.looseHair);
        expect(h ? !tail && !loose && !pedHasGroup(mask, PED_GROUP.baseHair) : tail !== loose && pedHasGroup(mask, PED_GROUP.baseHair)).toBe(true);
        expect(pedHasGroup(mask, PED_GROUP.cap)).toBe(false);
        if (h) hijab++;
        if (pedHasGroup(mask, PED_GROUP.skirt)) skirt++;
      } else {
        expect(pedHasGroup(mask, PED_GROUP.skirt) || pedHasGroup(mask, PED_GROUP.hijab)).toBe(false);
        if (pedHasGroup(mask, PED_GROUP.cap)) cap++;
      }
      expect(pedVariantIndex(r.gender, index)).toBeLessThan(PED_VARIANTS[r.gender].length);
    });
    expect(hijab).toBeGreaterThan(5);
    expect(skirt).toBeGreaterThan(15);
    expect(cap).toBeGreaterThan(4);
    // Varian warna wanita benar-benar beragam di antara 30 warga wanita.
    expect(new Set(residents.map((r, i) => (r.gender === 'f' ? pedVariantIndex('f', i) : -1)).filter((v) => v >= 0)).size).toBe(PED_VARIANTS.f.length);
  });

  it('kode _TINT: grup tersembunyi kalau bit mati, kaki wanita kulit kalau berok dan warna bawahan kalau tidak', () => {
    const skirtOn = pedStyleMask('f', 1);
    expect(pedHasGroup(skirtOn, PED_GROUP.skirt)).toBe(true);
    expect(pedVertexVisible(1, 0)).toBe(true);
    expect(pedVertexVisible(2 + 8 * PED_GROUP.skirt, skirtOn)).toBe(true);
    expect(pedVertexVisible(2 + 8 * PED_GROUP.skirt, 0)).toBe(false);
    expect(pedTintSlot(0, skirtOn)).toBe(-1);
    expect(pedTintSlot(1, 0)).toBe(0);
    expect(pedTintSlot(3 + 8 * PED_GROUP.ponytail, 0)).toBe(2);
    expect(pedTintSlot(4 + 8 * PED_GROUP.hijab, 0)).toBe(3);
    expect(pedTintSlot(5, skirtOn)).toBe(-1);
    expect(pedTintSlot(5, 0)).toBe(1);
    // GLSL punya kembaran ketiga helper.
    for (const name of ['bool pedHasGroup(', 'bool pedStyleVisible(', 'int pedStyleSlot(']) expect(PED_ANIM_GLSL).toContain(name);
    expect(PED_ANIM_GLSL).toContain(`pedHasGroup(mask, ${PED_GROUP.skirt}.0)`);
  });

  it('PED_VARIANTS sama dengan meta.variants di manifest aset', () => {
    const manifest = JSON.parse(readFileSync('public/assets/manifest.json', 'utf8')) as { assets: { id: string; meta?: { variants?: unknown } }[] };
    for (const { gender, asset } of PED_MESHES) {
      expect(manifest.assets.find((a) => a.id === asset)?.meta?.variants).toEqual(PED_VARIANTS[gender]);
    }
  });
});

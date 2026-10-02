import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, Fog, type HemisphereLight, type InstancedMesh, type Material, type Mesh, MeshLambertMaterial, MeshStandardMaterial, Vector3 } from 'three';
import type { Listener } from '../audio/ambientAudio';
import { ambientAudio } from '../audio/ambientAudio';
import { DAY_SECONDS, clockLabel, daylightAt } from './dayCycle';
import { dayClock, lighting } from './runtime';
import { useGameStore } from '../state/gameStore';

const NIGHT_SKY = new Color('#1c2740');
const DAY_SKY = new Color('#bcd3e6');
const DUSK_SKY = new Color('#f1a46a');
const FOG_NEAR = 60;
const FOG_FAR = 140;

/** Suasana malam (TASKS D2): seberapa terang bohlam lampu jalan dan jendela saat gelap total. */
const LAMP_NIGHT = 2.2;
const WINDOW_NIGHT = 0.22;
const WINDOW_COLOR = new Color('#ffd9a0');
/**
 * Material dianggap bohlam (lampu jalan, lampu mobil) kalau emissive-nya putih/kuning pucat (PALETTE.lamp).
 * Node `lamp_*` lampu lalu lintas dilewati: emissive-nya milik trafficLights (wave 2).
 */
type LitMaterial = MeshStandardMaterial | MeshLambertMaterial;
const isLit = (material: Material): material is LitMaterial =>
  (material instanceof MeshStandardMaterial || material instanceof MeshLambertMaterial) &&
  Math.min(material.emissive.r, material.emissive.g, material.emissive.b) > 0.25;

/**
 * Day/night cycle: sky/fog colour and light intensities (no extra passes). Malam juga menyalakan
 * bohlam lampu jalan/lampu lalu lintas (emissive naik) dan memberi jendela gedung cahaya hangat.
 * Fog fase A (60-140 m) tidak diubah.
 */
export function DayNight() {
  const scene = useThree((state) => state.scene);
  const hemiRef = useRef<HemisphereLight>(null);
  const sky = useRef(new Color());
  // Material bohlam yang ditemukan di scene, dengan intensitas aslinya (siang).
  const lamps = useRef(new Map<LitMaterial, number>());
  const windows = useRef(new Set<MeshLambertMaterial>());
  const lampScan = useRef(0);
  const forward = useRef(new Vector3());
  const listener = useRef<Listener>({ x: 0, z: 0, dirX: 0, dirZ: -1 });

  // Kamera rendah: fog 60-140 m menutupi batas streaming (radius muat 2 chunk = 128 m).
  useEffect(() => {
    if (!(scene.fog instanceof Fog)) return;
    scene.fog.near = FOG_NEAR;
    scene.fog.far = FOG_FAR;
  }, [scene]);

  // Audio ambient ikut jam yang sama; senyap saat menu/chat/peta terbuka (frameloop berhenti).
  useEffect(() => {
    const silence = (state: ReturnType<typeof useGameStore.getState>) => {
      if (state.paused || state.chatNpcId !== null || state.busMenuOpen || state.mapOpen) ambientAudio.update(null, dayClock.t, 0, false);
    };
    const unsubscribe = useGameStore.subscribe(silence);
    return () => {
      unsubscribe();
      ambientAudio.update(null, dayClock.t, 0, false);
    };
  }, []);

  useFrame(({ camera }, delta) => {
    dayClock.t = (dayClock.t + Math.min(delta, 0.05) / DAY_SECONDS) % 1;
    const { daylight, dusk } = daylightAt(dayClock.t);
    const night = 1 - daylight;
    const store = useGameStore.getState();
    // Pendengar ambient = kamera, arah pandang diproyeksikan ke bidang XZ.
    camera.getWorldDirection(forward.current);
    Object.assign(listener.current, { x: camera.position.x, z: camera.position.z, dirX: forward.current.x, dirZ: forward.current.z });
    ambientAudio.update(store.district, dayClock.t, Math.min(delta, 0.05), !store.mapOpen, listener.current);

    // Cari material bohlam dan gedung tiap 2 detik (chunk baru terus di-stream masuk).
    lampScan.current -= delta;
    if (lampScan.current <= 0) {
      lampScan.current = 2;
      scene.traverse((object) => {
        const mesh = object as Mesh;
        if (!mesh.isMesh || mesh.name.startsWith('lamp_')) return;
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if (lamps.current.has(material as LitMaterial)) continue;
          if (isLit(material)) lamps.current.set(material, material.emissiveIntensity);
          // Gedung: InstancedMesh langsung di bawah grup chunk_* (prop ada di sub-grup).
          else if ((mesh as InstancedMesh).isInstancedMesh && mesh.parent?.name.startsWith('chunk_') && material instanceof MeshLambertMaterial)
            windows.current.add(material);
        }
      });
    }
    for (const [material, base] of lamps.current) material.emissiveIntensity = base + (LAMP_NIGHT - base) * night;
    // ponytail: semua jendela menyala seragam lewat emissive material gedung bersama. Jendela acak per
    // gedung butuh atribut per-instance di chunkStreamer.ts (di luar cakupan); tambahkan saat perlu.
    for (const material of windows.current) material.emissive.copy(WINDOW_COLOR).multiplyScalar(WINDOW_NIGHT * night);
    const color = sky.current.copy(NIGHT_SKY).lerp(DAY_SKY, daylight).lerp(DUSK_SKY, dusk * 0.45);
    if (scene.background instanceof Color) scene.background.copy(color);
    if (scene.fog instanceof Fog) scene.fog.color.copy(color);
    lighting.sun = 0.08 + 0.92 * daylight;
    if (hemiRef.current) hemiRef.current.intensity = 0.35 + 0.75 * daylight;
    const label = clockLabel(dayClock.t);
    if (label !== store.clock) store.setClock(label);
  });

  return <hemisphereLight ref={hemiRef} args={['#eaf4ff', '#7d8f6a', 1.1]} />;
}
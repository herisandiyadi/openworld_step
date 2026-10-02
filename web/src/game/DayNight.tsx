import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, Fog, type HemisphereLight } from 'three';
import { DAY_SECONDS, clockLabel, daylightAt } from './dayCycle';
import { dayClock, lighting } from './runtime';
import { useGameStore } from '../state/gameStore';

const NIGHT_SKY = new Color('#1c2740');
const DAY_SKY = new Color('#bcd3e6');
const DUSK_SKY = new Color('#f1a46a');
const FOG_NEAR = 60;
const FOG_FAR = 140;

/** Simple day/night cycle: only sky/fog colour and light intensities change (no extra passes). */
export function DayNight() {
  const scene = useThree((state) => state.scene);
  const hemiRef = useRef<HemisphereLight>(null);
  const sky = useRef(new Color());

  // Kamera rendah: fog 60-140 m menutupi batas streaming (radius muat 2 chunk = 128 m).
  useEffect(() => {
    if (!(scene.fog instanceof Fog)) return;
    scene.fog.near = FOG_NEAR;
    scene.fog.far = FOG_FAR;
  }, [scene]);

  useFrame((_, delta) => {
    dayClock.t = (dayClock.t + Math.min(delta, 0.05) / DAY_SECONDS) % 1;
    const { daylight, dusk } = daylightAt(dayClock.t);
    const color = sky.current.copy(NIGHT_SKY).lerp(DAY_SKY, daylight).lerp(DUSK_SKY, dusk * 0.45);
    if (scene.background instanceof Color) scene.background.copy(color);
    if (scene.fog instanceof Fog) scene.fog.color.copy(color);
    lighting.sun = 0.08 + 0.92 * daylight;
    if (hemiRef.current) hemiRef.current.intensity = 0.35 + 0.75 * daylight;
    const label = clockLabel(dayClock.t);
    if (label !== useGameStore.getState().clock) useGameStore.getState().setClock(label);
  });

  return <hemisphereLight ref={hemiRef} args={['#eaf4ff', '#7d8f6a', 1.1]} />;
}
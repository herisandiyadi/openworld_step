import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { ClipPlayer, useCharacter } from './character';
import { animState, playerMotion } from './runtime';
import { ANIM, BIKE } from './vehicleSpec';
import { applyAppearance, heroAssetId } from './HeroAppearance';
import { DEFAULT_APPEARANCE, usePlayerProfile } from '../state/profile';
import { cameraState, HERO_HIDE_DISTANCE } from '../camera/followCamera';
import type { MoveMode } from '../state/gameStore';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Picks the clip and playback rate from traversal mode and ground speed so feet/pedals don't slide. */
function selectClip(mode: MoveMode, speed: number): { name: string; timeScale: number } {
  // Motorbike reuses the seated bicycle pose, frozen (no pedalling).
  if (mode === 'moto') return { name: 'anim_Bike', timeScale: 0 };
  if (mode === 'bike') return { name: 'anim_Bike', timeScale: (speed / BIKE.metersPerCrankTurn) * ANIM.bikeCycle };
  if (mode === 'skate') return { name: 'anim_Skate', timeScale: 1 };
  if (speed < 0.3) return { name: 'anim_Idle', timeScale: 1 };
  if (speed < 3) return { name: 'anim_Walk', timeScale: clamp(speed / ANIM.walkSpeed, 0.6, 2) };
  return { name: 'anim_Run', timeScale: clamp(speed / ANIM.runSpeed, 0.7, 1.6) };
}

/** Transisi ke/dari klip duduk (detik). */
const SIT_FADE = 0.4;

export function Hero({ mode, seated = false }: { mode: MoveMode; seated?: boolean }) {
  // Penampilan milik profil (bukan save game), jadi dibaca sekali saat hero dipasang.
  const appearance = usePlayerProfile((state) => state.profile?.appearance) ?? DEFAULT_APPEARANCE;
  const { scene, mixer, actions } = useCharacter(heroAssetId(appearance));
  const player = useMemo(() => new ClipPlayer(), []);
  useEffect(() => applyAppearance(scene, appearance), [scene, appearance]);

  useFrame((_, delta) => {
    // ponytail: GLB hero belum punya anim_Sit (dibuat lewat npm run assets, E1); sampai ada, pakai Idle.
    const sit = seated ? (actions.get('anim_Sit') ?? actions.get('anim_Idle')) : undefined;
    const { name, timeScale } = selectClip(mode, playerMotion.speed);
    const action = sit ?? actions.get(name);
    if (action) {
      player.play(action, seated || player.wasSitting ? SIT_FADE : undefined);
      action.timeScale = sit ? 1 : timeScale;
    }
    player.wasSitting = seated;
    mixer.update(Math.min(delta, 0.05));
    // Kamera terlalu dekat (terdorong gedung): sembunyikan pemain supaya layar tidak tertutup badan.
    scene.visible = cameraState.distance >= HERO_HIDE_DISTANCE;
    const bike = actions.get('anim_Bike');
    if (bike) animState.bikePhase = bike.time / bike.getClip().duration;
  });

  return <primitive object={scene} />;
}
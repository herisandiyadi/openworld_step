import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { ClipPlayer, useCharacter } from './character';
import { animState, playerMotion } from './runtime';
import { ANIM, BIKE } from './vehicleSpec';
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

export function Hero({ mode }: { mode: MoveMode }) {
  const { scene, mixer, actions } = useCharacter('char_hero');
  const player = useMemo(() => new ClipPlayer(), []);

  useFrame((_, delta) => {
    const { name, timeScale } = selectClip(mode, playerMotion.speed);
    const action = actions.get(name);
    if (action) {
      player.play(action);
      action.timeScale = timeScale;
    }
    mixer.update(Math.min(delta, 0.05));
    const bike = actions.get('anim_Bike');
    if (bike) animState.bikePhase = bike.time / bike.getClip().duration;
  });

  return <primitive object={scene} />;
}
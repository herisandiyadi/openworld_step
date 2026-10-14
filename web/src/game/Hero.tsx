import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { type Bone } from 'three';
import { ClipPlayer, useCharacter } from './character';
import { animState, playerMotion } from './runtime';
import { ANIM, BIKE } from './vehicleSpec';
import { applyAppearance, heroAssetId } from './HeroAppearance';
import { DEFAULT_APPEARANCE, usePlayerProfile } from '../state/profile';
import { cameraState, HERO_HIDE_DISTANCE } from '../camera/followCamera';
import { castPhases, smoothCast } from '../fishing/fishingPose';
import type { MoveMode } from '../state/gameStore';
import type { FishingSession } from '../fishing/FishingController';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Picks the clip and playback rate from traversal mode and ground speed so feet/pedals don't slide. */
export function selectClip(mode: MoveMode, speed: number): { name: string; timeScale: number } {
  if (mode === 'moto') return { name: 'anim_Bike', timeScale: 0 };
  if (mode === 'bike') return { name: 'anim_Bike', timeScale: (speed / BIKE.metersPerCrankTurn) * ANIM.bikeCycle };
  if (mode === 'skate') return { name: 'anim_Skate', timeScale: 1 };
  if (speed < 0.3) return { name: 'anim_Idle', timeScale: 1 };
  if (speed < 3) return { name: 'anim_Walk', timeScale: clamp(speed / ANIM.walkSpeed, 0.6, 2) };
  return { name: 'anim_Run', timeScale: clamp(speed / ANIM.runSpeed, 0.7, 1.6) };
}

const SIT_FADE = 0.4;

/** Real anim_Cast clip when the GLB ships one; otherwise the procedural upper-body fallback. */
export const shouldUseFishingFallback = (clips: readonly string[]): boolean => !clips.includes('anim_Cast');

export function useFishingPose(
  fishing: boolean,
  clips: readonly string[],
  progress: number,
): { fallback: boolean; clip: string | null } {
  if (!fishing) return { fallback: true, clip: null };
  if (!shouldUseFishingFallback(clips)) return { fallback: false, clip: 'anim_Cast' };
  return { fallback: true, clip: progress >= 1 ? null : 'anim_Idle' };
}

export function Hero({
  mode,
  seated = false,
  fishing = null,
}: {
  mode: MoveMode;
  seated?: boolean;
  fishing?: FishingSession | null;
}) {
  const appearance = usePlayerProfile((state) => state.profile?.appearance) ?? DEFAULT_APPEARANCE;
  const { scene, mixer, actions } = useCharacter(heroAssetId(appearance));
  const player = useMemo(() => new ClipPlayer(), []);
  const clipNames = useMemo(() => Array.from(actions.keys()), [actions]);
  const hasCastClip = !shouldUseFishingFallback(clipNames);
  useEffect(() => applyAppearance(scene, appearance), [scene, appearance]);
  const castStartedAt = useRef<number | null>(null);
  const wasFishing = useRef(false);
  const chest = scene.getObjectByName('bone_chest') as Bone | undefined;
  const upperArmRight = scene.getObjectByName('bone_upperArm_R') as Bone | undefined;
  const lowerArmRight = scene.getObjectByName('bone_lowerArm_R') as Bone | undefined;

  useFrame((state, delta) => {
    const fishingActive = fishing !== null && fishing.phase !== 'result';
    if (fishingActive && !wasFishing.current) {
      castStartedAt.current = state.clock.elapsedTime;
      const cast = hasCastClip ? actions.get('anim_Cast') : undefined;
      if (cast) player.playOnce(cast, 0.2);
    }
    if (!fishingActive && wasFishing.current) castStartedAt.current = null;
    wasFishing.current = fishingActive;

    const castProgress = castStartedAt.current === null
      ? 1
      : clamp((state.clock.elapsedTime - castStartedAt.current) / (fishing?.castWindowMs ?? 700) * 1000, 0, 1);
    const castAction = hasCastClip ? actions.get('anim_Cast') : undefined;
    const sit = seated ? (actions.get('anim_Sit') ?? actions.get('anim_Idle')) : undefined;
    const { name, timeScale } = selectClip(mode, fishingActive ? 0 : playerMotion.speed);
    const holdAction = fishing?.phase === 'reel'
      ? (actions.get('anim_Reel') ?? actions.get('anim_FishIdle') ?? actions.get('anim_Idle'))
      : (actions.get('anim_FishIdle') ?? actions.get('anim_Idle'));
    // A real cast action is launched once above with LoopOnce; do not pass it to ClipPlayer,
    // which intentionally converts locomotion actions to LoopRepeat.
    const realCastPlaying = fishingActive && fishing?.phase === 'cast' && castAction !== undefined;
    const action = fishingActive ? (realCastPlaying ? undefined : holdAction) : (sit ?? actions.get(name));
    if (action) {
      player.play(action, seated || player.wasSitting ? SIT_FADE : undefined);
      action.timeScale = sit || fishingActive ? 1 : timeScale;
    }
    mixer.update(Math.min(delta, 0.05));

    // Current hero GLBs have no anim_Cast. Layer a tested upper-body pose over Idle,
    // preserving hips/root so the movement lock remains authoritative.
    if (fishingActive && !castAction) {
      const casting = castProgress < 0.7;
      const t = casting ? smoothCast(castProgress / 0.7) : 1;
      const from = castPhases('casting');
      const to = castPhases(casting ? 'release' : 'holding');
      if (chest) chest.rotation.x = from.rodPitch * 0.08 + (to.rodPitch * 0.08 - from.rodPitch * 0.08) * t;
      if (upperArmRight) {
        upperArmRight.rotation.x = from.rodPitch + (to.rodPitch - from.rodPitch) * t;
        upperArmRight.rotation.z = from.rodRoll + (to.rodRoll - from.rodRoll) * t;
      }
      if (lowerArmRight) lowerArmRight.rotation.x = -0.65 + t * 0.35;
    }

    player.wasSitting = seated;
    scene.visible = cameraState.distance >= HERO_HIDE_DISTANCE;
    const bike = actions.get('anim_Bike');
    if (bike) animState.bikePhase = bike.time / bike.getClip().duration;
  });

  return <primitive object={scene} />;
}

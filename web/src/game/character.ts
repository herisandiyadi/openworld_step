import { useEffect, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { type AnimationAction, AnimationMixer, LoopRepeat, type Mesh, type Object3D } from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { type AssetId, assetUrl } from '../app/assets';

export function enableShadows(root: Object3D, skinned = false): Object3D {
  root.traverse((object) => {
    if ((object as Mesh).isMesh) {
      object.castShadow = true;
      // Skinned bounds come from the bind pose; animated limbs can leave them.
      if (skinned) object.frustumCulled = false;
    }
  });
  return root;
}

/** Per-instance clone of a rigged GLB plus its mixer and named clip actions. */
export function useCharacter(id: AssetId) {
  const gltf = useGLTF(assetUrl(id));
  const scene = useMemo(() => enableShadows(clone(gltf.scene), true), [gltf.scene]);
  const mixer = useMemo(() => new AnimationMixer(scene), [scene]);
  const actions = useMemo(
    () => new Map<string, AnimationAction>(gltf.animations.map((clip) => [clip.name, mixer.clipAction(clip)])),
    [gltf.animations, mixer],
  );
  // Only stop playback on unmount. uncacheRoot() here would invalidate the memoised actions when React
  // re-runs effects (StrictMode / remount) and crash the mixer; the mixer is GC'd with the component.
  useEffect(
    () => () => {
      mixer.stopAllAction();
    },
    [mixer],
  );
  return { scene, mixer, actions };
}

/** Cross-fades between looping clips. */
export class ClipPlayer {
  private current: AnimationAction | null = null;
  /** Diset Hero supaya transisi keluar dari klip duduk juga 0.4 detik. */
  wasSitting = false;

  play(action: AnimationAction, fadeSeconds = 0.2): void {
    if (action === this.current) return;
    action.reset().setLoop(LoopRepeat, Infinity).fadeIn(fadeSeconds).play();
    this.current?.fadeOut(fadeSeconds);
    this.current = action;
  }
}
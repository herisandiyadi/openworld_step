import { useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera } from 'three';
import { cameraState, solveCamera, stepFollow, type CameraPose } from './followCamera';
import { useCameraGestures } from './useCameraGestures';
import { playerMotion, playerState } from '../game/runtime';
import { useGameStore } from '../state/gameStore';
import { groundHeightAt, worldState } from '../world/worldState';

const MAX_DT = 0.05;
/** Peredam posisi kamera (1/s); rotasi mengikuti karena kamera selalu membidik target. */
const MOVE_SMOOTHING = 14;

/** Kamera third-person: pose dihitung di followCamera.ts, komponen ini hanya menerapkannya. */
export function CameraRig() {
  const mode = useGameStore((state) => state.mode);
  const camera = useThree((state) => state.camera);
  const pose = useMemo<CameraPose>(() => ({ x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, fov: 55 }), []);
  useCameraGestures();

  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, MAX_DT);
    stepFollow(cameraState, mode, playerState.heading, playerMotion.speed, dt);
    solveCamera(
      cameraState,
      {
        mode,
        x: playerState.x,
        y: groundHeightAt(playerState.x, playerState.z),
        z: playerState.z,
        heading: playerState.heading,
        speed: playerMotion.speed,
        boxes: worldState.collision.boxes,
      },
      dt,
      pose,
    );

    const alpha = 1 - Math.exp(-MOVE_SMOOTHING * dt);
    camera.position.x += (pose.x - camera.position.x) * alpha;
    camera.position.y += (pose.y - camera.position.y) * alpha;
    camera.position.z += (pose.z - camera.position.z) * alpha;
    camera.lookAt(pose.tx, pose.ty, pose.tz);
    if (camera instanceof PerspectiveCamera && Math.abs(camera.fov - pose.fov) > 0.01) {
      camera.fov = pose.fov;
      camera.updateProjectionMatrix();
    }
  });

  return null;
}

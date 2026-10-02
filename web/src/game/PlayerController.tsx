import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { DirectionalLight, Group, MathUtils, Mesh, Object3D, Vector3 } from 'three';
import { stepPlayer } from './movement';
import { Hero } from './Hero';
import { audio } from '../audio/audioEngine';
import { PlayerVehicle } from './PlayerVehicle';
import { MODE_RADIUS, MODE_SPEED, joystickInput, jumpState, keyboardInput, lighting, playerMotion, playerState } from './runtime';
import { useGameStore } from '../state/gameStore';
import { groundHeightAt, worldState } from '../world/worldState';

const CAMERA_PITCH = MathUtils.degToRad(55);
const CAMERA_DISTANCE = 30;
const CAMERA_OFFSET = new Vector3(0, Math.sin(CAMERA_PITCH), Math.cos(CAMERA_PITCH)).multiplyScalar(CAMERA_DISTANCE);
const CAMERA_SMOOTHING = 8;
const TURN_SMOOTHING = 14;
const LIGHT_OFFSET = new Vector3(18, 30, 12);
const MAX_DT = 0.05;
const SPEED_SMOOTHING = 12;
const GRAVITY = 20;
const SUN_INTENSITY = 2.2;

function lerpAngle(from: number, to: number, alpha: number): number {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * alpha;
}

/** Animated GLB hero (+ skateboard/bicycle), MOBA follow camera, and the player-centred shadow light. */
export function PlayerController({ shadows }: { shadows: boolean }) {
  const mode = useGameStore((state) => state.mode);
  const camera = useThree((state) => state.camera);
  const playerRef = useRef<Group>(null);
  const bodyRef = useRef<Group>(null);
  const markerRef = useRef<Mesh>(null);
  const lightRef = useRef<DirectionalLight>(null);
  const lightTarget = useMemo(() => new Object3D(), []);
  const cameraGoal = useMemo(() => new Vector3(), []);
  const input = useMemo(() => ({ x: 0, z: 0 }), []);

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, MAX_DT);
    input.x = joystickInput.x + keyboardInput.x;
    input.z = joystickInput.z + keyboardInput.z;
    const startX = playerState.x;
    const startZ = playerState.z;
    stepPlayer(playerState, input, MODE_SPEED[mode], MODE_RADIUS[mode], dt, worldState.collision);
    const speed = dt > 0 ? Math.hypot(playerState.x - startX, playerState.z - startZ) / dt : 0;
    playerMotion.speed += (speed - playerMotion.speed) * (1 - Math.exp(-SPEED_SMOOTHING * dt));

    if (jumpState.vy !== 0 || jumpState.y > 0) {
      jumpState.vy -= GRAVITY * dt;
      jumpState.y += jumpState.vy * dt;
      if (jumpState.y <= 0) {
        jumpState.y = 0;
        jumpState.vy = 0;
        audio.land();
      }
    }

    const player = playerRef.current;
    const groundY = groundHeightAt(playerState.x, playerState.z);
    if (player) {
      player.position.set(playerState.x, groundY + jumpState.y, playerState.z);
      const body = bodyRef.current;
      if (body) body.rotation.y = lerpAngle(body.rotation.y, playerState.heading, 1 - Math.exp(-TURN_SMOOTHING * dt));
    }

    const marker = markerRef.current;
    if (marker) {
      marker.visible = playerState.target !== null;
      if (playerState.target) {
        const goal = playerState.path[playerState.path.length - 1] ?? playerState.target;
        marker.position.set(goal.x, groundHeightAt(goal.x, goal.z) + 0.05, goal.z);
        marker.scale.setScalar(1 + Math.sin(state.clock.elapsedTime * 6) * 0.12);
      }
    }

    cameraGoal.set(playerState.x, groundY, playerState.z).add(CAMERA_OFFSET);
    camera.position.lerp(cameraGoal, 1 - Math.exp(-CAMERA_SMOOTHING * dt));
    camera.lookAt(camera.position.x - CAMERA_OFFSET.x, camera.position.y - CAMERA_OFFSET.y, camera.position.z - CAMERA_OFFSET.z);

    const light = lightRef.current;
    if (light) {
      light.intensity = SUN_INTENSITY * lighting.sun;
      light.position.set(playerState.x + LIGHT_OFFSET.x, groundY + LIGHT_OFFSET.y, playerState.z + LIGHT_OFFSET.z);
      lightTarget.position.set(playerState.x, groundY, playerState.z);
      lightTarget.updateMatrixWorld();
    }
  });

  return (
    <>
      <primitive object={lightTarget} />
      <directionalLight
        ref={lightRef}
        target={lightTarget}
        intensity={SUN_INTENSITY}
        castShadow={shadows}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-28}
        shadow-camera-right={28}
        shadow-camera-top={28}
        shadow-camera-bottom={-28}
        shadow-camera-near={1}
        shadow-camera-far={90}
        shadow-bias={-0.0005}
      />

      <group ref={playerRef}>
        <group ref={bodyRef}>
          {mode !== 'car' && <Hero mode={mode} />}
          <PlayerVehicle />
        </group>
      </group>

      <mesh ref={markerRef} rotation-x={-Math.PI / 2} visible={false}>
        <ringGeometry args={[0.45, 0.65, 24]} />
        <meshBasicMaterial color="#ffd23f" />
      </mesh>
    </>
  );
}
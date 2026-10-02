import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { DirectionalLight, Group, Mesh, Object3D, Vector3 } from 'three';
import { clampToBounds, hasInput, pushOutOfBoxes, stepPlayer } from './movement';
import { standUp } from './actions';
import { playerSeat, SIT_TRANSITION } from './seating';
import { Hero } from './Hero';
import { audio } from '../audio/audioEngine';
import { PlayerVehicle } from './PlayerVehicle';
import { MODE_RADIUS, MODE_SPEED, joystickInput, jumpState, keyboardInput, lighting, playerMotion, playerState } from './runtime';
import { DRIVE, stepDrive } from './vehicleSpec';
import { cameraState, rotateCameraInput } from '../camera/followCamera';
import { CameraRig } from '../camera/CameraRig';
import { useGameStore } from '../state/gameStore';
import { groundHeightAt, worldState } from '../world/worldState';

const TURN_SMOOTHING = 14;
const LIGHT_OFFSET = new Vector3(18, 30, 12);
/** Bayangan dipusatkan sejauh ini di depan arah pandang kamera, dengan frustum ±20 m. */
const SHADOW_LEAD = 12;
const MAX_DT = 0.05;
const SPEED_SMOOTHING = 12;
const GRAVITY = 20;
const SUN_INTENSITY = 2.2;
/** Kecepatan kendaraan sepanjang arah hadap (m/s), lihat stepDrive. */
const driveState = { speed: 0 };

function lerpAngle(from: number, to: number, alpha: number): number {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * alpha;
}

/** Animated GLB hero (+ skateboard/bicycle) and the shadow light. The camera lives in camera/CameraRig.tsx. */
export function PlayerController({ shadows }: { shadows: boolean }) {
  const mode = useGameStore((state) => state.mode);
  const seated = useGameStore((state) => state.seated);
  const playerRef = useRef<Group>(null);
  const bodyRef = useRef<Group>(null);
  const markerRef = useRef<Mesh>(null);
  const lightRef = useRef<DirectionalLight>(null);
  const lightTarget = useMemo(() => new Object3D(), []);

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, MAX_DT);
    const raw = { x: joystickInput.x + keyboardInput.x, z: joystickInput.z + keyboardInput.z };
    const startX = playerState.x;
    const startZ = playerState.z;

    const seat = playerSeat.seat;
    if (seat) {
      // Duduk: joystick/WASD membuat berdiri; selain itu meluncur ke titik duduk dalam ~0.4 detik.
      // Collider bangku tidak dipakai di sini, jadi pemain tidak didorong keluar dari kursinya.
      if (hasInput(raw)) {
        standUp();
      } else {
        const alpha = 1 - Math.exp((-4 / SIT_TRANSITION) * dt);
        playerState.x += (seat.x - playerState.x) * alpha;
        playerState.z += (seat.z - playerState.z) * alpha;
        playerState.heading = seat.yaw;
      }
    } else if (mode === 'walk') {
      driveState.speed = 0;
      // Joystick dan WASD relatif kamera: atas = arah pandang kamera.
      stepPlayer(playerState, rotateCameraInput(raw, cameraState.yaw), MODE_SPEED.walk, MODE_RADIUS.walk, dt, worldState.collision);
    } else {
      // Kendaraan: atas/bawah = gas/rem, kiri/kanan = belok (relatif kendaraan, seperti GTA).
      playerState.heading = stepDrive(driveState, playerState.heading, raw, DRIVE[mode], dt);
      if (driveState.speed !== 0) {
        playerState.target = null;
        playerState.path.length = 0;
        const step = driveState.speed * dt;
        playerState.x -= Math.sin(playerState.heading) * step;
        playerState.z -= Math.cos(playerState.heading) * step;
        pushOutOfBoxes(playerState, MODE_RADIUS[mode], worldState.collision.boxes);
        clampToBounds(playerState, MODE_RADIUS[mode], worldState.collision.bounds);
        // Menabrak gedung menghentikan kendaraan, bukan meluncur terus menempel dinding.
        const travelled = Math.hypot(playerState.x - startX, playerState.z - startZ);
        if (travelled < Math.abs(step) * 0.4) driveState.speed = 0;
      }
    }

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

    const light = lightRef.current;
    if (light) {
      light.intensity = SUN_INTENSITY * lighting.sun;
      const focusX = playerState.x - Math.sin(cameraState.yaw) * SHADOW_LEAD;
      const focusZ = playerState.z - Math.cos(cameraState.yaw) * SHADOW_LEAD;
      light.position.set(focusX + LIGHT_OFFSET.x, groundY + LIGHT_OFFSET.y, focusZ + LIGHT_OFFSET.z);
      lightTarget.position.set(focusX, groundY, focusZ);
      lightTarget.updateMatrixWorld();
    }
  });

  return (
    <>
      <CameraRig />
      <primitive object={lightTarget} />
      <directionalLight
        ref={lightRef}
        target={lightTarget}
        intensity={SUN_INTENSITY}
        castShadow={shadows}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
        shadow-camera-near={1}
        shadow-camera-far={90}
        shadow-bias={-0.0005}
      />

      <group ref={playerRef}>
        <group ref={bodyRef}>
          {mode !== 'car' && <Hero mode={mode} seated={seated} />}
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

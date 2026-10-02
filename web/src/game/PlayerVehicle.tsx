import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import type { Object3D } from 'three';
import { assetUrl } from '../app/assets';
import { enableShadows } from './character';
import { animState, playerMotion } from './runtime';
import { CarModel, MotoModel } from './vehicleModels';
import { BIKE } from './vehicleSpec';
import { useGameStore } from '../state/gameStore';

function Skateboard() {
  const gltf = useGLTF(assetUrl('veh_skateboard'));
  const scene = useMemo(() => enableShadows(gltf.scene.clone()), [gltf.scene]);
  return <primitive object={scene} />;
}

/** Wheels roll with ground speed; the crank follows the hero's pedalling clip phase. */
function Bicycle() {
  const gltf = useGLTF(assetUrl('veh_bicycle'));
  const { scene, wheels, crank } = useMemo(() => {
    const root = enableShadows(gltf.scene.clone());
    return {
      scene: root,
      wheels: ['wheel_front', 'wheel_rear'].map((name) => root.getObjectByName(name)).filter((node): node is Object3D => !!node),
      crank: root.getObjectByName('crank') ?? null,
    };
  }, [gltf.scene]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    for (const wheel of wheels) wheel.rotation.x -= (playerMotion.speed * dt) / BIKE.wheelRadius;
    if (crank) crank.rotation.x = -Math.PI * 2 * animState.bikePhase;
  });

  return <primitive object={scene} />;
}

/** The vehicle the player is currently riding (none when walking). */
export function PlayerVehicle() {
  const riding = useGameStore((state) => state.riding);
  if (!riding) return null;
  if (riding.kind === 'bike') return <Bicycle />;
  if (riding.kind === 'skate') return <Skateboard />;
  if (riding.kind === 'moto') return <MotoModel color={riding.color} />;
  return <CarModel color={riding.color} />;
}
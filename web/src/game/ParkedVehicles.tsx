import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import { playerState } from './runtime';
import { VehicleModel } from './vehicleModels';
import type { ParkedVehicle } from './vehicles';
import { useGameStore } from '../state/gameStore';
import { chunkAt, groundHeightAt } from '../world/worldState';

const VIEW_DISTANCE = 90;
const RING_RADIUS: Record<ParkedVehicle['kind'], number> = { skate: 0.7, bike: 1, moto: 1.2, car: 2.4 };

function Parked({ vehicle }: { vehicle: ParkedVehicle }) {
  const groupRef = useRef<Group>(null);
  const ringRef = useRef<Group>(null);
  const highlighted = useGameStore((state) => state.nearby.vehicleId === vehicle.id);

  useFrame((state) => {
    const group = groupRef.current;
    if (!group) return;
    // Only drawn when its chunk is streamed in (ground height known) and reasonably close.
    const visible =
      chunkAt(vehicle.x, vehicle.z) !== undefined &&
      Math.hypot(vehicle.x - playerState.x, vehicle.z - playerState.z) < VIEW_DISTANCE;
    group.visible = visible;
    if (visible) group.position.y = groundHeightAt(vehicle.x, vehicle.z);
    const ring = ringRef.current;
    if (ring) ring.scale.setScalar(1 + Math.sin(state.clock.elapsedTime * 5) * 0.06);
  });

  return (
    <group ref={groupRef} position={[vehicle.x, 0, vehicle.z]} rotation-y={vehicle.yaw} visible={false}>
      <VehicleModel kind={vehicle.kind} color={vehicle.color} />
      {highlighted && (
        <group ref={ringRef} position-y={0.04}>
          <mesh rotation-x={-Math.PI / 2}>
            <ringGeometry args={[RING_RADIUS[vehicle.kind], RING_RADIUS[vehicle.kind] + 0.14, 32]} />
            <meshBasicMaterial color="#ffd23f" transparent opacity={0.85} />
          </mesh>
        </group>
      )}
    </group>
  );
}

/** Vehicles parked in the city; the one in range of the Naik button gets a pulsing ring. */
export function ParkedVehicles() {
  const vehicles = useGameStore((state) => state.vehicles);
  return vehicles.map((vehicle) => <Parked key={vehicle.id} vehicle={vehicle} />);
}
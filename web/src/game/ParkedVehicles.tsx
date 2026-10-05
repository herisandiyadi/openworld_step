import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type { Group } from 'three';
import { playerState } from './runtime';
import { VehicleModel } from './vehicleModels';
import type { ParkedVehicle } from './vehicles';
import { useGameStore } from '../state/gameStore';
import { chunkAt, groundHeightAt } from '../world/worldState';
import { useNetStore } from '../net/netStore';
import type { VehicleInfo } from '../net/session';
import {
  CLAIMED_TINT,
  NO_OWNER,
  claimedLabel,
  isClaimedByOther,
  onSharedVehicleUpdate,
  shouldEject,
  useSharedVehicles,
  vehicleOwner,
} from './sharedVehicles';

const VIEW_DISTANCE = 90;
const RING_RADIUS: Record<ParkedVehicle['kind'], number> = { skate: 0.7, bike: 1, moto: 1.2, car: 2.4 };

/**
 * Menyelaraskan gameStore dengan vehicleState dari host:
 * - kendaraan yang dilepas pemain lain dipindah ke posisi parkir barunya (Proximity/actions memakai gameStore);
 * - kalau host memberikan kendaraan yang sedang dinaiki pemain lokal ke orang lain, pemain lokal diturunkan.
 * Di single-player applyVehicleUpdate tidak pernah dipanggil, jadi tidak ada efek.
 */
function syncFromHost(info: VehicleInfo): void {
  const state = useGameStore.getState();
  const localId = useNetStore.getState().playerId;
  if (shouldEject(info, localId, state.riding?.id ?? null) && state.riding) {
    state.dismount({ ...state.riding, x: playerState.x, z: playerState.z, yaw: playerState.heading });
  }
  if (info.ownerId !== NO_OWNER) return;
  const index = state.vehicles.findIndex((item) => item.id === info.vehicleId);
  const current = index >= 0 ? state.vehicles[index] : undefined;
  if (!current || (current.x === info.x && current.z === info.z && current.yaw === info.yaw)) return;
  const vehicles = state.vehicles.slice();
  vehicles[index] = { ...current, x: info.x, z: info.z, yaw: info.yaw };
  useGameStore.setState({ vehicles });
}

function Parked({ vehicle }: { vehicle: ParkedVehicle }) {
  const groupRef = useRef<Group>(null);
  const ringRef = useRef<Group>(null);
  const highlighted = useGameStore((state) => state.nearby.vehicleId === vehicle.id);
  // Kepemilikan dari host jarang berubah, jadi aman sebagai subscription React.
  const ownerId = useSharedVehicles((state) => vehicleOwner(state.owners, vehicle.id));
  const pose = useSharedVehicles((state) => (ownerId !== NO_OWNER ? state.poses[vehicle.id] : undefined));
  const localId = useNetStore((state) => state.playerId);
  const ownerName = useNetStore((state) => (ownerId !== NO_OWNER ? state.remotes[ownerId]?.username : undefined));
  const claimed = isClaimedByOther(ownerId, localId);
  // Kendaraan milik pemain lain digambar di posisi/yaw terakhir yang dilaporkan host.
  const x = claimed && pose ? pose.x : vehicle.x;
  const z = claimed && pose ? pose.z : vehicle.z;
  const yaw = claimed && pose ? pose.yaw : vehicle.yaw;

  useFrame((state) => {
    const group = groupRef.current;
    if (!group) return;
    // Only drawn when its chunk is streamed in (ground height known) and reasonably close.
    const visible = chunkAt(x, z) !== undefined && Math.hypot(x - playerState.x, z - playerState.z) < VIEW_DISTANCE;
    group.visible = visible;
    if (visible) group.position.y = groundHeightAt(x, z);
    const ring = ringRef.current;
    if (ring) ring.scale.setScalar(1 + Math.sin(state.clock.elapsedTime * 5) * 0.06);
  });

  return (
    <group ref={groupRef} position={[x, 0, z]} rotation-y={yaw} visible={false}>
      <VehicleModel kind={vehicle.kind} color={vehicle.color} />
      {/* Cincin merah + label: jelas bahwa kendaraan sedang dipakai pemain lain, bukan tombol yang rusak. */}
      {claimed && (
        <>
          <group position-y={0.04}>
            <mesh rotation-x={-Math.PI / 2}>
              <ringGeometry args={[RING_RADIUS[vehicle.kind], RING_RADIUS[vehicle.kind] + 0.14, 32]} />
              <meshBasicMaterial color={CLAIMED_TINT} transparent opacity={0.85} />
            </mesh>
          </group>
          <Html position={[0, 1.6, 0]} center zIndexRange={[10, 0]} pointerEvents="none">
            <div className="npc-label">{claimedLabel(ownerName)}</div>
          </Html>
        </>
      )}
      {highlighted && !claimed && (
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
  useEffect(() => onSharedVehicleUpdate(syncFromHost), []);
  return vehicles.map((vehicle) => <Parked key={vehicle.id} vehicle={vehicle} />);
}

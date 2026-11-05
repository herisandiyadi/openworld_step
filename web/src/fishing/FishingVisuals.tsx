import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferGeometry, Float32BufferAttribute, Group, Line, LineBasicMaterial } from 'three';
import { FISHING_CAST_MS } from './fishingPose';
import { bobberDynamics, castTrajectory, fishingTarget } from './fishingVisuals';
import type { FishingSession } from './FishingController';
import { findStreamedFishingSpot } from '../world/worldState';

const WATER_Y = 0;

interface MutablePoint {
  x: number;
  y: number;
  z: number;
}

/**
 * Rod-line geometry owned by a Line object. Kept separate from the component so the
 * GPU resource lifecycle (allocate once, dispose on unmount) is unit-testable; without
 * disposal each remount leaks geometry + material until WebGL context loss.
 */
export function createFishingLine(): Line {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(6), 3));
  return new Line(geometry, new LineBasicMaterial({ color: '#dbeafe', transparent: true, opacity: 0.9 }));
}

export function disposeFishingLine(line: Line): void {
  line.geometry.dispose();
  if (Array.isArray(line.material)) {
    for (const material of line.material) material.dispose();
  } else {
    line.material.dispose();
  }
}

function FishingLine({ tip, bobber }: { tip: React.RefObject<MutablePoint>; bobber: React.RefObject<MutablePoint> }) {
  const line = useMemo(() => createFishingLine(), []);
  useEffect(() => () => disposeFishingLine(line), [line]);
  useFrame(() => {
    const attribute = line.geometry.getAttribute('position') as Float32BufferAttribute;
    attribute.setXYZ(0, tip.current.x, tip.current.y, tip.current.z);
    attribute.setXYZ(1, bobber.current.x, bobber.current.y, bobber.current.z);
    attribute.needsUpdate = true;
  });
  return <primitive object={line} />;
}

/**
 * World-space rod, line, bobber and cheap spot-water patch. It is mounted by
 * PlayerController only while a non-terminal fishing session exists, so all objects
 * disappear immediately on result/cancel/release.
 */
export function FishingVisuals({
  session,
  player,
}: {
  session: FishingSession;
  player: { x: number; z: number; heading: number };
}) {
  const rod = useRef<Group>(null);
  const bobberGroup = useRef<Group>(null);
  const tip = useRef<MutablePoint>({ x: player.x, y: 2, z: player.z });
  const bobber = useRef<MutablePoint>({ x: player.x, y: 1.2, z: player.z });
  const spot = findStreamedFishingSpot(session.spotId) ?? session.spot;
  const target = fishingTarget(player, spot, WATER_Y);
  const tension = session.minigame?.tension ?? 0;

  useFrame((state) => {
    const nowMs = Date.now();
    const progress = session.phase === 'cast'
      ? Math.min(1, Math.max(0, (nowMs - session.phaseEnteredAt) / FISHING_CAST_MS))
      : 1;
    const handX = player.x - Math.sin(player.heading) * 0.08 + Math.cos(player.heading) * 0.28;
    const handZ = player.z - Math.cos(player.heading) * 0.08 - Math.sin(player.heading) * 0.28;
    const forwardX = -Math.sin(player.heading);
    const forwardZ = -Math.cos(player.heading);

    if (rod.current) {
      rod.current.position.set(handX, 1.15, handZ);
      rod.current.rotation.set(0.35 - tension * 0.18, player.heading, -0.22);
    }
    tip.current.x = handX + forwardX * 1.45;
    tip.current.y = 2.12 - tension * 0.3;
    tip.current.z = handZ + forwardZ * 1.45;

    const castPoint = castTrajectory({ x: handX, y: 1.35, z: handZ }, target, progress);
    bobber.current.x = castPoint.x;
    bobber.current.z = castPoint.z;
    bobber.current.y = progress < 1
      ? castPoint.y
      : bobberDynamics(WATER_Y, session.phase === 'bite', state.clock.elapsedTime, tension);
    bobberGroup.current?.position.set(bobber.current.x, bobber.current.y, bobber.current.z);
  });

  return (
    <group>
      <mesh position={[target.x, WATER_Y - 0.025, target.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[5, 5]} />
        <meshBasicMaterial color="#277da1" transparent opacity={0.68} depthWrite={false} />
      </mesh>
      <group ref={rod}>
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.72]} castShadow>
          <cylinderGeometry args={[0.016, 0.032, 1.7, 6]} />
          <meshBasicMaterial color={session.carbonRod ? '#1f2937' : '#a16207'} />
        </mesh>
      </group>
      <FishingLine tip={tip} bobber={bobber} />
      <group ref={bobberGroup}>
        <mesh>
          <sphereGeometry args={[0.075, 8, 6]} />
          <meshBasicMaterial color="#f5f5f5" />
        </mesh>
        <mesh position={[0, 0.065, 0]}>
          <cylinderGeometry args={[0.018, 0.018, 0.14, 6]} />
          <meshBasicMaterial color="#ef4444" />
        </mesh>
      </group>
    </group>
  );
}

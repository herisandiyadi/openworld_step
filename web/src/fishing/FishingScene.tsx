import { useMemo } from 'react';
import { BufferGeometry, Float32BufferAttribute, Line, LineBasicMaterial } from 'three';

export interface FishingScenePoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Single-plane water: 2 triangles, 1 draw call. */
export function WaterSurface({
  position = [0, 0, 0],
  size = [24, 24],
  color = '#277da1',
  opacity = 0.86,
}: {
  position?: [number, number, number];
  size?: [number, number];
  color?: string;
  opacity?: number;
}) {
  return (
    <mesh position={position} rotation={[-Math.PI / 2, 0, 0]} receiveShadow={false}>
      <planeGeometry args={size} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
}

/** Bobber: two tiny primitive meshes, no asset or GLTF load. */
export function Bobber({
  position,
  biting = false,
}: {
  position: FishingScenePoint;
  biting?: boolean;
}) {
  const y = biting ? position.y - 0.08 : position.y;
  return (
    <group position={[position.x, y, position.z]}>
      <mesh>
        <sphereGeometry args={[0.075, 8, 6]} />
        <meshBasicMaterial color="#f5f5f5" />
      </mesh>
      <mesh position={[0, 0.065, 0]}>
        <cylinderGeometry args={[0.018, 0.018, 0.14, 6]} />
        <meshBasicMaterial color="#ef4444" />
      </mesh>
    </group>
  );
}

/**
 * Cheap rod and line, built from one tapered cylinder plus one line segment.
 * `tension` bends the visual by lowering the rod tip; simulation remains pure.
 */
export function Rod({
  position,
  bobber,
  yaw = 0,
  tension = 0,
  carbon = false,
}: {
  position: FishingScenePoint;
  bobber: FishingScenePoint;
  yaw?: number;
  tension?: number;
  carbon?: boolean;
}) {
  const rodLength = 1.8;
  const tipY = position.y + rodLength - Math.min(1, Math.max(0, tension)) * 0.35;
  const tipX = position.x + Math.sin(yaw) * 0.25;
  const tipZ = position.z + Math.cos(yaw) * 0.25;

  const line = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([
      tipX, tipY, tipZ,
      bobber.x, bobber.y, bobber.z,
    ], 3));
    return geometry;
  }, [tipX, tipY, tipZ, bobber.x, bobber.y, bobber.z]);

  const lineMaterial = useMemo(() => new LineBasicMaterial({ color: '#dbeafe', transparent: true, opacity: 0.8 }), []);

  const lineObject = useMemo(() => new Line(line, lineMaterial), [line, lineMaterial]);

  return (
    <group>
      <mesh
        position={[position.x, position.y + rodLength / 2, position.z]}
        rotation={[0, yaw, -0.08 - tension * 0.12]}
      >
        <cylinderGeometry args={[0.018, 0.035, rodLength, 6]} />
        <meshBasicMaterial color={carbon ? '#1f2937' : '#a16207'} />
      </mesh>
      <primitive object={lineObject} />
    </group>
  );
}

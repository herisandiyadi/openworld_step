import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { BoxGeometry, CylinderGeometry, MeshStandardMaterial } from 'three';
import { assetUrl } from '../app/assets';
import { enableShadows } from './character';
import type { VehicleKind } from './vehicles';

/** Procedural (Mode B) car and motorbike; shared geometry/materials keep many parked vehicles cheap. */
const box = (w: number, h: number, d: number) => new BoxGeometry(w, h, d);
const wheel = (radius: number, width: number) => new CylinderGeometry(radius, radius, width, 14).rotateZ(Math.PI / 2);

const GEO = {
  carBody: box(1.8, 0.6, 4),
  carCabin: box(1.6, 0.55, 2),
  carLight: box(0.35, 0.14, 0.04),
  carWheel: wheel(0.34, 0.24),
  motoFrame: box(0.2, 0.3, 1.1),
  motoTank: box(0.34, 0.22, 0.5),
  motoSeat: box(0.3, 0.1, 0.6),
  motoBar: box(0.62, 0.05, 0.05),
  motoFork: box(0.06, 0.6, 0.06),
  motoLight: box(0.16, 0.12, 0.06),
  motoWheel: wheel(0.32, 0.12),
};

const MAT = {
  tire: new MeshStandardMaterial({ color: '#1d1f22', roughness: 0.9 }),
  glass: new MeshStandardMaterial({ color: '#2b3a4a', roughness: 0.2, metalness: 0.3 }),
  metal: new MeshStandardMaterial({ color: '#b9bec4', roughness: 0.4, metalness: 0.6 }),
  seat: new MeshStandardMaterial({ color: '#2a2a2a', roughness: 0.8 }),
  light: new MeshStandardMaterial({ color: '#fff4c2', emissive: '#fff1a8', emissiveIntensity: 0.6 }),
};

const paintCache = new Map<string, MeshStandardMaterial>();
function paint(color: string): MeshStandardMaterial {
  let material = paintCache.get(color);
  if (!material) {
    material = new MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.2 });
    paintCache.set(color, material);
  }
  return material;
}

const CAR_WHEELS: [number, number][] = [
  [-0.85, -1.3],
  [0.85, -1.3],
  [-0.85, 1.3],
  [0.85, 1.3],
];

export function CarModel({ color }: { color: string }) {
  const body = paint(color);
  return (
    <group>
      <mesh geometry={GEO.carBody} material={body} position={[0, 0.65, 0]} castShadow />
      <mesh geometry={GEO.carCabin} material={MAT.glass} position={[0, 1.22, 0.2]} castShadow />
      <mesh geometry={GEO.carLight} material={MAT.light} position={[-0.6, 0.72, -2.01]} />
      <mesh geometry={GEO.carLight} material={MAT.light} position={[0.6, 0.72, -2.01]} />
      {CAR_WHEELS.map(([x, z]) => (
        <mesh key={`${x}_${z}`} geometry={GEO.carWheel} material={MAT.tire} position={[x, 0.34, z]} castShadow />
      ))}
    </group>
  );
}

/** Seat/grips line up with the bicycle (vehicleSpec BIKE) so the hero's riding pose fits. */
export function MotoModel({ color }: { color: string }) {
  const body = paint(color);
  return (
    <group>
      <mesh geometry={GEO.motoFrame} material={MAT.metal} position={[0, 0.55, 0]} castShadow />
      <mesh geometry={GEO.motoTank} material={body} position={[0, 0.82, -0.2]} castShadow />
      <mesh geometry={GEO.motoSeat} material={MAT.seat} position={[0, 0.86, 0.25]} castShadow />
      <mesh geometry={GEO.motoFork} material={MAT.metal} position={[0, 0.68, -0.5]} rotation-x={-0.35} />
      <mesh geometry={GEO.motoBar} material={MAT.metal} position={[0, 1.02, -0.32]} />
      <mesh geometry={GEO.motoLight} material={MAT.light} position={[0, 0.9, -0.62]} />
      <mesh geometry={GEO.motoWheel} material={MAT.tire} position={[0, 0.32, -0.65]} castShadow />
      <mesh geometry={GEO.motoWheel} material={MAT.tire} position={[0, 0.32, 0.65]} castShadow />
    </group>
  );
}

function GlbModel({ id }: { id: 'veh_bicycle' | 'veh_skateboard' }) {
  const gltf = useGLTF(assetUrl(id));
  const scene = useMemo(() => enableShadows(gltf.scene.clone()), [gltf.scene]);
  return <primitive object={scene} />;
}

/** Static model of a parked vehicle. */
export function VehicleModel({ kind, color }: { kind: VehicleKind; color: string }) {
  if (kind === 'car') return <CarModel color={color} />;
  if (kind === 'moto') return <MotoModel color={color} />;
  return <GlbModel id={kind === 'bike' ? 'veh_bicycle' : 'veh_skateboard'} />;
}
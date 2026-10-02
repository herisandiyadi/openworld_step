import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { type AssetId, assetUrl } from '../app/assets';
import { enableShadows } from './character';
import type { VehicleKind } from './vehicles';

/** GLB per jenis kendaraan (B5). Mobil dan motor pemain sekarang juga GLB, bukan model prosedural. */
const VEHICLE_GLB: Record<VehicleKind, AssetId> = {
  car: 'veh_car_sedan',
  moto: 'veh_moto',
  bike: 'veh_bicycle',
  skate: 'veh_skateboard',
};

/**
 * ponytail: warna cat ikut palet aset, `color` diabaikan. Kalau warna per kendaraan perlu kembali,
 * clone material `mat_palette` per warna lalu set `color`-nya.
 */
function GlbModel({ id }: { id: AssetId }) {
  const gltf = useGLTF(assetUrl(id));
  const scene = useMemo(() => enableShadows(gltf.scene.clone()), [gltf.scene]);
  return <primitive object={scene} />;
}

export function CarModel(_props: { color?: string }) {
  return <GlbModel id={VEHICLE_GLB.car} />;
}

/** Dudukan veh_moto setinggi model prosedural lama, jadi pose naik motor si hero tetap pas. */
export function MotoModel(_props: { color?: string }) {
  return <GlbModel id={VEHICLE_GLB.moto} />;
}

/** Static model of a parked vehicle. */
export function VehicleModel({ kind }: { kind: VehicleKind; color?: string }) {
  return <GlbModel id={VEHICLE_GLB[kind]} />;
}

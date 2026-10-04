/**
 * Kendaraan terparkir awal. Disalin dari web/src/game/vehicles.ts supaya id kendaraan di server
 * sama persis dengan klien (klaim naik/turun memakai id ini di wire).
 */

export type VehicleKind = 'skate' | 'bike' | 'moto' | 'car';

export interface ParkedVehicle {
  id: string;
  kind: VehicleKind;
  x: number;
  z: number;
  yaw: number;
}

const KIND_CYCLE: VehicleKind[] = ['car', 'moto', 'bike', 'skate'];
const INTERSECTIONS = [-192, -96, 96, 192];
const pick = <T>(list: readonly T[], index: number): T => list[index % list.length] as T;

function initialVehicles(): ParkedVehicle[] {
  const list: ParkedVehicle[] = [
    { id: 'v_spawn_bike', kind: 'bike', x: 5.2, z: -4, yaw: 0 },
    { id: 'v_spawn_skate', kind: 'skate', x: -5.2, z: 4, yaw: Math.PI / 2 },
    { id: 'v_spawn_moto', kind: 'moto', x: -2, z: -14, yaw: 0 },
    { id: 'v_spawn_car', kind: 'car', x: 2, z: 16, yaw: 0 },
  ];
  // Jalan ada di kelipatan 32 m, jadi titik ini berada di pinggir jalan dekat persimpangan.
  let index = 0;
  for (const gx of INTERSECTIONS) {
    for (const gz of INTERSECTIONS) {
      list.push({ id: `v_${gx}_${gz}`, kind: pick(KIND_CYCLE, index), x: gx + 2, z: gz + 12, yaw: 0 });
      index++;
    }
  }
  return list;
}

export const INITIAL_VEHICLES: readonly ParkedVehicle[] = initialVehicles();

/** Rideable vehicles parked around the city. The player can only use one when standing next to it. */
export type VehicleKind = 'skate' | 'bike' | 'moto' | 'car';

export interface ParkedVehicle {
  id: string;
  kind: VehicleKind;
  x: number;
  z: number;
  /** Same convention as the player heading: the model faces local -Z. */
  yaw: number;
  color: string;
}

export const VEHICLE_LABELS: Record<VehicleKind, string> = {
  skate: 'Skateboard',
  bike: 'Sepeda',
  moto: 'Motor',
  car: 'Mobil',
};

const BODY_COLORS = ['#d94f3d', '#2f7fd1', '#f2c14e', '#3fa66b', '#e8e8e8', '#7a4fc9'];
const KIND_CYCLE: VehicleKind[] = ['car', 'moto', 'bike', 'skate'];
const INTERSECTIONS = [-192, -96, 96, 192];
const pick = <T>(list: readonly T[], index: number): T => list[index % list.length] as T;

function initialVehicles(): ParkedVehicle[] {
  const list: ParkedVehicle[] = [
    { id: 'v_spawn_bike', kind: 'bike', x: 5.2, z: -4, yaw: 0, color: pick(BODY_COLORS, 0) },
    { id: 'v_spawn_skate', kind: 'skate', x: -5.2, z: 4, yaw: Math.PI / 2, color: pick(BODY_COLORS, 1) },
    { id: 'v_spawn_moto', kind: 'moto', x: -2, z: -14, yaw: 0, color: pick(BODY_COLORS, 2) },
    { id: 'v_spawn_car', kind: 'car', x: 2, z: 16, yaw: 0, color: pick(BODY_COLORS, 3) },
  ];
  // Roads run along x/z = multiples of 32 m, so these spots sit on a street next to a junction.
  let index = 0;
  for (const gx of INTERSECTIONS) {
    for (const gz of INTERSECTIONS) {
      const kind = pick(KIND_CYCLE, index);
      list.push({ id: `v_${gx}_${gz}`, kind, x: gx + 2, z: gz + 12, yaw: 0, color: pick(BODY_COLORS, index) });
      index++;
    }
  }
  return list;
}

export const INITIAL_VEHICLES: readonly ParkedVehicle[] = initialVehicles();
/**
 * Pengendara motor ambient (R&D: "motor warga jalan tanpa pengendara").
 * Dipakai bersama oleh generator aset (tools/assets/defs/traffic.ts) dan runtime
 * (ambient/AmbientLayer.tsx) supaya jok, stang, dan pose duduk tidak pernah geser.
 *
 * Kenapa aset pengendara terpisah dari veh_moto: GLB motor juga dipakai pemain
 * (game/vehicleModels.tsx) yang sudah punya hero di atasnya, jadi kalau pengendara
 * ditanam di dalam veh_moto, motor pemain akan punya dua orang. Aset sendiri juga
 * membuat pengendara bisa digambar sebagai InstancedMesh terpisah: dua draw call
 * untuk SEMUA motor warga.
 *
 * Pengendara dimodelkan langsung di ruang model veh_moto (origin sama), jadi runtime cukup
 * memakai matriks motor yang sama tanpa offset apa pun. Pipeline aset mewajibkan dasar di y=0;
 * itu dipenuhi bayangan blob datar di bawah motor (lapisan lalu lintas belum punya bayangan).
 *
 * Satuan meter, +Y up, forward = -Z (sama dengan konvensi pemain dan kendaraan).
 */

/** Id aset GLB pengendara; tidak masuk app/assets.ts karena file itu milik agen lain. */
export const MOTO_RIDER_ASSET = 'veh_moto_rider';

/**
 * Titik kontak pengendara dengan veh_moto (lihat buildMoto di tools/assets/defs/traffic.ts),
 * dalam ruang model MOTOR: runtime memakai matriks motor yang sama persis, tanpa offset.
 */
export const MOTO_RIDER = {
  /** Pijakan kaki di samping blok mesin veh_moto (y 0.45, z -0.1). */
  pegX: 0.2,
  pegY: 0.3,
  pegZ: -0.02,
  /** Atas jok veh_moto: kotak y 0.86 tinggi 0.1 -> 0.91. Pinggul duduk tepat di sini. */
  seatY: 0.91,
  seatZ: 0.26,
  /** Ujung stang veh_moto (grip di x +-0.27, y 1.02, z -0.3). */
  gripX: 0.27,
  gripY: 1.02,
  gripZ: -0.3,
} as const;

export interface VehiclePose {
  x: number;
  z: number;
  /** Arah jalan (unit). */
  dirX: number;
  dirZ: number;
}

export interface RiderPose {
  x: number;
  y: number;
  z: number;
  /** Heading pemain/kendaraan: 0 menghadap -Z. */
  heading: number;
  /** Posisi dunia pinggul (titik duduk), untuk uji dan debug. */
  hipX: number;
  hipY: number;
  hipZ: number;
}

/**
 * Pose dunia pengendara untuk satu motor. Origin pengendara = origin motor, jadi heading-nya
 * harus sama persis dengan addVehicle di AmbientLayer (atan2(-dirX, -dirZ)); titik duduk dihitung
 * supaya uji bisa memastikan pinggul ada di atas jok, di belakang pivot motor.
 */
export function motoRiderPose(pose: VehiclePose, groundY: number): RiderPose {
  const heading = Math.atan2(-pose.dirX, -pose.dirZ);
  // +z lokal = ke belakang kendaraan = -dir di ruang dunia.
  return {
    x: pose.x,
    y: groundY,
    z: pose.z,
    heading,
    hipX: pose.x - pose.dirX * MOTO_RIDER.seatZ,
    hipY: groundY + MOTO_RIDER.seatY,
    hipZ: pose.z - pose.dirZ * MOTO_RIDER.seatZ,
  };
}

/** Variasi warna jaket/helm per pengendara (dikalikan ke vertex colour netral PALETTE.paint). */
export const RIDER_TINTS = ['#e8e4dc', '#e0714a', '#4f7fd0', '#49a271', '#e3c15a', '#b06cc0', '#3d4a5c'] as const;

/** Warna pengendara dipilih dari id kendaraan supaya stabil selama kendaraan hidup. */
export const riderTint = (vehicleId: number): string =>
  RIDER_TINTS[((Math.floor(vehicleId) % RIDER_TINTS.length) + RIDER_TINTS.length) % RIDER_TINTS.length] as string;

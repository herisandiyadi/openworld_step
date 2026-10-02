/**
 * Shared by the asset generator (tools/assets) and the runtime so that model geometry,
 * character animation, and in-game motion stay in sync. Units: metres, +Y up, -Z forward.
 */
export const BIKE = {
  wheelRadius: 0.34,
  hubY: 0.34,
  frontHubZ: -0.52,
  rearHubZ: 0.52,
  crankY: 0.32,
  crankZ: 0.02,
  crankLength: 0.16,
  saddleTopY: 0.92,
  saddleZ: 0.22,
  gripX: 0.25,
  gripY: 1.05,
  gripZ: -0.3,
  /** Virtual gearing: metres travelled per crank revolution. */
  metersPerCrankTurn: 5,
} as const;

export const SKATE = {
  deckTopY: 0.12,
} as const;

/** Parameter kemudi per kendaraan. `turnRadius` = radius putar (m) saat kemudi penuh. */
export interface DriveSpec {
  maxSpeed: number;
  reverseSpeed: number;
  /** Percepatan gas (m/s^2). */
  accel: number;
  /** Perlambatan rem (m/s^2). */
  brake: number;
  /** Perlambatan saat gas dilepas (m/s^2). */
  drag: number;
  turnRadius: number;
}

/** Sepeda dan skateboard belok halus (radius kecil); motor dan mobil butuh ruang. */
export const DRIVE: Record<'skate' | 'bike' | 'moto' | 'car', DriveSpec> = {
  skate: { maxSpeed: 8, reverseSpeed: 1.5, accel: 5, brake: 7, drag: 2.5, turnRadius: 2.2 },
  bike: { maxSpeed: 11, reverseSpeed: 1.5, accel: 5, brake: 8, drag: 2, turnRadius: 2.8 },
  moto: { maxSpeed: 15, reverseSpeed: 4, accel: 8, brake: 12, drag: 3, turnRadius: 3.2 },
  car: { maxSpeed: 18, reverseSpeed: 6, accel: 6, brake: 14, drag: 2.5, turnRadius: 5 },
};

/**
 * Kecepatan minimum (m/s) yang dipakai untuk menghitung belokan. Tanpa ini, yaw rate
 * sebanding dengan kecepatan, jadi manuver pelan di gang atau setelah menabrak hampir
 * tidak membelokkan kendaraan sama sekali.
 */
const MIN_TURN_SPEED = 3;

export interface DriveState {
  /** Kecepatan sepanjang arah hadap (m/s); negatif = mundur. */
  speed: number;
}

/**
 * Model kendaraan sederhana: gas/rem di sumbu z joystick, belok di sumbu x.
 * Sudut hadap hanya berubah kalau kendaraan bergerak, jadi tidak bisa berputar di tempat.
 * Mengembalikan arah hadap yang baru. Konvensi arah sama dengan pemain: forward = (-sin, -cos).
 */
export function stepDrive(state: DriveState, heading: number, input: { x: number; z: number }, spec: DriveSpec, dt: number): number {
  const throttle = Math.max(-1, Math.min(1, -input.z));
  const steer = Math.max(-1, Math.min(1, input.x));

  if (throttle > 0.05) {
    state.speed = Math.min(state.speed + spec.accel * throttle * dt, spec.maxSpeed * throttle);
  } else if (throttle < -0.05) {
    const rate = state.speed > 0 ? spec.brake : spec.accel;
    state.speed = Math.max(state.speed + rate * throttle * dt, -spec.reverseSpeed);
  } else {
    const decel = spec.drag * dt;
    state.speed = Math.abs(state.speed) <= decel ? 0 : state.speed - Math.sign(state.speed) * decel;
  }

  // Yaw rate model sepeda: nol saat berhenti, dan terbalik sendiri saat mundur.
  // Di bawah MIN_TURN_SPEED, belokan dihitung seolah kendaraan berjalan di kecepatan itu,
  // supaya manuver pelan dan mundur tetap responsif.
  if (state.speed === 0) return heading;
  const turnSpeed = Math.sign(state.speed) * Math.max(Math.abs(state.speed), MIN_TURN_SPEED);
  return heading - (steer * turnSpeed * dt) / spec.turnRadius;
}

/** Clip lengths (s) and the ground speed (m/s) each locomotion clip was authored for. */
export const ANIM = {
  idleCycle: 3,
  walkCycle: 1.1,
  walkSpeed: 1.5,
  runCycle: 0.7,
  runSpeed: 4.5,
  skateCycle: 2,
  /** One full crank revolution. */
  bikeCycle: 0.8,
  talkCycle: 2.4,
} as const;
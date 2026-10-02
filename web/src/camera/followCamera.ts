/**
 * Logika kamera third-person (ala GTA V) tanpa three.js supaya bisa di-unit-test.
 * Konvensi: yaw 0 = kamera di +Z menghadap -Z, sama seperti heading pemain
 * (forward = (-sin, -cos)). Satuan meter dan radian.
 */
import type { Aabb, Vec2 } from '../game/movement';
import type { MoveMode } from '../state/gameStore';

const DEG = Math.PI / 180;

export interface CameraTuning {
  /** Jarak default kamera ke target (m). */
  distance: number;
  /** Tinggi titik bidik di atas tanah (m). */
  targetY: number;
  pitch: number;
  fov: number;
}

export const CAMERA_MODES: Record<MoveMode, CameraTuning> = {
  walk: { distance: 5.5, targetY: 1.6, pitch: 12 * DEG, fov: 55 },
  skate: { distance: 6.5, targetY: 1.5, pitch: 12 * DEG, fov: 58 },
  bike: { distance: 6.5, targetY: 1.5, pitch: 12 * DEG, fov: 58 },
  moto: { distance: 7.5, targetY: 1.4, pitch: 10 * DEG, fov: 60 },
  car: { distance: 9, targetY: 1.3, pitch: 10 * DEG, fov: 60 },
};

/**
 * Kamera saat duduk di dalam bus: lebih jauh dan lebih tinggi dari mobil supaya seluruh bus dan
 * jalan di depannya terlihat (bus 10 m, pemain duduk di bagian belakang).
 */
export const BUS_CAMERA: CameraTuning = { distance: 15, targetY: 2.6, pitch: 16 * DEG, fov: 60 };

export const PITCH_MIN = -5 * DEG;
export const PITCH_MAX = 40 * DEG;
export const ZOOM_MIN = 0.7;
export const ZOOM_MAX = 1.3;
/** Jeda sebelum kamera kembali ke belakang pemain (detik). */
export const RECENTER_WALK = 1.5;
export const RECENTER_DRIVE = 0.6;
export const LOOK_AHEAD_MAX = 2;
export const FOV_BOOST = 6;
/** Kecepatan (m/s) saat look-ahead dan FOV mencapai maksimum. */
export const SPEED_REF = 14;
/** Model pemain disembunyikan di bawah jarak ini. */
export const HERO_HIDE_DISTANCE = 1.2;
/** Jarak aman kamera dari titik tabrakan. */
export const CAMERA_SKIN = 0.3;
/**
 * Collider yang lebih kecil dari ini (tiang, tempat sampah) diabaikan kamera.
 * ponytail: batasnya ukuran collider, bukan jenis objek. Upgrade kalau nanti ada
 * gedung kecil: tandai collider gedung saat bake di tools/world.
 */
export const MIN_BLOCKER_SIZE = 3;

export interface FollowState {
  yaw: number;
  pitch: number;
  /** Faktor jarak, 0.7..1.3. */
  zoom: number;
  /** Detik sejak gesture kamera terakhir. */
  sinceGesture: number;
  /** True selama jari/mouse menggeser kamera. */
  dragging: boolean;
  /** Jarak kamera hasil solve (sudah termasuk tabrakan), dibaca Hero dan metrik soak. */
  distance: number;
}

export interface CameraPose {
  x: number;
  y: number;
  z: number;
  /** Titik bidik. */
  tx: number;
  ty: number;
  tz: number;
  fov: number;
}

export const createFollowState = (): FollowState => ({
  yaw: 0,
  pitch: CAMERA_MODES.walk.pitch,
  zoom: 1,
  sinceGesture: RECENTER_WALK,
  dragging: false,
  distance: CAMERA_MODES.walk.distance,
});

/** State kamera bersama: ditulis CameraRig + gesture, dibaca joystick, minimap, Hero. */
export const cameraState = createFollowState();

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const isDriving = (mode: MoveMode) => mode !== 'walk';

/** Geser dari gesture: yaw bebas, pitch dibatasi. */
export function applyDrag(state: FollowState, deltaYaw: number, deltaPitch: number): void {
  state.yaw += deltaYaw;
  state.pitch = clamp(state.pitch + deltaPitch, PITCH_MIN, PITCH_MAX);
  state.sinceGesture = 0;
  state.dragging = true;
}

export function applyZoom(state: FollowState, factor: number): void {
  state.zoom = clamp(state.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  state.sinceGesture = 0;
}

/** Input joystick/WASD dirotasi ke ruang kamera: atas = arah pandang kamera. */
export function rotateCameraInput(input: Vec2, yaw: number): Vec2 {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return { x: input.x * cos + input.z * sin, z: -input.x * sin + input.z * cos };
}

export function lookAheadDistance(mode: MoveMode, speed: number): number {
  if (!isDriving(mode)) return 0;
  return Math.min(1, Math.abs(speed) / SPEED_REF) * LOOK_AHEAD_MAX;
}

export function cameraFov(mode: MoveMode, speed: number): number {
  return CAMERA_MODES[mode].fov + Math.min(1, Math.abs(speed) / SPEED_REF) * FOV_BOOST;
}

/** Interpolasi sudut lewat jalur terpendek. */
export function lerpAngle(from: number, to: number, alpha: number): number {
  return from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * alpha;
}

/** Auto-recenter: kamera kembali ke belakang pemain setelah jeda dan hanya saat bergerak. */
export function stepFollow(state: FollowState, mode: MoveMode, heading: number, speed: number, dt: number, recenter = true): void {
  if (!recenter) {
    // Duduk: kamera tetap bisa diputar dan di-zoom, hanya auto-recenter yang mati.
    state.sinceGesture += dt;
    return;
  }
  if (state.dragging) {
    state.sinceGesture = 0;
    return;
  }
  state.sinceGesture += dt;
  const driving = isDriving(mode);
  if (state.sinceGesture < (driving ? RECENTER_DRIVE : RECENTER_WALK) || Math.abs(speed) < 0.5) return;
  state.yaw = lerpAngle(state.yaw, heading, 1 - Math.exp(-(driving ? 2.5 : 1.2) * dt));
}

const tooSmall = (box: Aabb) => box.maxX - box.minX < MIN_BLOCKER_SIZE && box.maxZ - box.minZ < MIN_BLOCKER_SIZE;

/**
 * Ray 2D (bidang XZ) versus AABB dengan metode slab. Mengembalikan jarak tabrakan
 * atau `maxDist` kalau bersih. Arah (dx, dz) harus unit.
 */
export function rayHitDistance(
  ox: number,
  oz: number,
  dx: number,
  dz: number,
  maxDist: number,
  boxes: readonly Aabb[],
): number {
  let nearest = maxDist;
  for (const box of boxes) {
    if (tooSmall(box)) continue;
    let enter = 0;
    let exit = nearest;
    for (const axis of [0, 1]) {
      const o = axis === 0 ? ox : oz;
      const d = axis === 0 ? dx : dz;
      const min = axis === 0 ? box.minX : box.minZ;
      const max = axis === 0 ? box.maxX : box.maxZ;
      if (Math.abs(d) < 1e-6) {
        if (o < min || o > max) {
          enter = Infinity;
          break;
        }
        continue;
      }
      const t1 = (min - o) / d;
      const t2 = (max - o) / d;
      enter = Math.max(enter, Math.min(t1, t2));
      exit = Math.min(exit, Math.max(t1, t2));
    }
    if (enter <= exit && enter < nearest) nearest = enter;
  }
  return nearest;
}

export interface SolveInput {
  mode: MoveMode;
  /** Posisi pemain (y = tinggi tanah). */
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  boxes: readonly Aabb[];
  /** Ganti tuning mode (mis. BUS_CAMERA saat naik bus). */
  tuning?: CameraTuning;
}

/**
 * Hitung pose kamera: titik bidik + look-ahead, jarak dengan zoom dan tabrakan gedung,
 * lalu FOV. Jarak di-smooth: maju cepat saat terhalang, menjauh pelan agar tidak melompat.
 */
export function solveCamera(state: FollowState, input: SolveInput, dt: number, out: CameraPose): void {
  const tuning = input.tuning ?? CAMERA_MODES[input.mode];
  const ahead = lookAheadDistance(input.mode, input.speed);
  out.tx = input.x - Math.sin(input.heading) * ahead;
  out.ty = input.y + tuning.targetY;
  out.tz = input.z - Math.cos(input.heading) * ahead;

  const cosPitch = Math.cos(state.pitch);
  const dirX = Math.sin(state.yaw);
  const dirZ = Math.cos(state.yaw);
  const desired = tuning.distance * state.zoom;
  const maxRay = desired * cosPitch;
  const hit = rayHitDistance(out.tx, out.tz, dirX, dirZ, maxRay, input.boxes);
  // Skin hanya dipakai kalau memang kena, supaya jarak bebas tetap sesuai mode.
  const goal = hit < maxRay ? Math.max(0.6, (hit - CAMERA_SKIN) / Math.max(cosPitch, 1e-3)) : desired;
  const rate = goal < state.distance ? 40 : 6;
  state.distance += (goal - state.distance) * (1 - Math.exp(-rate * dt));

  out.x = out.tx + dirX * cosPitch * state.distance;
  out.y = out.ty + Math.sin(state.pitch) * state.distance;
  out.z = out.tz + dirZ * cosPitch * state.distance;
  out.fov = cameraFov(input.mode, input.speed);
}

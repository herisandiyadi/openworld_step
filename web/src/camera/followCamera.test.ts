import { describe, expect, it } from 'vitest';
import {
  applyDrag,
  applyZoom,
  CAMERA_MODES,
  cameraFov,
  createFollowState,
  FOV_BOOST,
  LOOK_AHEAD_MAX,
  lookAheadDistance,
  PITCH_MAX,
  PITCH_MIN,
  rayHitDistance,
  rotateCameraInput,
  solveCamera,
  stepFollow,
  ZOOM_MAX,
  ZOOM_MIN,
  type CameraPose,
} from './followCamera';

const pose = (): CameraPose => ({ x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, fov: 0 });
const run = (fn: (dt: number) => void, seconds: number, dt = 1 / 60) => {
  for (let t = 0; t < seconds; t += dt) fn(dt);
};

describe('batas pitch dan zoom', () => {
  it('menjepit pitch di -5 dan 40 derajat', () => {
    const state = createFollowState();
    applyDrag(state, 0, -10);
    expect(state.pitch).toBeCloseTo(PITCH_MIN);
    applyDrag(state, 0, 10);
    expect(state.pitch).toBeCloseTo(PITCH_MAX);
  });

  it('menjepit zoom di +-30%', () => {
    const state = createFollowState();
    applyZoom(state, 0.1);
    expect(state.zoom).toBeCloseTo(ZOOM_MIN);
    applyZoom(state, 10);
    expect(state.zoom).toBeCloseTo(ZOOM_MAX);
  });

  it('yaw bebas berputar tanpa batas', () => {
    const state = createFollowState();
    applyDrag(state, 10, 0);
    expect(state.yaw).toBeCloseTo(10);
  });
});

describe('auto-recenter', () => {
  it('tidak bergerak sebelum 1.5 detik saat jalan kaki, lalu kembali ke belakang pemain', () => {
    const state = createFollowState();
    applyDrag(state, 2, 0);
    state.dragging = false;

    run((dt) => stepFollow(state, 'walk', 0, 4, dt), 1.4);
    expect(state.yaw).toBeCloseTo(2);

    run((dt) => stepFollow(state, 'walk', 0, 4, dt), 6);
    expect(Math.abs(state.yaw)).toBeLessThan(0.1);
  });

  it('berkendara recenter lebih cepat (0.6 detik)', () => {
    const walk = createFollowState();
    const drive = createFollowState();
    applyDrag(walk, 1, 0);
    applyDrag(drive, 1, 0);
    walk.dragging = false;
    drive.dragging = false;
    run((dt) => {
      stepFollow(walk, 'walk', 0, 10, dt);
      stepFollow(drive, 'car', 0, 10, dt);
    }, 1.2);
    expect(drive.yaw).toBeLessThan(walk.yaw);
  });

  it('tidak recenter saat pemain diam atau jari masih menempel', () => {
    const idle = createFollowState();
    applyDrag(idle, 1, 0);
    idle.dragging = false;
    run((dt) => stepFollow(idle, 'walk', 0, 0, dt), 5);
    expect(idle.yaw).toBeCloseTo(1);

    const held = createFollowState();
    applyDrag(held, 1, 0);
    run((dt) => stepFollow(held, 'walk', 0, 5, dt), 5);
    expect(held.yaw).toBeCloseTo(1);
  });
});

describe('look-ahead dan FOV', () => {
  it('nol saat jalan kaki dan maksimum 2 m saat berkendara', () => {
    expect(lookAheadDistance('walk', 20)).toBe(0);
    expect(lookAheadDistance('car', 1000)).toBe(LOOK_AHEAD_MAX);
    expect(lookAheadDistance('car', 0)).toBe(0);
    expect(lookAheadDistance('car', -1000)).toBe(LOOK_AHEAD_MAX);
  });

  it('FOV naik maksimum +6 derajat', () => {
    expect(cameraFov('car', 0)).toBeCloseTo(CAMERA_MODES.car.fov);
    expect(cameraFov('car', 999)).toBeCloseTo(CAMERA_MODES.car.fov + FOV_BOOST);
  });
});

describe('joystick relatif kamera', () => {
  it('maju = arah pandang kamera', () => {
    // yaw 0: kamera di +Z, maju (z = -1) harus tetap -Z.
    const straight = rotateCameraInput({ x: 0, z: -1 }, 0);
    expect(straight.x).toBeCloseTo(0);
    expect(straight.z).toBeCloseTo(-1);
    // yaw 90 derajat: kamera di +X, maju harus jadi -X.
    const rotated = rotateCameraInput({ x: 0, z: -1 }, Math.PI / 2);
    expect(rotated.x).toBeCloseTo(-1);
    expect(rotated.z).toBeCloseTo(0);
  });

  it('mempertahankan besar input', () => {
    const r = rotateCameraInput({ x: 0.6, z: -0.8 }, 1.23);
    expect(Math.hypot(r.x, r.z)).toBeCloseTo(1);
  });
});

describe('ray vs AABB', () => {
  const box = { minX: 4, maxX: 10, minZ: -3, maxZ: 3 };

  it('kena kotak di depan', () => {
    expect(rayHitDistance(0, 0, 1, 0, 20, [box])).toBeCloseTo(4);
  });

  it('bersih kalau arah menjauh atau tidak sejajar', () => {
    expect(rayHitDistance(0, 0, -1, 0, 20, [box])).toBe(20);
    expect(rayHitDistance(0, 10, 1, 0, 20, [box])).toBe(20);
  });

  it('tidak melebihi jarak maksimum', () => {
    expect(rayHitDistance(0, 0, 1, 0, 2, [box])).toBe(2);
  });

  it('mengambil kotak terdekat', () => {
    const near = { minX: 2, maxX: 3, minZ: -3, maxZ: 3 };
    expect(rayHitDistance(0, 0, 1, 0, 20, [box, near])).toBeCloseTo(2);
  });

  it('mengabaikan collider kecil seperti tiang lampu', () => {
    const pole = { minX: 1, maxX: 1.3, minZ: -0.15, maxZ: 0.15 };
    expect(rayHitDistance(0, 0, 1, 0, 20, [pole])).toBe(20);
  });

  it('kena diagonal', () => {
    const d = Math.SQRT1_2;
    const diagonal = { minX: 3, maxX: 9, minZ: 3, maxZ: 9 };
    expect(rayHitDistance(0, 0, d, d, 20, [diagonal])).toBeCloseTo(3 / d);
  });
});

describe('solveCamera', () => {
  const base = { mode: 'walk' as const, x: 0, y: 0, z: 0, heading: 0, speed: 0, boxes: [] };

  it('menempatkan kamera di belakang target pada jarak mode', () => {
    const state = createFollowState();
    const out = pose();
    run((dt) => solveCamera(state, base, dt, out), 3);
    expect(out.z).toBeCloseTo(Math.cos(state.pitch) * CAMERA_MODES.walk.distance, 1);
    expect(out.y).toBeGreaterThan(CAMERA_MODES.walk.targetY);
    expect(state.distance).toBeCloseTo(CAMERA_MODES.walk.distance, 1);
  });

  it('maju saat gedung menghalangi lalu menjauh lagi setelah bersih', () => {
    const state = createFollowState();
    const out = pose();
    const wall = [{ minX: -20, maxX: 20, minZ: 2, maxZ: 20 }];
    run((dt) => solveCamera(state, { ...base, boxes: wall }, dt, out), 2);
    expect(state.distance).toBeLessThan(2);
    run((dt) => solveCamera(state, base, dt, out), 4);
    expect(state.distance).toBeCloseTo(CAMERA_MODES.walk.distance, 1);
  });

  it('menggeser titik bidik ke depan saat berkendara cepat', () => {
    const state = createFollowState();
    const out = pose();
    solveCamera(state, { ...base, mode: 'car', speed: 999 }, 1 / 60, out);
    expect(out.tz).toBeCloseTo(-LOOK_AHEAD_MAX);
    expect(out.fov).toBeCloseTo(CAMERA_MODES.car.fov + FOV_BOOST);
  });
});

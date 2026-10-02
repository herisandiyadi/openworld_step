export interface Vec2 {
  x: number;
  z: number;
}

export interface Aabb {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface CollisionWorld {
  boxes: readonly Aabb[];
  bounds: Aabb;
}

export interface PlayerState {
  x: number;
  z: number;
  /** Yaw in radians; the model faces local -Z, so forward = (-sin, -cos). */
  heading: number;
  /** Current waypoint of click-to-move. */
  target: Vec2 | null;
  /** Remaining navmesh waypoints after 	arget. */
  path: Vec2[];
  stuckTime: number;
}

export const INPUT_DEADZONE = 0.05;
export const ARRIVE_DISTANCE = 0.15;
const STUCK_RATIO = 0.25;
const STUCK_TIMEOUT = 0.4;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export function hasInput(input: Vec2): boolean {
  return Math.hypot(input.x, input.z) > INPUT_DEADZONE;
}

/** Pushes a circle (p, radius) out of every overlapping box. */
export function pushOutOfBoxes(p: Vec2, radius: number, boxes: readonly Aabb[]): void {
  for (const box of boxes) {
    const closestX = clamp(p.x, box.minX, box.maxX);
    const closestZ = clamp(p.z, box.minZ, box.maxZ);
    const dx = p.x - closestX;
    const dz = p.z - closestZ;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq >= radius * radius) continue;

    if (distanceSq > 1e-8) {
      const distance = Math.sqrt(distanceSq);
      p.x = closestX + (dx / distance) * radius;
      p.z = closestZ + (dz / distance) * radius;
      continue;
    }

    const toLeft = p.x - box.minX;
    const toRight = box.maxX - p.x;
    const toBack = p.z - box.minZ;
    const toFront = box.maxZ - p.z;
    const nearest = Math.min(toLeft, toRight, toBack, toFront);
    if (nearest === toLeft) p.x = box.minX - radius;
    else if (nearest === toRight) p.x = box.maxX + radius;
    else if (nearest === toBack) p.z = box.minZ - radius;
    else p.z = box.maxZ + radius;
  }
}

export function clampToBounds(p: Vec2, radius: number, bounds: Aabb): void {
  p.x = clamp(p.x, bounds.minX + radius, bounds.maxX - radius);
  p.z = clamp(p.z, bounds.minZ + radius, bounds.maxZ - radius);
}

/** Moves a tapped destination to the nearest walkable spot. */
export function resolveTarget(target: Vec2, radius: number, world: CollisionWorld): Vec2 {
  const resolved = { x: target.x, z: target.z };
  pushOutOfBoxes(resolved, radius, world.boxes);
  clampToBounds(resolved, radius, world.bounds);
  return resolved;
}

/** Starts click-to-move along waypoints (the last one is the destination). */
export function followPath(state: PlayerState, waypoints: Vec2[]): void {
  state.path = waypoints.slice(1);
  state.target = waypoints[0] ?? null;
  state.stuckTime = 0;
}

/**
 * Advances the player one tick. Analog input wins over a click-to-move target.
 * Returns true when the player moved.
 */
export function stepPlayer(
  state: PlayerState,
  input: Vec2,
  speed: number,
  radius: number,
  dt: number,
  world: CollisionWorld,
): boolean {
  let vx = 0;
  let vz = 0;
  const inputMagnitude = Math.hypot(input.x, input.z);

  if (inputMagnitude > INPUT_DEADZONE) {
    state.target = null;
    state.path.length = 0;
    state.stuckTime = 0;
    const scale = (Math.min(inputMagnitude, 1) * speed) / inputMagnitude;
    vx = input.x * scale;
    vz = input.z * scale;
  } else if (state.target) {
    const dx = state.target.x - state.x;
    const dz = state.target.z - state.z;
    const distance = Math.hypot(dx, dz);
    if (distance < ARRIVE_DISTANCE) {
      state.target = state.path.shift() ?? null;
      state.stuckTime = 0;
    } else {
      const stepSpeed = Math.min(speed, distance / dt);
      vx = (dx / distance) * stepSpeed;
      vz = (dz / distance) * stepSpeed;
    }
  }

  if (vx === 0 && vz === 0) return false;

  const startX = state.x;
  const startZ = state.z;
  state.x += vx * dt;
  state.z += vz * dt;
  pushOutOfBoxes(state, radius, world.boxes);
  clampToBounds(state, radius, world.bounds);
  state.heading = Math.atan2(-vx, -vz);

  if (state.target) {
    const expected = Math.hypot(vx, vz) * dt;
    const actual = Math.hypot(state.x - startX, state.z - startZ);
    state.stuckTime = actual < expected * STUCK_RATIO ? state.stuckTime + dt : 0;
    if (state.stuckTime > STUCK_TIMEOUT) {
      state.target = null;
      state.path.length = 0;
      state.stuckTime = 0;
    }
  }

  return true;
}
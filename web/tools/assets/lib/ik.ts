export interface PlanarPoint {
  y: number;
  z: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Direction angle for a limb whose rest pose points straight down: X rotation, positive swings toward -Z. */
export const downAngle = (dy: number, dz: number): number => Math.atan2(-dz, -dy);

/**
 * Planar two-bone IK in the YZ plane. Returns local X rotations for the upper bone and the lower
 * bone (relative to the upper). `bendForward` places the middle joint on the -Z side (knees);
 * otherwise on the +Z side (elbows).
 */
export function solveTwoBone(
  root: PlanarPoint,
  target: PlanarPoint,
  upperLength: number,
  lowerLength: number,
  bendForward: boolean,
): { upper: number; lower: number } {
  const dy = target.y - root.y;
  const dz = target.z - root.z;
  const distance = clamp(Math.hypot(dy, dz), Math.abs(upperLength - lowerLength) + 1e-4, upperLength + lowerLength - 1e-4);
  const base = downAngle(dy, dz);
  const cosAlpha = (upperLength ** 2 + distance ** 2 - lowerLength ** 2) / (2 * upperLength * distance);
  const alpha = Math.acos(clamp(cosAlpha, -1, 1));
  const upper = bendForward ? base + alpha : base - alpha;
  const jointY = root.y - upperLength * Math.cos(upper);
  const jointZ = root.z - upperLength * Math.sin(upper);
  const lowerAbsolute = downAngle(target.y - jointY, target.z - jointZ);
  return { upper, lower: lowerAbsolute - upper };
}
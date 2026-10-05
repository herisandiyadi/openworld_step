import { describe, expect, it } from 'vitest';
import { texelSnapOffset } from './shadowSnap';

const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

describe('texelSnapOffset', () => {
  it('moves the light only perpendicular to its direction, by less than one texel', () => {
    const pos: [number, number, number] = [28.3, 30, 9.7];
    const target: [number, number, number] = [10.3, 0, -2.3];
    const texel = 0.05;
    const d = texelSnapOffset(pos, target, texel);
    const dir = [target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]];
    expect(Math.abs(dot(d, dir))).toBeLessThan(1e-9);
    expect(Math.hypot(...d)).toBeLessThanOrEqual(texel * Math.SQRT2 + 1e-9);
  });
  it('is stable: snapping an already snapped light changes nothing', () => {
    const pos: [number, number, number] = [28.3, 30, 9.7];
    const target: [number, number, number] = [10.3, 0, -2.3];
    const d = texelSnapOffset(pos, target, 0.05);
    const p2: [number, number, number] = [pos[0] + d[0], pos[1] + d[1], pos[2] + d[2]];
    const t2: [number, number, number] = [target[0] + d[0], target[1] + d[1], target[2] + d[2]];
    const again = texelSnapOffset(p2, t2, 0.05);
    expect(Math.hypot(...again)).toBeLessThan(1e-6);
  });
});

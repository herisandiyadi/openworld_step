import { describe, expect, it } from 'vitest';
import { PED_ANIM_GLSL, pedAnimPose, SIT_DROP, STRIDE } from './pedAnim';

describe('animasi prosedural warga', () => {
  it('saat jalan kaki kiri dan kanan berayun berlawanan, lutut tidak pernah menekuk ke depan', () => {
    for (let i = 0; i < 64; i++) {
      const pose = pedAnimPose('walk', (i / 64) * Math.PI * 2);
      expect(pose.thighL).toBeCloseTo(-pose.thighR);
      expect(pose.armL).toBeCloseTo(-pose.armR);
      expect(pose.kneeL).toBeGreaterThanOrEqual(0);
      expect(pose.kneeR).toBeGreaterThanOrEqual(0);
    }
  });

  it('duduk menurunkan pinggul setinggi bangku dan paha mendatar', () => {
    const pose = pedAnimPose('sit', 1);
    expect(pose.bob).toBe(-SIT_DROP);
    expect(pose.thighL).toBeCloseTo(Math.PI / 2);
    expect(PED_ANIM_GLSL).toContain('PedPose(1.5707963, 1.5707963');
  });

  it('diam hampir tidak bergerak, dan GLSL memakai konstanta yang sama', () => {
    const pose = pedAnimPose('idle', 2);
    expect(Math.abs(pose.thighL) + Math.abs(pose.kneeL)).toBe(0);
    expect(Math.abs(pose.bob)).toBeLessThan(0.02);
    expect(STRIDE).toBeGreaterThan(0);
    expect(PED_ANIM_GLSL).toContain(`-${SIT_DROP.toFixed(2)}`);
    expect(PED_ANIM_GLSL).toContain('0.55 * swing');
  });
});

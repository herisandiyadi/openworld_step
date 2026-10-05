import { describe, expect, it } from 'vitest';
import { BUDGET, checkBudget, evaluateBudget } from './budget';
import { collectMetrics, type RenderMetrics } from './renderMetrics';

const MB = 1024 * 1024;

/** Snapshot sehat yang masuk semua budget; tiap test menimpa satu field. */
function healthy(over: Partial<RenderMetrics> = {}): RenderMetrics {
  const base = collectMetrics(
    { render: { calls: 80, triangles: 300_000 }, memory: { geometries: 50, textures: 30 }, programs: [] },
    { isWebGL2: true },
    { frameTimeCpuMs: 30, textureSizes: [{ width: 1024, height: 1024 }], shadowMapSize: 1024, shadowCasters: 1, postProcessingPasses: 1 },
  );
  return { ...base, ...over };
}

describe('evaluateBudget', () => {
  it('scene sehat tidak punya pelanggaran', () => {
    expect(evaluateBudget(healthy())).toEqual([]);
  });

  it('budget sesuai task list', () => {
    expect(BUDGET).toEqual({
      minFps: 30,
      maxTriangles: 400_000,
      targetTrianglesMin: 250_000,
      maxDrawCalls: 120,
      maxTextureMemoryBytes: 200 * MB,
      maxShadowCasters: 1,
      maxPostProcessingPasses: 2,
    });
  });

  it('fps di bawah 30 adalah fail dengan nilai aktual vs batas', () => {
    const [v] = evaluateBudget(healthy({ fps: 24 }));
    expect(v).toMatchObject({ metric: 'fps', severity: 'fail', actual: 24, limit: 30 });
  });

  it('fps tepat di atas batas tanpa headroom adalah warn', () => {
    expect(evaluateBudget(healthy({ fps: 31 }))[0]).toMatchObject({ metric: 'fps', severity: 'warn' });
  });

  it('fps 0 (belum ada sampel) tidak dinilai', () => {
    expect(evaluateBudget(healthy({ fps: 0 }))).toEqual([]);
  });

  it('draw calls 120 ke atas fail, mendekati batas warn', () => {
    expect(evaluateBudget(healthy({ calls: 120 }))[0]).toMatchObject({ metric: 'calls', severity: 'fail', limit: 120 });
    expect(evaluateBudget(healthy({ calls: 110 }))[0]).toMatchObject({ metric: 'calls', severity: 'warn' });
  });

  it('triangles di atas 400k fail', () => {
    expect(evaluateBudget(healthy({ triangles: 450_000 }))[0]).toMatchObject({ metric: 'triangles', severity: 'fail', actual: 450_000, limit: 400_000 });
  });

  it('texture memory 200 MB ke atas fail', () => {
    expect(evaluateBudget(healthy({ textureMemoryBytes: 210 * MB }))[0]).toMatchObject({ metric: 'textureMemoryBytes', severity: 'fail' });
  });

  it('lebih dari satu shadow caster fail', () => {
    expect(evaluateBudget(healthy({ shadowCasters: 2 }))[0]).toMatchObject({ metric: 'shadowCasters', severity: 'fail', actual: 2, limit: 1 });
  });

  it('lebih dari 2 full-screen pass fail', () => {
    expect(evaluateBudget(healthy({ postProcessingPasses: 5 }))[0]).toMatchObject({ metric: 'postProcessingPasses', severity: 'fail', actual: 5, limit: 2 });
  });

  it('mengembalikan beberapa pelanggaran sekaligus dengan urutan stabil', () => {
    const vs = evaluateBudget(healthy({ fps: 20, calls: 200, postProcessingPasses: 5, shadowCasters: 3 }));
    expect(vs.map((v) => v.metric)).toEqual(['fps', 'calls', 'shadowCasters', 'postProcessingPasses']);
    expect(vs.every((v) => v.severity === 'fail')).toBe(true);
    expect(vs.every((v) => v.message.length > 0)).toBe(true);
  });
});

describe('checkBudget', () => {
  it('mengembalikan semua metrik termasuk yang ok', () => {
    const all = checkBudget(healthy());
    expect(all.map((c) => c.metric)).toEqual(['fps', 'triangles', 'calls', 'textureMemoryBytes', 'shadowCasters', 'postProcessingPasses']);
    expect(all.every((c) => c.severity === 'ok')).toBe(true);
  });
});

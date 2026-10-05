import type { RenderMetrics } from './renderMetrics';

export interface BudgetViolation {
  metric: string;
  severity: 'ok' | 'warn' | 'fail';
  actual: number;
  limit: number;
  message: string;
}

/** Budget dari task list bagian "Target awal mobile". */
export const BUDGET = {
  minFps: 30,
  maxTriangles: 400_000,
  targetTrianglesMin: 250_000,
  maxDrawCalls: 120,
  maxTextureMemoryBytes: 200 * 1024 * 1024,
  maxShadowCasters: 1,
  maxPostProcessingPasses: 2,
} as const;

function entry(metric: string, severity: BudgetViolation['severity'], actual: number, limit: number, message: string): BudgetViolation {
  return { metric, severity, actual, limit, message };
}

/**
 * Metrik "lebih kecil lebih baik": fail saat mencapai/melewati batas,
 * warn saat sudah masuk 90% batas (headroom tipis).
 */
function ceilingCheck(metric: string, actual: number, limit: number, warnRatio = 0.9, failAtLimit = true): BudgetViolation {
  const overLimit = failAtLimit ? actual >= limit : actual > limit;
  if (overLimit) return entry(metric, 'fail', actual, limit, `${metric} ${actual} melewati batas ${limit}`);
  if (actual >= limit * warnRatio) return entry(metric, 'warn', actual, limit, `${metric} ${actual} mendekati batas ${limit}`);
  return entry(metric, 'ok', actual, limit, `${metric} ${actual} dalam budget ${limit}`);
}

/** FPS: fail di bawah target, warn saat headroom < 10%. fps 0 = belum ada sampel. */
function fpsCheck(fps: number): BudgetViolation {
  const limit = BUDGET.minFps;
  if (fps <= 0) return entry('fps', 'ok', fps, limit, 'fps belum terukur');
  if (fps < limit) return entry('fps', 'fail', fps, limit, `fps ${fps} di bawah target ${limit}`);
  if (fps < limit * 1.1) return entry('fps', 'warn', fps, limit, `fps ${fps} hanya sedikit di atas target ${limit}`);
  return entry('fps', 'ok', fps, limit, `fps ${fps} memenuhi target ${limit}`);
}

/** Semua metrik dengan severity-nya, termasuk yang 'ok'. Urutan stabil. */
export function checkBudget(metrics: RenderMetrics): BudgetViolation[] {
  return [
    fpsCheck(metrics.fps),
    ceilingCheck('triangles', metrics.triangles, BUDGET.maxTriangles, 0.9, false),
    ceilingCheck('calls', metrics.calls, BUDGET.maxDrawCalls),
    ceilingCheck('textureMemoryBytes', metrics.textureMemoryBytes, BUDGET.maxTextureMemoryBytes),
    ceilingCheck('shadowCasters', metrics.shadowCasters, BUDGET.maxShadowCasters, 1.1, false),
    ceilingCheck('postProcessingPasses', metrics.postProcessingPasses, BUDGET.maxPostProcessingPasses, 1.1, false),
  ];
}

export function evaluateBudget(metrics: RenderMetrics): BudgetViolation[] {
  return checkBudget(metrics).filter((violation) => violation.severity !== 'ok');
}

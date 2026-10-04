import type { BudgetViolation } from './budget';
import type { BenchmarkVariant } from './benchmarkScene';
import type { RenderMetrics } from './renderMetrics';

export const DEVICE_CLASSES = ['android-low', 'android-mid', 'desktop'] as const;
export type DeviceClass = (typeof DEVICE_CLASSES)[number];
export type CaptureTier = 'low' | 'medium' | 'high';
export type ReportVerdict = 'pass' | 'warn' | 'fail';

export interface CaptureReport {
  readonly schemaVersion: 1;
  readonly tier: CaptureTier;
  readonly variant: BenchmarkVariant;
  readonly deviceClass: DeviceClass;
  readonly capturedAt: string;
  readonly metrics: RenderMetrics;
  readonly violations: readonly BudgetViolation[];
  readonly verdict: ReportVerdict;
}

export interface BuildReportInput {
  tier: CaptureTier;
  variant: BenchmarkVariant;
  metrics: RenderMetrics;
  violations: readonly BudgetViolation[];
  deviceClass: DeviceClass;
  capturedAt: string;
}

function verdictFor(violations: readonly BudgetViolation[]): ReportVerdict {
  if (violations.some((v) => v.severity === 'fail')) return 'fail';
  if (violations.some((v) => v.severity === 'warn')) return 'warn';
  return 'pass';
}

/** Membuat report plain object; timestamp wajib disuplai caller agar deterministik. */
export function buildReport(input: BuildReportInput): CaptureReport {
  return {
    schemaVersion: 1,
    tier: input.tier,
    variant: input.variant,
    deviceClass: input.deviceClass,
    capturedAt: input.capturedAt,
    metrics: input.metrics,
    violations: input.violations,
    verdict: verdictFor(input.violations),
  };
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Format stabil, tanpa timestamp baru atau field yang berubah-ubah. */
export function formatReportMarkdown(report: CaptureReport): string {
  const lines = [
    '# Benchmark Capture Report',
    '',
    `- Tier: ${report.tier}`,
    `- Variant: ${report.variant}`,
    `- Device: ${report.deviceClass}`,
    `- Captured at: ${report.capturedAt}`,
    `- Verdict: **${report.verdict}**`,
    '',
    '## Metrics',
    '',
    '| Metric | Value |',
    '| --- | ---: |',
    `| FPS | ${report.metrics.fps.toFixed(2)} |`,
    `| CPU frame time | ${report.metrics.cpuFrameTimeMs.toFixed(2)} ms |`,
    `| Draw calls | ${report.metrics.calls} |`,
    `| Triangles | ${report.metrics.triangles} |`,
    `| Textures | ${report.metrics.textures} (${formatBytes(report.metrics.textureMemoryBytes)}) |`,
    `| Shadow memory | ${formatBytes(report.metrics.shadowMemoryBytes)} |`,
    `| Post-processing passes | ${report.metrics.postProcessingPasses} |`,
  ];
  if (report.violations.length > 0) {
    lines.push('', '## Violations', '', ...report.violations.map((v) => `- **${v.severity}** ${v.metric}: ${v.actual} (limit ${v.limit})`));
  }
  return `${lines.join('\n')}\n`;
}

import { describe, expect, it } from 'vitest';
import { buildReport, formatReportMarkdown, DEVICE_CLASSES } from './captureReport';
import { evaluateBudget } from './budget';
import { collectMetrics } from './renderMetrics';

function fixture() {
  const metrics = collectMetrics(
    { render: { calls: 90, triangles: 310_000 }, memory: { geometries: 60, textures: 40 }, programs: [{}, {}] },
    { isWebGL2: true },
    { frameTimeCpuMs: 33, textureSizes: [{ width: 2048, height: 2048 }], shadowMapSize: 1024, shadowCasters: 1, postProcessingPasses: 2 },
  );
  return {
    tier: 'medium' as const,
    variant: 'day' as const,
    metrics,
    violations: evaluateBudget(metrics),
    deviceClass: 'android-mid' as const,
    capturedAt: '2026-10-04T10:00:00.000Z',
  };
}

describe('buildReport', () => {
  it('membentuk objek stabil dari input yang sama', () => {
    expect(buildReport(fixture())).toEqual(buildReport(fixture()));
    expect(JSON.stringify(buildReport(fixture()))).toBe(JSON.stringify(buildReport(fixture())));
  });

  it('mendukung tiga kelas device dan dua varian', () => {
    expect(DEVICE_CLASSES).toEqual(['android-low', 'android-mid', 'desktop']);
    expect(buildReport({ ...fixture(), deviceClass: 'android-low' }).deviceClass).toBe('android-low');
    expect(buildReport({ ...fixture(), variant: 'night' }).variant).toBe('night');
  });

  it('membawa tier, timestamp, dan verdict ke dalam report', () => {
    const report = buildReport(fixture());
    expect(report.tier).toBe('medium');
    expect(report.capturedAt).toBe('2026-10-04T10:00:00.000Z');
    expect(report.verdict === 'pass' || report.verdict === 'warn' || report.verdict === 'fail').toBe(true);
  });
});

describe('formatReportMarkdown', () => {
  it('menghasilkan string deterministik dengan judul dan verdict', () => {
    const md = formatReportMarkdown(buildReport(fixture()));
    expect(md).toBe(formatReportMarkdown(buildReport(fixture())));
    expect(md).toContain('# Benchmark');
    expect(md).toContain('medium');
  });
});

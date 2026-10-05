import { describe, expect, it } from 'vitest';
import { collectMetrics, createFrameTimer } from './renderMetrics';

/** Stub menyerupai WebGLRenderer.info — tidak butuh GPU. */
const info = {
  render: { calls: 85, triangles: 180_000 },
  memory: { geometries: 120, textures: 42 },
  programs: [{}, {}, {}, {}],
};

/** Stub menyerupai WebGLRenderer.capabilities. */
const caps = { isWebGL2: true, maxTextures: 16, precision: 'highp', maxTextureSize: 4096 };

describe('collectMetrics', () => {
  it('meneruskan draw calls, triangles, texture, dan program dari info', () => {
    const m = collectMetrics(info, caps, { frame: createFrameTimer().summary() });
    expect(m.calls).toBe(85);
    expect(m.triangles).toBe(180_000);
    expect(m.textures).toBe(42);
    expect(m.programs).toBe(4);
    expect(m.geometries).toBe(120);
    expect(m.webgl2).toBe(true);
  });

  it('memperkirakan memori texture, shadow map, dan jumlah pass', () => {
    const m = collectMetrics(info, caps, {
      textureSizes: [{ width: 256, height: 128, bytesPerPixel: 4 }],
      shadowMapSize: 1024,
      shadowCasters: 2,
      postProcessingPasses: 3,
      frameTimeCpuMs: 16.5,
    });
    expect(m.textureMemoryBytes).toBe(131_072);
    expect(m.shadowMemoryBytes).toBe(8_388_608);
    expect(m.postProcessingPasses).toBe(3);
    expect(m.cpuFrameTimeMs).toBe(16.5);
  });

  it('menurunkan fps dari rata-rata frame timer', () => {
    const t = createFrameTimer();
    t.push(20);
    t.push(20);
    const m = collectMetrics(info, caps, { frame: t.summary() });
    expect(m.fps).toBe(50);
    expect(m.frame.p95Ms).toBe(20);
  });

  it('input tanpa extra dan programs tidak menghasilkan NaN', () => {
    const m = collectMetrics({ render: { calls: Number.NaN, triangles: 0 }, memory: { geometries: 0, textures: 0 } }, { isWebGL2: false });
    expect(m.calls).toBe(0);
    expect(m.programs).toBe(0);
    expect(m.fps).toBe(0);
    expect(m.shadowMemoryBytes).toBe(0);
    expect(Object.values(m).every((v) => typeof v !== 'number' || Number.isFinite(v))).toBe(true);
  });
});

describe('createFrameTimer', () => {
  it('menghitung rata-rata dari sampel delta', () => {
    const timer = createFrameTimer();
    timer.push(10);
    timer.push(20);
    timer.push(30);
    expect(timer.summary().averageMs).toBe(20);
  });

  it('melaporkan worst dan p95 frame time', () => {
    const timer = createFrameTimer();
    for (let i = 1; i <= 100; i += 1) timer.push(i);
    const s = timer.summary();
    expect(s.worstMs).toBe(100);
    expect(s.p95Ms).toBe(95);
    expect(s.samples).toBe(100);
  });

  it('sampel kosong menghasilkan nol, bukan NaN', () => {
    const s = createFrameTimer().summary();
    expect(s).toEqual({ averageMs: 0, p95Ms: 0, worstMs: 0, samples: 0 });
  });

  it('hanya menyimpan sampel terakhir sesuai kapasitas', () => {
    const timer = createFrameTimer(3);
    timer.push(100);
    timer.push(10);
    timer.push(20);
    timer.push(30);
    expect(timer.summary()).toEqual({ averageMs: 20, p95Ms: 30, worstMs: 30, samples: 3 });
  });

  it('mengabaikan delta tidak valid', () => {
    const timer = createFrameTimer();
    timer.push(Number.NaN);
    timer.push(-5);
    timer.push(16);
    expect(timer.summary().samples).toBe(1);
    expect(timer.summary().averageMs).toBe(16);
  });

  it('reset mengosongkan sampel', () => {
    const timer = createFrameTimer();
    timer.push(16);
    timer.reset();
    expect(timer.summary().samples).toBe(0);
  });
});

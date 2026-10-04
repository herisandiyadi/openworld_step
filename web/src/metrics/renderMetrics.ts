/** Ringkasan statistik frame time (ms) dari sampel delta. */
export interface FrameTimeSummary {
  averageMs: number;
  p95Ms: number;
  worstMs: number;
  samples: number;
}

export interface FrameTimer {
  push(deltaMs: number): void;
  summary(): FrameTimeSummary;
  reset(): void;
}

/** Subset struktural dari WebGLRenderer.info — cukup untuk stub di test. */
export interface RenderInfoLike {
  render: { calls: number; triangles: number };
  memory: { geometries: number; textures: number };
  programs?: readonly unknown[] | null;
}

/** Subset struktural dari WebGLRenderer.capabilities. */
export interface CapabilitiesLike {
  isWebGL2: boolean;
  maxTextureSize?: number;
}

export interface TextureSizeLike {
  width: number;
  height: number;
  /** Default 4 (RGBA8). Texture terkompresi bisa < 1. */
  bytesPerPixel?: number;
}

/** Data tambahan yang tidak tersedia di gl.info. */
export interface MetricsExtra {
  frame?: FrameTimeSummary;
  frameTimeCpuMs?: number;
  textureSizes?: readonly TextureSizeLike[];
  shadowMapSize?: number;
  /** Jumlah light yang cast shadow (masing-masing punya satu shadow map). */
  shadowCasters?: number;
  postProcessingPasses?: number;
}

export interface RenderMetrics {
  fps: number;
  cpuFrameTimeMs: number;
  frame: FrameTimeSummary;
  calls: number;
  triangles: number;
  programs: number;
  geometries: number;
  textures: number;
  textureMemoryBytes: number;
  shadowCasters: number;
  shadowMapSize: number;
  shadowMemoryBytes: number;
  postProcessingPasses: number;
  webgl2: boolean;
}

const EMPTY_FRAME: FrameTimeSummary = { averageMs: 0, p95Ms: 0, worstMs: 0, samples: 0 };

/** Angka non-finite/negatif dianggap 0 supaya laporan tidak berisi NaN. */
function safe(n: number | undefined): number {
  return n !== undefined && Number.isFinite(n) && n > 0 ? n : 0;
}

/** Perkiraan kasar: width × height × bpp (tanpa mipmap). */
export function estimateTextureBytes(sizes: readonly TextureSizeLike[]): number {
  return sizes.reduce((sum, t) => sum + safe(t.width) * safe(t.height) * (t.bytesPerPixel ?? 4), 0);
}

/** Shadow map depth RGBA8/depth24+stencil ≈ 4 byte per texel, satu per caster. */
export function estimateShadowBytes(mapSize: number, casters: number): number {
  return safe(mapSize) * safe(mapSize) * 4 * Math.floor(safe(casters));
}

/** Gabungkan info/capabilities renderer + data tambahan menjadi satu snapshot murni. */
export function collectMetrics(info: RenderInfoLike, caps: CapabilitiesLike, extra: MetricsExtra = {}): RenderMetrics {
  const frame = extra.frame ?? EMPTY_FRAME;
  const cpuFrameTimeMs = safe(extra.frameTimeCpuMs ?? frame.averageMs);
  const shadowCasters = Math.floor(safe(extra.shadowCasters));
  const shadowMapSize = safe(extra.shadowMapSize);
  return {
    fps: cpuFrameTimeMs > 0 ? 1000 / cpuFrameTimeMs : 0,
    cpuFrameTimeMs,
    frame,
    calls: safe(info.render.calls),
    triangles: safe(info.render.triangles),
    programs: info.programs?.length ?? 0,
    geometries: safe(info.memory.geometries),
    textures: safe(info.memory.textures),
    textureMemoryBytes: estimateTextureBytes(extra.textureSizes ?? []),
    shadowCasters,
    shadowMapSize,
    shadowMemoryBytes: estimateShadowBytes(shadowMapSize, shadowCasters),
    postProcessingPasses: Math.floor(safe(extra.postProcessingPasses)),
    webgl2: caps.isWebGL2,
  };
}

/** Kapasitas default: sekitar 10 detik pada 60 FPS. */
export const DEFAULT_FRAME_CAPACITY = 600;

/**
 * Ring buffer sampel frame time. Hanya menerima angka finite positif
 * supaya satu delta rusak tidak mencemari rata-rata.
 */
export function createFrameTimer(capacity: number = DEFAULT_FRAME_CAPACITY): FrameTimer {
  const limit = Math.max(1, Math.floor(capacity));
  let samples: number[] = [];
  return {
    push(deltaMs) {
      if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
      samples.push(deltaMs);
      if (samples.length > limit) samples = samples.slice(samples.length - limit);
    },
    reset() {
      samples = [];
    },
    summary() {
      if (samples.length === 0) return { averageMs: 0, p95Ms: 0, worstMs: 0, samples: 0 };
      const sorted = [...samples].sort((a, b) => a - b);
      const total = samples.reduce((a, b) => a + b, 0);
      const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
      return {
        averageMs: total / samples.length,
        p95Ms: sorted[idx] ?? 0,
        worstMs: sorted[sorted.length - 1] ?? 0,
        samples: samples.length,
      };
    },
  };
}

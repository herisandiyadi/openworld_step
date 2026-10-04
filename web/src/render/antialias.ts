/**
 * Pemilihan strategi anti-aliasing — VISUAL_UPGRADE_TASKS §2 "Anti-aliasing".
 * Aturan keras: MSAA dan FXAA penuh TIDAK BOLEH aktif bersamaan (cost ganda).
 * Fungsi murni, tanpa three/WebGL, supaya bisa diuji dengan capability stub.
 */
import type { QualityTier } from '../state/qualityTiers';
import { QUALITY_TIERS } from '../state/qualityTiers';
import type { RendererCapabilities } from './capabilities';

export interface AntialiasPlan {
  /** 0 = MSAA mati. Nilai >1 dipasang ke WebGLRenderTarget.samples / renderer antialias. */
  msaaSamples: number;
  /** FXAA sebagai fallback; dilipat ke pass color grade bila tier punya pass itu. */
  fxaa: boolean;
}

/** samples 1 secara efektif sama dengan tanpa MSAA, jadi butuh minimal 2. */
const MIN_USEFUL_SAMPLES = 2;

export function chooseAntialias(tier: QualityTier, caps: RendererCapabilities): AntialiasPlan {
  const requested = QUALITY_TIERS[tier].msaaSamples;
  const deviceMax = caps.webgl2 && caps.msaaSupport ? caps.maxSamples : 0;
  const samples = Math.min(requested, deviceMax);

  // MSAA menang bila benar-benar tersedia; kalau tidak, FXAA menambal.
  if (samples >= MIN_USEFUL_SAMPLES) return { msaaSamples: samples, fxaa: false };
  return { msaaSamples: 0, fxaa: true };
}

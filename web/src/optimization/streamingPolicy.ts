/**
 * Kebijakan streaming chunk per quality tier — VISUAL_UPGRADE_TASKS §6 P0.
 * Modul murni (tanpa three) supaya bisa diuji di environment node.
 *
 * Radius memakai jarak Chebyshev dalam satuan chunk (sama dengan world/streaming.ts).
 * Budget acuan (metrics/budget.ts): <120 draw call. Tiap chunk = terrain + 1 InstancedMesh
 * bangunan (2 draw) + beberapa InstancedMesh props, jadi radius load 2 (25 chunk) sudah
 * ~50 draw sebelum frustum culling; radius 3 (49 chunk) terlalu mepet budget di mobile.
 */
import type { QualityTier } from '../state/qualityTiers';
import { CHUNK_SIZE } from '../world/worldSpec';

export interface StreamingPolicy {
  tier: QualityTier;
  /**
   * Ukuran chunk efektif (m). Data chunk dibake offline dengan satu ukuran, jadi semua tier
   * memakai CHUNK_SIZE; perbedaan tier diatur lewat radius, bukan memecah ulang data.
   */
  chunkSize: number;
  /** Chunk dalam radius ini dari chunk player di-load. */
  loadRadius: number;
  /** Chunk di LUAR radius ini di-unload. Selisih dengan loadRadius = hysteresis anti-thrashing. */
  unloadRadius: number;
  /** Props (lampu, pohon, bench, ...) hanya digambar dalam radius ini. */
  propRadius: number;
  /** Berapa chunk ke depan (arah gerak) yang boleh di-prefetch melewati loadRadius. */
  prefetchAhead: number;
  /** Detik ke depan untuk memprediksi posisi player saat mengurutkan prefetch. */
  lookaheadSeconds: number;
  /** Request worker yang boleh berjalan bersamaan. */
  maxInFlight: number;
}

const POLICIES: Readonly<Record<QualityTier, Readonly<StreamingPolicy>>> = {
  low: {
    tier: 'low',
    chunkSize: CHUNK_SIZE,
    loadRadius: 1,
    unloadRadius: 2,
    propRadius: 1,
    prefetchAhead: 1,
    lookaheadSeconds: 1.5,
    maxInFlight: 1,
  },
  // Medium = perilaku lama (LOAD_RADIUS 2, UNLOAD_RADIUS 3, PROP_RADIUS 1, 2 in-flight).
  medium: {
    tier: 'medium',
    chunkSize: CHUNK_SIZE,
    loadRadius: 2,
    unloadRadius: 3,
    propRadius: 1,
    prefetchAhead: 1,
    lookaheadSeconds: 2,
    maxInFlight: 2,
  },
  high: {
    tier: 'high',
    chunkSize: CHUNK_SIZE,
    loadRadius: 2,
    unloadRadius: 3,
    propRadius: 1,
    prefetchAhead: 1,
    lookaheadSeconds: 2.5,
    maxInFlight: 3,
  },
};

export function streamingPolicyFor(tier: QualityTier): StreamingPolicy {
  return { ...POLICIES[tier] };
}

/** Jarak (chunk, Chebyshev) dari chunk player; unload hanya bila lewat unloadRadius. */
export const shouldUnload = (distance: number, policy: Pick<StreamingPolicy, 'unloadRadius'>): boolean =>
  distance > policy.unloadRadius;

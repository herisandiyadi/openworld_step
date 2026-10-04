/**
 * Aktivasi entitas per chunk dan throttling update — VISUAL_UPGRADE_TASKS §6
 * ("Pastikan NPC, kendaraan, dan lampu hanya aktif di chunk relevan",
 *  "Batasi update AI/animation pada objek jauh").
 *
 * Murni: hanya key chunk dan angka, tanpa three/GPU.
 */
import type { QualityTier } from '../state/qualityTiers';
import { CHUNK_SIZE } from '../world/worldSpec';
import type { StreamingPolicy } from './streamingPolicy';

export interface ChunkCoord {
  cx: number;
  cz: number;
}

export interface Activation {
  /** Chunk yang masih mensimulasikan sesuatu (agen atau lampu). */
  active: string[];
  /** Chunk termuat yang seluruh entitasnya dimatikan. */
  passive: string[];
  /** Chunk tempat NPC dan kendaraan disimulasikan (radius paling ketat). */
  agents: string[];
  /** Chunk tempat lampu jalan/emissive dinyalakan (radius lebih luas, superset agents). */
  lights: string[];
}

/** Radius agen = propRadius (tempat props benar-benar digambar); lampu satu cincin lebih luas. */
const agentRadiusOf = (policy: StreamingPolicy): number => policy.propRadius;
const lightRadiusOf = (policy: StreamingPolicy): number => Math.min(policy.propRadius + 1, policy.loadRadius);

/** Jarak Chebyshev dari key 'cx_cz' ke chunk player; null bila key tidak valid. */
function keyDistance(key: string, center: ChunkCoord): number | null {
  const parts = key.split('_');
  if (parts.length !== 2) return null;
  const cx = Number(parts[0]);
  const cz = Number(parts[1]);
  if (!Number.isFinite(cx) || !Number.isFinite(cz)) return null;
  return Math.max(Math.abs(cx - center.cx), Math.abs(cz - center.cz));
}

/**
 * Pisahkan chunk termuat menjadi aktif/pasif. Urutan input dipertahankan supaya hasil
 * deterministik dan enak dibandingkan di test. Key tidak valid dianggap pasif, bukan error.
 */
export function activationFor(playerChunk: ChunkCoord, loadedChunks: Iterable<string>, policy: StreamingPolicy): Activation {
  const agentRadius = agentRadiusOf(policy);
  const lightRadius = lightRadiusOf(policy);
  const result: Activation = { active: [], passive: [], agents: [], lights: [] };
  for (const key of loadedChunks) {
    const distance = keyDistance(key, playerChunk);
    if (distance === null || distance > lightRadius) {
      result.passive.push(key);
      continue;
    }
    result.active.push(key);
    result.lights.push(key);
    if (distance <= agentRadius) result.agents.push(key);
  }
  return result;
}

/** Jarak (m) di mana rate update mulai diturunkan, per tier. */
const FULL_RATE_DISTANCE: Readonly<Record<QualityTier, number>> = {
  low: CHUNK_SIZE / 4,
  medium: (CHUNK_SIZE * 3) / 8,
  high: CHUNK_SIZE / 2,
};

/** Tangga rate: 1 (tiap frame), 1/2, 1/4, 1/8 — pembagi pangkat dua supaya stagger rapi. */
const RATES = [1, 1 / 2, 1 / 4, 1 / 8] as const;
const FARTHEST_RATE = RATES[RATES.length - 1] as number;

/**
 * Proporsi frame yang dipakai untuk meng-update sebuah objek pada jarak tertentu.
 * Selalu di (0, 1]; jarak tidak valid diperlakukan sebagai paling jauh (rate terkecil).
 */
export function updateRateFor(distance: number, tier: QualityTier): number {
  if (!Number.isFinite(distance)) return FARTHEST_RATE;
  const full = FULL_RATE_DISTANCE[tier];
  const steps = Math.floor(Math.max(distance, 0) / full);
  return RATES[Math.min(steps, RATES.length - 1)] ?? FARTHEST_RATE;
}

/**
 * Apakah objek pada slot `slot` perlu di-update di frame `frame` dengan rate ini.
 * `slot` (mis. index agen) menggeser fase supaya beban tersebar antar frame.
 */
export function shouldTickNow(frame: number, slot: number, rate: number): boolean {
  if (!(rate > 0)) return false;
  const period = Math.max(1, Math.round(1 / rate));
  if (period === 1) return true;
  return (((frame - slot) % period) + period) % period === 0;
}

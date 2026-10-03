/**
 * Kepadatan agen ambient per kawasan dan jam (NEXT_FEATURES 3.1). Murni, tanpa three.js.
 * `t` adalah `dayClock.t` dari game/runtime.ts (0 = tengah malam, 0.5 = tengah hari).
 */
import type { DistrictId } from '../world/worldSpec';

export type AgentKind = 'car' | 'moto' | 'pedestrian' | 'cat' | 'dog' | 'pigeon';

/** Jumlah agen maksimum per chunk (siang hari). */
export const DENSITY: Record<DistrictId, Record<AgentKind, number>> = {
  downtown: { car: 8, moto: 6, pedestrian: 14, cat: 1, dog: 0, pigeon: 10 },
  residential: { car: 2, moto: 3, pedestrian: 6, cat: 4, dog: 3, pigeon: 2 },
  industrial: { car: 6, moto: 8, pedestrian: 2, cat: 1, dog: 1, pigeon: 1 },
};

/** Faktor malam: pejalan kaki dan kendaraan turun 60%. */
export const NIGHT_FACTOR = 0.4;
const NIGHT_KINDS: ReadonlySet<AgentKind> = new Set(['car', 'moto', 'pedestrian']);

/** Jam 0-23 dari jam dalam game; dibulatkan ke menit dulu supaya t = 22/24 tidak jatuh ke jam 21 karena galat float. */
export const hourOf = (t: number): number => Math.floor(Math.round((((t % 1) + 1) % 1) * 1440) / 60) % 24;
/** Malam = 22.00-05.00. */
export const isNight = (t: number): boolean => {
  const hour = hourOf(t);
  return hour >= 22 || hour < 5;
};

export function densityAt(district: DistrictId, kind: AgentKind, t: number): number {
  const base = DENSITY[district][kind];
  return isNight(t) && NIGHT_KINDS.has(kind) ? Math.round(base * NIGHT_FACTOR) : base;
}

import type { BusStop } from '../world/worldSpec';

export interface BusDestination {
  label: string;
  stop: BusStop;
}

/** Named areas served by the bus; each maps to the stop nearest its centre. North is -Z. */
const AREAS = [
  { label: 'Pusat Kota', x: 0, z: 0 },
  { label: 'Perumahan Utara', x: -40, z: -210 },
  { label: 'Perumahan Barat', x: -210, z: 0 },
  { label: 'Perumahan Selatan', x: -40, z: 210 },
  { label: 'Kawasan Industri', x: 195, z: 0 },
] as const;

export function busDestinations(stops: readonly BusStop[], currentId: string | null): BusDestination[] {
  const result: BusDestination[] = [];
  const used = new Set<string>(currentId ? [currentId] : []);
  for (const area of AREAS) {
    let best: BusStop | null = null;
    let bestDistance = Infinity;
    for (const stop of stops) {
      if (used.has(stop.id)) continue;
      const distance = Math.hypot(stop.x - area.x, stop.z - area.z);
      if (distance < bestDistance) {
        best = stop;
        bestDistance = distance;
      }
    }
    if (best) {
      used.add(best.id);
      result.push({ label: area.label, stop: best });
    }
  }
  return result;
}
export const WINDOW_LIT_RATIO = 0.42;
export function windowCellLit(x:number,y:number):boolean { const n=Math.sin(x*12.9898+y*78.233)*43758.5453; return n-Math.floor(n)<WINDOW_LIT_RATIO; }

/** Emissive multiplier: bright at night, absent by day; input is normalized daylight. */
export function windowEmissionAt(daylight: number): number {
  const normalized = Number.isFinite(daylight) ? Math.min(1, Math.max(0, daylight)) : 1;
  return (1 - normalized) * 0.85;
}

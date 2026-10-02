const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** Real seconds for one full in-game day. */
export const DAY_SECONDS = 480;

/** t in [0, 1): 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset. */
export function daylightAt(t: number): { daylight: number; dusk: number } {
  const elevation = Math.sin(2 * Math.PI * (t - 0.25));
  return {
    daylight: smoothstep(-0.12, 0.3, elevation),
    dusk: Math.max(0, 1 - Math.abs(elevation) / 0.25),
  };
}

/** HH:MM in 10-minute steps (keeps HUD re-renders rare). */
export function clockLabel(t: number): string {
  const minutes = Math.floor((((t % 1) + 1) % 1) * 144) * 10;
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
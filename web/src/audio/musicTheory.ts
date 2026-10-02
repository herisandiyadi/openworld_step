/** Pure helpers for the procedural music and motion sounds (unit-tested, no Web Audio here). */

export const midiToFreq = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

/** I - vi - IV - V in C major (C, Am, F, G), two bars per chord. */
export const PROGRESSION: readonly (readonly number[])[] = [
  [60, 64, 67],
  [57, 60, 64],
  [53, 57, 60],
  [55, 59, 62],
];
const FALLBACK_CHORD: readonly number[] = [60, 64, 67];
/** C major pentatonic, one octave above the pads. */
export const PENTATONIC: readonly number[] = [72, 74, 76, 79, 81, 84];

export function chordForBar(bar: number): readonly number[] {
  const index = Math.floor(bar / 2) % PROGRESSION.length;
  return PROGRESSION[(index + PROGRESSION.length) % PROGRESSION.length] ?? FALLBACK_CHORD;
}

/** Mostly chord tones (an octave up), sometimes a pentatonic passing note. `pick`/`choice` are in [0, 1). */
export function melodyNote(chord: readonly number[], pick: number, choice: number): number {
  if (choice < 0.55 && chord.length > 0) return (chord[Math.floor(pick * chord.length) % chord.length] ?? 60) + 12;
  return PENTATONIC[Math.floor(pick * PENTATONIC.length) % PENTATONIC.length] ?? 72;
}

/** Slower at night, livelier by day (daylight in [0, 1]). */
export const musicTempo = (daylight: number): number => 56 + 16 * daylight;

/** Chance of a melody note on a beat; off-beats are sparser and nights are quieter. */
export const melodyChance = (daylight: number, beatInBar: number): number =>
  (0.15 + 0.35 * daylight) * (beatInBar % 2 === 1 ? 0.6 : 1);

const ENGINE = {
  moto: { idle: 55, range: 120, maxSpeed: 15 },
  car: { idle: 38, range: 70, maxSpeed: 18 },
} as const;
const GEARS = 3;

/** Engine tone (Hz): rises through each of 3 gears, drops a little on every shift. */
export function enginePitch(speed: number, kind: 'moto' | 'car'): number {
  const spec = ENGINE[kind];
  const ratio = Math.min(1, Math.max(0, speed / spec.maxSpeed));
  const gear = Math.min(GEARS - 1, Math.floor(ratio * GEARS));
  const within = ratio * GEARS - gear;
  return spec.idle + within * spec.range + gear * spec.range * 0.25;
}

/** Metres between footsteps: short steps when walking slowly, long strides when running. */
export const strideLength = (speed: number): number => Math.min(1.8, Math.max(0.9, 0.8 + speed * 0.2));
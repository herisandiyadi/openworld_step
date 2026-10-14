/**
 * F3 haptics feedback (docs/FISHING.md 3.1): phone vibration on the bite and
 * short pulses when the fish enters/leaves the green zone. Uses Capacitor
 * Haptics on native platforms and falls back to navigator.vibrate on the web
 * (and to a no-op where vibration is not allowed).
 */
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

export type FishingVibrator = (durationMs: number) => void;

/** Durations at or above this are salient events (bite, catch); shorter are pull ticks. */
const SALIENT_MS = 40;
/** Rapid pull ticks fire at most once per window so a 20 Hz frame loop cannot spam the motor. */
const LIGHT_WINDOW_MS = 50;

export function createFishingVibrator(now: () => number = Date.now): FishingVibrator {
  if (!Capacitor.isNativePlatform()) {
    return (durationMs) => {
      try {
        navigator.vibrate?.(durationMs);
      } catch {
        // Vibration denied or unsupported: the game stays fully playable.
      }
    };
  }
  let lastLightAt = Number.NEGATIVE_INFINITY;
  return (durationMs) => {
    const style = durationMs >= SALIENT_MS ? ImpactStyle.Medium : ImpactStyle.Light;
    if (style === ImpactStyle.Light) {
      const at = now();
      if (at - lastLightAt < LIGHT_WINDOW_MS) return;
      lastLightAt = at;
    }
    Haptics.impact({ style }).catch(() => undefined);
  };
}

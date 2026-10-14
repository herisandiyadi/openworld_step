import { beforeEach, describe, expect, it, vi } from 'vitest';

const impact = vi.fn(() => Promise.resolve());
const isNativePlatform = vi.fn(() => true);
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform } }));
vi.mock('@capacitor/haptics', () => ({
  Haptics: { impact },
  ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM' },
}));

const { createFishingVibrator } = await import('./fishingHaptics');

describe('fishing haptics', () => {
  beforeEach(() => {
    impact.mockClear();
    isNativePlatform.mockReturnValue(true);
  });

  it('uses Capacitor impact styles for bite/catch and pull feedback', () => {
    const vibrate = createFishingVibrator(() => 1000);

    vibrate(80);
    vibrate(10);

    expect(impact).toHaveBeenNthCalledWith(1, { style: 'MEDIUM' });
    expect(impact).toHaveBeenNthCalledWith(2, { style: 'LIGHT' });
  });

  it('throttles rapid pull pulses', () => {
    let now = 1000;
    const vibrate = createFishingVibrator(() => now);

    vibrate(10);
    now += 20;
    vibrate(10);
    now += 80;
    vibrate(10);

    expect(impact).toHaveBeenCalledTimes(2);
  });

  it('falls back to navigator.vibrate on the web', () => {
    isNativePlatform.mockReturnValue(false);
    const webVibrate = vi.fn(() => true);
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { vibrate: webVibrate } });

    createFishingVibrator(() => 1000)(80);

    expect(webVibrate).toHaveBeenCalledWith(80);
    expect(impact).not.toHaveBeenCalled();
  });
});

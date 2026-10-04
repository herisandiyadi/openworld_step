import { describe, expect, it } from 'vitest';
import { MIN_TOUCH_TARGET_DP, controlLayout, safeAreaPadding, touchTargetPx } from './mobileLayout';

describe('mobile readability policy', () => {
  it('keeps every touch target at least 48dp', () => {
    expect(MIN_TOUCH_TARGET_DP).toBe(48);
    expect(touchTargetPx(1)).toBe(48);
    expect(touchTargetPx(2)).toBe(96);
    expect(touchTargetPx(0)).toBe(48);
  });

  it('adds HUD padding on top of the notch/safe-area insets', () => {
    expect(safeAreaPadding({ top: 44, right: 0, bottom: 34, left: 0 })).toEqual({ top: 56, right: 12, bottom: 46, left: 12 });
  });

  it('moves controls to the sides in landscape and stacks them in portrait', () => {
    const landscape = controlLayout({ width: 900, height: 420 });
    const portrait = controlLayout({ width: 420, height: 900 });
    expect(landscape.orientation).toBe('landscape');
    expect(portrait.orientation).toBe('portrait');
    expect(landscape.joystickSize).toBeLessThanOrEqual(portrait.joystickSize);
    expect(landscape.joystickSize).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_DP * 2);
    expect(portrait.actionColumns).toBe(1);
    expect(landscape.actionColumns).toBeGreaterThan(1);
  });

  it('never shrinks a control below the minimum target on tiny landscape viewports', () => {
    const tiny = controlLayout({ width: 568, height: 320 });
    expect(tiny.buttonSize).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_DP);
  });
});

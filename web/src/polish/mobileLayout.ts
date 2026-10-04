export const MIN_TOUCH_TARGET_DP = 48;
export interface Insets { top: number; right: number; bottom: number; left: number }
export interface Viewport { width: number; height: number }
export interface ControlLayout { orientation: 'portrait' | 'landscape'; joystickSize: number; buttonSize: number; actionColumns: number }
export function touchTargetPx(devicePixelRatio: number): number {
  return Math.max(MIN_TOUCH_TARGET_DP, MIN_TOUCH_TARGET_DP * Math.max(0, devicePixelRatio));
}
export function safeAreaPadding(insets: Insets): Insets {
  return { top: insets.top + 12, right: insets.right + 12, bottom: insets.bottom + 12, left: insets.left + 12 };
}
export function controlLayout(viewport: Viewport): ControlLayout {
  const orientation = viewport.width >= viewport.height ? 'landscape' : 'portrait';
  const buttonSize = Math.max(MIN_TOUCH_TARGET_DP, Math.round(Math.min(viewport.width, viewport.height) * 0.14));
  const joystickSize = Math.max(MIN_TOUCH_TARGET_DP * 2, Math.round(Math.min(viewport.width, viewport.height) * (orientation === 'landscape' ? 0.3 : 0.34)));
  return { orientation, joystickSize, buttonSize, actionColumns: orientation === 'landscape' ? 2 : 1 };
}

import { useEffect } from 'react';
import { keyboardInput } from './runtime';
import { askNearby, jump, openBus, toggleVehicle } from './actions';

const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const UP = ['KeyW', 'ArrowUp'];
const DOWN = ['KeyS', 'ArrowDown'];

/**
 * Desktop fallback for development: WASD / arrow keys feed the same input vector as the joystick
 * (dirotasi ke ruang kamera di PlayerController, sama seperti joystick).
 */
export function useKeyboardInput(): void {
  useEffect(() => {
    const pressed = new Set<string>();
    const any = (codes: string[]) => codes.some((code) => pressed.has(code));

    const update = () => {
      const x = (any(RIGHT) ? 1 : 0) - (any(LEFT) ? 1 : 0);
      const z = (any(DOWN) ? 1 : 0) - (any(UP) ? 1 : 0);
      const length = Math.hypot(x, z) || 1;
      keyboardInput.x = x / length;
      keyboardInput.z = z / length;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (!event.repeat) {
        if (event.code === 'Space') jump();
        if (event.code === 'KeyE') toggleVehicle();
        if (event.code === 'KeyQ') askNearby();
        if (event.code === 'KeyB') openBus();
      }
      pressed.add(event.code);
      update();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      pressed.delete(event.code);
      update();
    };
    const onBlur = () => {
      pressed.clear();
      update();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      onBlur();
    };
  }, []);
}
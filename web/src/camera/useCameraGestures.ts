import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { applyDrag, applyZoom, cameraState } from './followCamera';

/** Radian per piksel geseran. */
const YAW_PER_PX = 0.006;
const PITCH_PER_PX = 0.004;
const WHEEL_STEP = 0.0012;

/**
 * Geser di separuh layar kanan untuk memutar kamera, pinch untuk zoom; di desktop drag
 * mouse dan scroll. Tiap pointer dilacak sendiri (multi-touch), jadi joystick dan tombol
 * aksi di HUD tetap bisa dipakai bersamaan: event di tombol tidak sampai ke canvas.
 */
export function useCameraGestures(): void {
  const element = useThree((state) => state.gl.domElement);

  useEffect(() => {
    const active = new Map<number, { x: number; y: number }>();
    let pinchDistance = 0;
    const spread = (): number => {
      const [a, b] = [...active.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };

    const onPointerDown = (event: PointerEvent) => {
      // Sentuhan di separuh kiri disisakan untuk joystick dan tap-to-move.
      if (event.pointerType === 'touch' && active.size === 0 && event.clientX < element.clientWidth / 2) return;
      active.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (active.size === 2) pinchDistance = spread();
    };

    const onPointerMove = (event: PointerEvent) => {
      const previous = active.get(event.pointerId);
      if (!previous) return;
      const dx = event.clientX - previous.x;
      const dy = event.clientY - previous.y;
      previous.x = event.clientX;
      previous.y = event.clientY;

      if (active.size >= 2) {
        const distance = spread();
        if (pinchDistance > 0 && distance > 0) applyZoom(cameraState, pinchDistance / distance);
        pinchDistance = distance;
        return;
      }
      applyDrag(cameraState, -dx * YAW_PER_PX, -dy * PITCH_PER_PX);
    };

    const release = (event: PointerEvent) => {
      if (!active.delete(event.pointerId)) return;
      pinchDistance = 0;
      if (active.size === 0) cameraState.dragging = false;
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      applyZoom(cameraState, 1 + event.deltaY * WHEEL_STEP);
    };

    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', release);
    element.addEventListener('pointercancel', release);
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', release);
      element.removeEventListener('pointercancel', release);
      element.removeEventListener('wheel', onWheel);
      active.clear();
      cameraState.dragging = false;
    };
  }, [element]);
}

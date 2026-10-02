import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { Plane, Raycaster, Vector2, Vector3 } from 'three';
import { followPath, resolveTarget } from './movement';
import { PLAYER_RADIUS, playerState, sceneRefs } from './runtime';
import { findPath } from '../world/navigation';
import { worldState } from '../world/worldState';

const TAP_MAX_MS = 350;
const TAP_MAX_PX = 12;

/** Converts quick taps on the canvas into navmesh click-to-move. Drags and long presses are ignored. */
export function TapToMove() {
  const camera = useThree((state) => state.camera);
  const element = useThree((state) => state.gl.domElement);

  useEffect(() => {
    const raycaster = new Raycaster();
    const ndc = new Vector2();
    const groundPlane = new Plane(new Vector3(0, 1, 0), 0);
    const hitPoint = new Vector3();
    const downs = new Map<number, { x: number; y: number; time: number }>();

    const onPointerDown = (event: PointerEvent) => {
      downs.set(event.pointerId, { x: event.clientX, y: event.clientY, time: performance.now() });
    };

    const onPointerUp = (event: PointerEvent) => {
      const down = downs.get(event.pointerId);
      downs.delete(event.pointerId);
      if (!down) return;
      const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      if (moved > TAP_MAX_PX || performance.now() - down.time > TAP_MAX_MS) return;

      const rect = element.getBoundingClientRect();
      ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);

      const hit = raycaster.intersectObjects(sceneRefs.pickables, false)[0];
      if (hit) hitPoint.copy(hit.point);
      else if (!raycaster.ray.intersectPlane(groundPlane, hitPoint)) return;

      const goal = resolveTarget({ x: hitPoint.x, z: hitPoint.z }, PLAYER_RADIUS, worldState.collision);
      // Navmesh path around buildings; straight line if the navmesh isn't loaded or has no path.
      followPath(playerState, findPath(playerState, goal) ?? [goal]);
    };

    const onPointerCancel = (event: PointerEvent) => downs.delete(event.pointerId);

    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointerup', onPointerUp);
    element.addEventListener('pointercancel', onPointerCancel);
    return () => {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerCancel);
    };
  }, [camera, element]);

  return null;
}
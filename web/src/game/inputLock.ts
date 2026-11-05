import type { Vec2 } from './movement';
import { keyboardInput } from './runtime';
import { filterFishingInput } from './fishingLock';

/** Shared raw-vector gate used before camera-relative walk and vehicle steering. */
export const filteredRawInput = (fishing: boolean, input: Vec2): Vec2 =>
  filterFishingInput(fishing, input);

/** Clear held keys when fishing starts; keyup remains harmless. */
export function keyboardVectorDuringFishing(fishing: boolean): void {
  if (!fishing) return;
  keyboardInput.x = 0;
  keyboardInput.z = 0;
}

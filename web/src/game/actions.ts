import { useGameStore } from '../state/gameStore';
import { markExplored } from './exploration';
import { MODE_RADIUS, jumpState, playerState } from './runtime';
import { audio } from '../audio/audioEngine';
import type { BusStop } from '../world/worldSpec';

const JUMP_SPEED = 6;

const blocked = () => {
  const state = useGameStore.getState();
  return state.paused || state.mapOpen || state.chatNpcId !== null || state.busMenuOpen || state.soakActive;
};

/** Shared by the HUD action buttons and the desktop keyboard shortcuts. */
export function jump(): void {
  if (blocked() || useGameStore.getState().mode === 'car') return;
  if (jumpState.y > 0 || jumpState.vy !== 0) return;
  jumpState.vy = JUMP_SPEED;
  audio.jump();
}

/** Gets on the nearby parked vehicle, or parks the current one and continues on foot. */
export function toggleVehicle(): void {
  if (blocked()) return;
  const state = useGameStore.getState();
  playerState.target = null;
  playerState.path = [];

  if (state.riding) {
    const { riding } = state;
    const heading = playerState.heading;
    state.dismount({ ...riding, x: playerState.x, z: playerState.z, yaw: heading });
    audio.dismount();
    // Step out to the side; collision resolves any overlap on the next frame.
    const side = MODE_RADIUS[riding.kind] + MODE_RADIUS.walk + 0.3;
    playerState.x += Math.cos(heading) * side;
    playerState.z -= Math.sin(heading) * side;
    return;
  }

  const vehicle = state.vehicles.find((item) => item.id === state.nearby.vehicleId);
  if (!vehicle) return;
  jumpState.y = 0;
  jumpState.vy = 0;
  playerState.x = vehicle.x;
  playerState.z = vehicle.z;
  playerState.heading = vehicle.yaw;
  state.mount(vehicle);
  audio.mount(vehicle.kind);
}

/** Opens the chat panel for the NPC next to the player. */
export function askNearby(): void {
  if (blocked()) return;
  const { nearby, setChatNpcId } = useGameStore.getState();
  if (!nearby.npcId) return;
  audio.click();
  setChatNpcId(nearby.npcId);
}

/** Opens the bus destination menu at a bus stop (on foot only). */
export function openBus(): void {
  if (blocked()) return;
  const state = useGameStore.getState();
  if (!state.nearby.busStopId || state.riding) return;
  audio.click();
  state.setBusMenuOpen(true);
}

/** Fast travel: the bus drops the player at the destination stop. */
export function travelTo(stop: BusStop): void {
  playerState.x = stop.x;
  playerState.z = stop.z;
  playerState.heading = 0;
  playerState.target = null;
  playerState.path = [];
  jumpState.y = 0;
  jumpState.vy = 0;
  markExplored(stop.x, stop.z);
  audio.bus();
  useGameStore.setState({ busMenuOpen: false, nearby: { npcId: null, vehicleId: null, busStopId: stop.id } });
}
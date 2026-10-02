import { useGameStore } from '../state/gameStore';
import { markExplored } from './exploration';
import { MODE_RADIUS, jumpState, playerState } from './runtime';
import { audio } from '../audio/audioEngine';
import type { BusStop } from '../world/worldSpec';
import { worldState } from '../world/worldState';
import { playerSeat, releaseSeat, reserveSeat, sitPose, standPosition } from './seating';

const PLAYER_ID = 'player';

const JUMP_SPEED = 6;

const blocked = () => {
  const state = useGameStore.getState();
  return state.paused || state.mapOpen || state.chatNpcId !== null || state.busMenuOpen || state.soakActive;
};

/** Shared by the HUD action buttons and the desktop keyboard shortcuts. */
export function jump(): void {
  if (blocked() || useGameStore.getState().mode === 'car') return;
  // Lompat saat duduk = berdiri.
  if (useGameStore.getState().seated) return standUp();
  if (jumpState.y > 0 || jumpState.vy !== 0) return;
  jumpState.vy = JUMP_SPEED;
  audio.jump();
}

/** Gets on the nearby parked vehicle, or parks the current one and continues on foot. */
export function toggleVehicle(): void {
  if (blocked() || useGameStore.getState().seated) return;
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

/** Duduk di kursi terdekat (nearby.seatId); posisi diinterpolasi 0.4 detik oleh PlayerController. */
export function sitDown(): void {
  if (blocked()) return;
  const state = useGameStore.getState();
  if (state.seated || state.mode !== 'walk' || jumpState.y > 0 || jumpState.vy !== 0) return;
  const seat = worldState.index?.seats.find((item) => item.id === state.nearby.seatId);
  if (!seat || !reserveSeat(seat.id, PLAYER_ID)) return;
  playerSeat.seat = seat;
  playerState.target = null;
  playerState.path = [];
  playerState.heading = sitPose(seat).heading;
  audio.sit();
  useGameStore.setState({ seated: true, nearby: { ...state.nearby, seatId: null } });
}

/** Berdiri di depan kursi (coba kiri/kanan kalau terhalang) dan lepas reservasinya. */
export function standUp(): void {
  const seat = playerSeat.seat;
  if (seat) {
    const spot = standPosition(seat, worldState.collision.boxes, MODE_RADIUS.walk);
    playerState.x = spot.x;
    playerState.z = spot.z;
    releaseSeat(seat.id, PLAYER_ID);
  }
  playerSeat.seat = null;
  if (!useGameStore.getState().seated) return;
  audio.stand();
  useGameStore.getState().setSeated(false);
}

/** Tombol Duduk/Berdiri dan shortcut keyboard. */
export function toggleSeat(): void {
  if (useGameStore.getState().seated) standUp();
  else sitDown();
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
  standUp();
  playerState.x = stop.x;
  playerState.z = stop.z;
  playerState.heading = 0;
  playerState.target = null;
  playerState.path = [];
  jumpState.y = 0;
  jumpState.vy = 0;
  markExplored(stop.x, stop.z);
  audio.bus();
  useGameStore.setState({ busMenuOpen: false, nearby: { npcId: null, vehicleId: null, busStopId: stop.id, seatId: null } });
}
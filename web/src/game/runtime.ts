import type { Object3D } from 'three';
import type { PlayerState, Vec2 } from './movement';
import type { MoveMode } from '../state/gameStore';

/** Mutable per-frame state shared by the render loop, input widgets, and minimap. */
export const playerState: PlayerState = { x: 0, z: 0, heading: 0, target: null, path: [], stuckTime: 0 };
export const joystickInput: Vec2 = { x: 0, z: 0 };
export const keyboardInput: Vec2 = { x: 0, z: 0 };

/** Smoothed ground speed (m/s); drives locomotion clip choice and wheel spin. */
export const playerMotion = { speed: 0 };
/** Normalised phase [0,1) of the hero's pedalling clip, read by the bicycle crank. */
export const animState = { bikePhase: 0 };

/** Streamed terrain + building meshes that tap-to-move raycasts against. */
export const sceneRefs: { pickables: Object3D[] } = { pickables: [] };

export const PLAYER_RADIUS = 0.4;

/** Movement speed in m/s per traversal mode. */
export const MODE_SPEED: Record<MoveMode, number> = {
  walk: 4.5,
  skate: 8,
  bike: 11,
  moto: 15,
  car: 18,
};

/** Collision radius per mode (a car is much wider than a person). */
export const MODE_RADIUS: Record<MoveMode, number> = {
  walk: PLAYER_RADIUS,
  skate: PLAYER_RADIUS,
  bike: 0.5,
  moto: 0.6,
  car: 1.1,
};

/** Time of day in [0, 1): 0 = midnight, 0.5 = noon. Advanced by game/DayNight.tsx, saved with the game. */
export const dayClock = { t: 0.32 };
/** Sun light multiplier [0, 1] written by DayNight, read by the player-centred shadow light. */
export const lighting = { sun: 1 };

/** Height above the ground (m) and vertical speed (m/s) of the current jump. */
export const jumpState = { y: 0, vy: 0 };

/** Distance at which an NPC can be asked (Tanya) and turns toward the player. */
export const TALK_DISTANCE = 4;
/** Extra reach (beyond the vehicle radius) for the Naik button. */
export const USE_DISTANCE = 1.8;
/** Reach of the Bus button around a bus stop's waiting spot. */
export const BUS_DISTANCE = 3.5;
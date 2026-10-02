import { Preferences } from '@capacitor/preferences';
import { clearExplored, decodeExplored, encodeExplored } from '../game/exploration';
import { dayClock, jumpState, playerState } from '../game/runtime';
import { INITIAL_VEHICLES, type ParkedVehicle } from '../game/vehicles';
import { NO_NEARBY, useGameStore } from './gameStore';

const SAVE_KEY = 'save_v1';
const SAVE_VERSION = 1;

/** Everything needed to resume: position, vehicles, quest progress, explored map, time of day. */
export interface SaveData {
  version: number;
  x: number;
  z: number;
  heading: number;
  riding: ParkedVehicle | null;
  vehicles: ParkedVehicle[];
  met: string[];
  explored: string;
  time: number;
}

export function captureSave(): SaveData {
  const state = useGameStore.getState();
  return {
    version: SAVE_VERSION,
    x: Math.round(playerState.x * 100) / 100,
    z: Math.round(playerState.z * 100) / 100,
    heading: Math.round(playerState.heading * 1000) / 1000,
    riding: state.riding,
    vehicles: state.vehicles,
    met: state.met,
    explored: encodeExplored(),
    time: Math.round(dayClock.t * 10000) / 10000,
  };
}

/** Returns null for missing or incompatible data instead of throwing. */
export function parseSave(text: string | null): SaveData | null {
  if (!text) return null;
  try {
    const data = JSON.parse(text) as Partial<SaveData>;
    if (data.version !== SAVE_VERSION || typeof data.x !== 'number' || typeof data.z !== 'number') return null;
    if (!Array.isArray(data.vehicles) || !Array.isArray(data.met)) return null;
    return {
      version: SAVE_VERSION,
      x: data.x,
      z: data.z,
      heading: typeof data.heading === 'number' ? data.heading : 0,
      riding: data.riding ?? null,
      vehicles: data.vehicles,
      met: data.met.filter((id): id is string => typeof id === 'string'),
      explored: typeof data.explored === 'string' ? data.explored : '',
      time: typeof data.time === 'number' ? data.time % 1 : 0.32,
    };
  } catch {
    return null;
  }
}

function resetRuntime(x: number, z: number, heading: number): void {
  playerState.x = x;
  playerState.z = z;
  playerState.heading = heading;
  playerState.target = null;
  playerState.path = [];
  playerState.stuckTime = 0;
  jumpState.y = 0;
  jumpState.vy = 0;
}

export function applySave(data: SaveData): void {
  resetRuntime(data.x, data.z, data.heading);
  decodeExplored(data.explored);
  dayClock.t = data.time;
  useGameStore.setState({
    mode: data.riding?.kind ?? 'walk',
    riding: data.riding,
    vehicles: data.vehicles,
    met: data.met,
    nearby: NO_NEARBY,
  });
}

export function resetGame(): void {
  resetRuntime(0, 0, 0);
  clearExplored();
  dayClock.t = 0.32;
  useGameStore.setState({ mode: 'walk', riding: null, vehicles: [...INITIAL_VEHICLES], met: [], nearby: NO_NEARBY });
}

export async function loadSave(): Promise<SaveData | null> {
  try {
    const { value } = await Preferences.get({ key: SAVE_KEY });
    return parseSave(value);
  } catch {
    return null;
  }
}

export async function writeSave(): Promise<void> {
  await Preferences.set({ key: SAVE_KEY, value: JSON.stringify(captureSave()) });
}

export async function deleteSave(): Promise<void> {
  await Preferences.remove({ key: SAVE_KEY });
}
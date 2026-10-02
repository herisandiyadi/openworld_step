import { Preferences } from '@capacitor/preferences';
import { create } from 'zustand';
import { type ChatMessage, HISTORY_TURNS } from '../ai/promptFacts';
import { clearExplored, decodeExplored, encodeExplored } from '../game/exploration';
import { dayClock, jumpState, playerState } from '../game/runtime';
import { clearSeatReservations, playerSeat } from '../game/seating';
import { INITIAL_VEHICLES, type ParkedVehicle } from '../game/vehicles';
import { NO_NEARBY, useGameStore } from './gameStore';

const SAVE_KEY = 'save_v1';
const SAVE_VERSION = 1;

/** Riwayat chat warga di save game: 10 giliran terakhir per warga, maks 30 warga (LRU). */
export const MAX_RESIDENT_CHATS = 30;
const MAX_MESSAGE_CHARS = 1000;

/** [id warga, pesan]; urutan = LRU, yang paling baru diajak ngobrol di akhir. */
export type ResidentChats = [string, ChatMessage[]][];

interface ResidentChatState {
  chats: ResidentChats;
  /** Id semua warga yang pernah diajak ngobrol (statistik HUD; tidak ikut LRU). */
  talked: string[];
}

/** Store kecil terpisah supaya HUD ikut ter-render saat statistik berubah. */
export const useResidentChats = create<ResidentChatState>()(() => ({ chats: [], talked: [] }));

/** Simpan riwayat satu warga: potong ke 10 giliran, pindah ke paling baru, buang yang tertua di atas 30. */
export function rememberChat(chats: ResidentChats, id: string, messages: readonly ChatMessage[]): ResidentChats {
  const next = chats.filter(([other]) => other !== id);
  next.push([id, messages.slice(-HISTORY_TURNS * 2)]);
  return next.slice(-MAX_RESIDENT_CHATS);
}

export function recordResidentChat(id: string, messages: readonly ChatMessage[]): void {
  useResidentChats.setState((state) => ({
    chats: rememberChat(state.chats, id, messages),
    talked: state.talked.includes(id) ? state.talked : [...state.talked, id],
  }));
}

export const residentHistory = (id: string): ChatMessage[] =>
  useResidentChats.getState().chats.find(([other]) => other === id)?.[1] ?? [];

const isMessage = (value: unknown): value is ChatMessage => {
  const message = value as Partial<ChatMessage> | null;
  return (message?.role === 'user' || message?.role === 'assistant') && typeof message.content === 'string';
};

/** Validasi data dari storage (batas kepercayaan): buang entri rusak, batasi panjang. */
function parseChats(value: unknown): ResidentChats {
  if (!Array.isArray(value)) return [];
  let out: ResidentChats = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !Array.isArray(entry[1])) continue;
    const messages = (entry[1] as unknown[]).filter(isMessage).map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));
    out = rememberChat(out, entry[0], messages);
  }
  return out;
}

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
  /** Opsional supaya save lama tetap terbaca. */
  chats?: ResidentChats;
  talked?: string[];
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
    chats: useResidentChats.getState().chats,
    talked: useResidentChats.getState().talked,
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
      chats: parseChats(data.chats),
      talked: Array.isArray(data.talked) ? [...new Set(data.talked.filter((id): id is string => typeof id === 'string'))].slice(0, 200) : [],
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
  // Posisi duduk tidak disimpan: saat load pemain selalu berdiri.
  playerSeat.seat = null;
  clearSeatReservations();
}

export function applySave(data: SaveData): void {
  resetRuntime(data.x, data.z, data.heading);
  decodeExplored(data.explored);
  dayClock.t = data.time;
  useResidentChats.setState({ chats: data.chats ?? [], talked: data.talked ?? [] });
  useGameStore.setState({
    mode: data.riding?.kind ?? 'walk',
    riding: data.riding,
    vehicles: data.vehicles,
    met: data.met,
    nearby: NO_NEARBY,
    seated: false,
  });
}

export function resetGame(): void {
  resetRuntime(0, 0, 0);
  clearExplored();
  dayClock.t = 0.32;
  useResidentChats.setState({ chats: [], talked: [] });
  useGameStore.setState({ mode: 'walk', riding: null, vehicles: [...INITIAL_VEHICLES], met: [], nearby: NO_NEARBY, seated: false });
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
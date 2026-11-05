import { Preferences } from '@capacitor/preferences';
import { create } from 'zustand';
import { type ChatMessage, HISTORY_TURNS } from '../ai/promptFacts';
import { clearExplored, decodeExplored, encodeExplored } from '../game/exploration';
import { dayClock, jumpState, playerState } from '../game/runtime';
import { clearSeatReservations, playerSeat } from '../game/seating';
import { INITIAL_VEHICLES, type ParkedVehicle } from '../game/vehicles';
import { NO_NEARBY, useGameStore } from './gameStore';
import { type QuestState } from '../quest/questEngine';
import { createInventory, type EquipSlot, type Inventory, type OwnedItem, type ItemCategory } from '../economy/inventory';
import { type DailyJobs } from '../economy/dailyJobs';
import { type Bag, type BagItem, type BagItemKind } from '../economy/bag';
import { type LedgerEntry } from '../economy/wallet';
import { useContentProgress } from './contentProgress';

const SAVE_KEY = 'save_v1';
export const SAVE_VERSION = 2;

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
  /** Content-progress fields (v2). */
  coins: number;
  ledger: LedgerEntry[];
  quests: QuestState[];
  inventory: Inventory;
  jobs: DailyJobs;
  bag: Bag;
  contentVersion: string;
  market: { dayIndex: number; salesBySpecies: Record<string, number> };
  bonusDate: string;
  disposeCoinsToday: number;
}

const emptyInventory = (): Inventory => createInventory();
const emptyJobs = (): DailyJobs => ({ date: '', completed: {} });
const emptyBag = (): Bag => ({ capacity: 8, trashStackSize: 5, items: [] });

const finiteNumber = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

const wholeNumber = (value: unknown, fallback: number, min = 0): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.floor(value));
};

function parseLedger(value: unknown): LedgerEntry[] {
  if (!Array.isArray(value)) return [];
  const out: LedgerEntry[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Partial<LedgerEntry>;
    if (typeof e.amount !== 'number' || typeof e.balance !== 'number') continue;
    out.push({
      id: typeof e.id === 'string' ? e.id : `tx-${out.length}`,
      amount: e.amount,
      balance: e.balance,
      reason: typeof e.reason === 'string' ? e.reason : '',
      timestamp: typeof e.timestamp === 'number' ? e.timestamp : 0,
    });
  }
  return out.slice(-100);
}

function parseQuests(value: unknown): QuestState[] {
  if (!Array.isArray(value)) return [];
  const out: QuestState[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const q = entry as Partial<QuestState>;
    if (typeof q.questId !== 'string') continue;
    if (q.status !== 'locked' && q.status !== 'active' && q.status !== 'completed') continue;
    out.push({
      questId: q.questId,
      status: q.status,
      step: wholeNumber(q.step, 0),
      progress: Array.isArray(q.progress)
        ? q.progress.map((p) => ({ current: wholeNumber(p?.current, 0), required: Math.max(1, wholeNumber(p?.required, 1, 1)) }))
        : [],
      completions: wholeNumber(q.completions, 0),
    });
  }
  return out;
}

function parseInventory(value: unknown): Inventory {
  if (typeof value !== 'object' || value === null) return emptyInventory();
  const inv = value as { owned?: unknown; equipped?: unknown };
  const owned: OwnedItem[] = [];
  if (Array.isArray(inv.owned)) {
    for (const entry of inv.owned) {
      if (typeof entry !== 'object' || entry === null) continue;
      const item = entry as Partial<OwnedItem>;
      if (typeof item.id !== 'string' || typeof item.category !== 'string') continue;
      owned.push({ id: item.id, category: item.category as ItemCategory, retired: item.retired === true });
    }
  }
  const equipped: Partial<Record<EquipSlot, string>> = {};
  if (typeof inv.equipped === 'object' && inv.equipped !== null) {
    for (const [slot, itemId] of Object.entries(inv.equipped as Record<string, unknown>)) {
      if (typeof itemId === 'string') equipped[slot as EquipSlot] = itemId;
    }
  }
  return { owned, equipped };
}

function parseJobs(value: unknown): DailyJobs {
  if (typeof value !== 'object' || value === null) return emptyJobs();
  const jobs = value as { date?: unknown; completed?: unknown };
  const completed: Record<string, number> = {};
  if (typeof jobs.completed === 'object' && jobs.completed !== null) {
    for (const [id, count] of Object.entries(jobs.completed as Record<string, unknown>)) {
      const n = wholeNumber(count, -1, -1);
      if (n >= 0) completed[id] = n;
    }
  }
  return { date: typeof jobs.date === 'string' ? jobs.date : '', completed };
}

function parseBag(value: unknown): Bag {
  if (typeof value !== 'object' || value === null) return emptyBag();
  const bag = value as { capacity?: unknown; trashStackSize?: unknown; items?: unknown };
  const items: BagItem[] = [];
  if (Array.isArray(bag.items)) {
    for (const entry of bag.items) {
      if (typeof entry !== 'object' || entry === null) continue;
      const item = entry as Partial<BagItem>;
      if (typeof item.id !== 'string' || typeof item.kind !== 'string') continue;
      items.push({
        id: item.id,
        kind: item.kind as BagItemKind,
        ...(typeof item.species === 'string' ? { species: item.species } : {}),
        ...(typeof item.weight === 'number' ? { weight: item.weight } : {}),
        ...(typeof item.trashType === 'string' ? { trashType: item.trashType } : {}),
        qty: wholeNumber(item.qty, 1, 1),
      });
    }
  }
  return { capacity: wholeNumber(bag.capacity, 8, 1), trashStackSize: wholeNumber(bag.trashStackSize, 5, 1), items };
}

/**
 * Chains the stored version forward to the current format.
 * v1 → v2 fills the content-progress fields with empty defaults and preserves
 * everything the v1 save held (position, vehicles, met, chats, explored, time).
 * Unknown/corrupt versions return null instead of throwing.
 */
export function migrateSave(data: unknown): SaveData | null {
  if (typeof data !== 'object' || data === null) return null;
  const raw = data as Record<string, unknown>;
  const version = raw.version;
  if (version !== 1 && version !== 2) return null;
  if (typeof raw.x !== 'number' || typeof raw.z !== 'number') return null;

  const base = {
    version: SAVE_VERSION,
    x: raw.x,
    z: raw.z,
    heading: finiteNumber(raw.heading, 0),
    riding: (raw.riding as ParkedVehicle | null) ?? null,
    vehicles: Array.isArray(raw.vehicles) ? (raw.vehicles as ParkedVehicle[]) : [],
    met: Array.isArray(raw.met) ? raw.met.filter((id): id is string => typeof id === 'string') : [],
    explored: typeof raw.explored === 'string' ? raw.explored : '',
    time: finiteNumber(raw.time, 0.32) % 1,
    chats: parseChats(raw.chats),
    talked: Array.isArray(raw.talked)
      ? [...new Set(raw.talked.filter((id): id is string => typeof id === 'string'))].slice(0, 200)
      : [],
  };

  if (version === 1) {
    return {
      ...base,
      coins: 0,
      ledger: [],
      quests: (() => {
        const met = Array.isArray(raw.met) ? raw.met.filter((id): id is string => typeof id === 'string') : [];
        const steps = ['npc_budi', 'npc_sari', 'npc_rina', 'npc_dewi', 'npc_joko'];
        if (met.length === 0) return [];
        const progress = steps.map((npc) => ({ current: met.includes(npc) ? 1 : 0, required: 1 }));
        const step = progress.findIndex((item) => item.current < item.required);
        return [{
          questId: 'q_kenalan',
          status: step < 0 ? 'completed' : 'active',
          step: step < 0 ? steps.length : step,
          progress,
          completions: 0,
        }];
      })(),
      inventory: emptyInventory(),
      jobs: emptyJobs(),
      bag: emptyBag(),
      contentVersion: '',
      market: { dayIndex: 0, salesBySpecies: {} },
      bonusDate: '',
      disposeCoinsToday: 0,
    };
  }

  return {
    ...base,
    coins: wholeNumber(raw.coins, 0),
    ledger: parseLedger(raw.ledger),
    quests: parseQuests(raw.quests),
    inventory: parseInventory(raw.inventory),
    jobs: parseJobs(raw.jobs),
    bag: parseBag(raw.bag),
    contentVersion: typeof raw.contentVersion === 'string' ? raw.contentVersion : '',
    market: typeof raw.market === 'object' && raw.market !== null && typeof (raw.market as any).dayIndex === 'number'
      ? { dayIndex: (raw.market as any).dayIndex, salesBySpecies: typeof (raw.market as any).salesBySpecies === 'object' ? (raw.market as any).salesBySpecies : {} }
      : { dayIndex: 0, salesBySpecies: {} },
    bonusDate: typeof raw.bonusDate === 'string' ? raw.bonusDate : '',
    disposeCoinsToday: wholeNumber(raw.disposeCoinsToday, 0),
  };
}

/** Returns null for missing or incompatible data instead of throwing. */
export function parseSave(text: string | null): SaveData | null {
  if (!text) return null;
  try {
    return migrateSave(JSON.parse(text));
  } catch {
    return null;
  }
}

export function captureSave(): SaveData {
  const state = useGameStore.getState();
  const content = useContentProgress.getState();
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
    coins: content.coins,
    ledger: [...content.ledger],
    quests: [...content.quests],
    inventory: content.inventory,
    jobs: content.jobs,
    bag: content.bag,
    contentVersion: content.contentVersion,
    market: { dayIndex: content.market.dayIndex, salesBySpecies: { ...content.market.salesBySpecies } },
    bonusDate: content.bonusDate,
    disposeCoinsToday: content.disposeCoinsToday,
  };
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
  useContentProgress.setState({
    coins: data.coins,
    ledger: [...data.ledger],
    quests: [...data.quests],
    inventory: data.inventory,
    jobs: data.jobs,
    bag: data.bag,
    contentVersion: data.contentVersion,
    market: data.market,
    bonusDate: data.bonusDate,
    disposeCoinsToday: data.disposeCoinsToday,
  });
}

export function resetGame(): void {
  resetRuntime(0, 0, 0);
  clearExplored();
  dayClock.t = 0.32;
  useResidentChats.setState({ chats: [], talked: [] });
  useGameStore.setState({ mode: 'walk', riding: null, vehicles: [...INITIAL_VEHICLES], met: [], nearby: NO_NEARBY, seated: false });
  useContentProgress.setState({
    coins: 0,
    ledger: [],
    quests: [],
    inventory: emptyInventory(),
    jobs: emptyJobs(),
    bag: emptyBag(),
    contentVersion: '',
    market: { dayIndex: 0, salesBySpecies: {} },
    bonusDate: '',
    disposeCoinsToday: 0,
  });
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

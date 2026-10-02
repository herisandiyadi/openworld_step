import { create } from 'zustand';
import type { DistrictId } from '../world/worldSpec';
import { INITIAL_VEHICLES, type ParkedVehicle, type VehicleKind } from '../game/vehicles';

/** 'walk' is the default; every other mode needs a parked vehicle next to the player. */
export type MoveMode = 'walk' | VehicleKind;
export type Quality = 'low' | 'medium' | 'high';
export type Screen = 'title' | 'settings' | 'profile' | 'game';

export interface RenderStats {
  fps: number;
  calls: number;
  triangles: number;
}

export interface StreamInfo {
  chunks: number;
  pending: number;
  /** Worst main-thread time (ms) spent applying one streamed chunk. */
  applyMs: number;
}

export interface QualityPreset {
  maxDpr: number;
  shadows: boolean;
}

export const QUALITY_PRESETS: Record<Quality, QualityPreset> = {
  low: { maxDpr: 1, shadows: false },
  medium: { maxDpr: 1.25, shadows: true },
  high: { maxDpr: 1.5, shadows: true },
};

export interface Nearby {
  npcId: string | null;
  vehicleId: string | null;
  busStopId: string | null;
}

interface GameState {
  /** Title menu and AI settings are shown before the 3D world is mounted. */
  screen: Screen;
  mode: MoveMode;
  /** Vehicle currently ridden (removed from `vehicles` while in use). */
  riding: ParkedVehicle | null;
  vehicles: ParkedVehicle[];
  /** Context targets for the action buttons, updated by game/Proximity.tsx. */
  nearby: Nearby;
  /** NPC whose chat panel is open (game loop paused). */
  chatNpcId: string | null;
  busMenuOpen: boolean;
  /** Quest "Kenalan dengan warga": NPC ids the player has talked to. */
  met: string[];
  /** In-game clock label (HH:MM), updated by DayNight. */
  clock: string;
  quality: Quality;
  paused: boolean;
  mapOpen: boolean;
  stats: RenderStats;
  stream: StreamInfo;
  worldReady: boolean;
  district: DistrictId | null;
  /** Automated map-crossing performance run (pause menu or ?soak). */
  soakActive: boolean;
  soakResult: string | null;
  setScreen: (screen: Screen) => void;
  mount: (vehicle: ParkedVehicle) => void;
  dismount: (parked: ParkedVehicle) => void;
  setNearby: (nearby: Nearby) => void;
  setChatNpcId: (id: string | null) => void;
  setBusMenuOpen: (open: boolean) => void;
  addMet: (npcId: string) => void;
  setClock: (clock: string) => void;
  setQuality: (quality: Quality) => void;
  setPaused: (paused: boolean) => void;
  setMapOpen: (open: boolean) => void;
  setStats: (stats: RenderStats) => void;
  setStream: (stream: StreamInfo) => void;
  setWorldReady: (ready: boolean) => void;
  setDistrict: (district: DistrictId | null) => void;
  setSoakActive: (active: boolean) => void;
  setSoakResult: (result: string | null) => void;
}

export const NO_NEARBY: Nearby = { npcId: null, vehicleId: null, busStopId: null };

/** UI-facing state only. Per-frame simulation state lives in game/runtime.ts to avoid React re-renders. */
export const useGameStore = create<GameState>()((set) => ({
  screen: 'title',
  mode: 'walk',
  riding: null,
  vehicles: [...INITIAL_VEHICLES],
  nearby: NO_NEARBY,
  chatNpcId: null,
  busMenuOpen: false,
  met: [],
  clock: '07:40',
  quality: 'medium',
  paused: false,
  mapOpen: false,
  stats: { fps: 0, calls: 0, triangles: 0 },
  stream: { chunks: 0, pending: 0, applyMs: 0 },
  worldReady: false,
  district: null,
  soakActive: false,
  soakResult: null,
  setScreen: (screen) => set({ screen }),
  mount: (vehicle) =>
    set((state) => ({
      mode: vehicle.kind,
      riding: vehicle,
      vehicles: state.vehicles.filter((item) => item.id !== vehicle.id),
      nearby: NO_NEARBY,
    })),
  dismount: (parked) => set((state) => ({ mode: 'walk', riding: null, vehicles: [...state.vehicles, parked] })),
  setNearby: (nearby) => set({ nearby }),
  setChatNpcId: (chatNpcId) => set({ chatNpcId }),
  setBusMenuOpen: (busMenuOpen) => set({ busMenuOpen }),
  addMet: (npcId) => set((state) => (state.met.includes(npcId) ? state : { met: [...state.met, npcId] })),
  setClock: (clock) => set({ clock }),
  setQuality: (quality) => set({ quality }),
  setPaused: (paused) => set({ paused }),
  setMapOpen: (mapOpen) => set({ mapOpen }),
  setStats: (stats) => set({ stats }),
  setStream: (stream) => set({ stream }),
  setWorldReady: (worldReady) => set({ worldReady }),
  setDistrict: (district) => set({ district }),
  setSoakActive: (soakActive) => set({ soakActive }),
  setSoakResult: (soakResult) => set({ soakResult }),
}));
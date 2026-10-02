/**
 * Preset "Keramaian kota" (TASKS D4), terpisah dari preset grafis `quality` di gameStore.
 * Nilainya langsung `GraphicsPreset` milik ambient/spawner.ts supaya pool agen mengikutinya.
 * Disimpan di Preferences dengan pola yang sama seperti audioSettings/ControlSettings.
 */
import { Preferences } from '@capacitor/preferences';
import { create } from 'zustand';
import type { GraphicsPreset } from '../ambient/spawner';

export const DENSITY_PRESETS: readonly GraphicsPreset[] = ['low', 'medium', 'high'];
/** Label UI (bahasa Indonesia) per preset. */
export const DENSITY_LABELS: Record<GraphicsPreset, string> = { low: 'Sepi', medium: 'Normal', high: 'Ramai' };

export interface GraphicsSettings {
  density: GraphicsPreset;
}

export const DEFAULT_GRAPHICS: GraphicsSettings = { density: 'medium' };
const STORAGE_KEY = 'graphics_settings_v1';

export function normalizeGraphics(value: Partial<GraphicsSettings> | null | undefined): GraphicsSettings {
  const density = value?.density;
  return { density: DENSITY_PRESETS.includes(density as GraphicsPreset) ? (density as GraphicsPreset) : DEFAULT_GRAPHICS.density };
}

interface GraphicsSettingsState {
  settings: GraphicsSettings;
  load: () => Promise<void>;
  update: (patch: Partial<GraphicsSettings>) => void;
}

export const useGraphicsSettings = create<GraphicsSettingsState>()((set, get) => ({
  settings: DEFAULT_GRAPHICS,
  load: async () => {
    try {
      const { value } = await Preferences.get({ key: STORAGE_KEY });
      if (value) set({ settings: normalizeGraphics(JSON.parse(value) as Partial<GraphicsSettings>) });
    } catch {
      // Tetap pakai default kalau storage tidak tersedia atau isinya rusak.
    }
  },
  update: (patch) => {
    const settings = normalizeGraphics({ ...get().settings, ...patch });
    set({ settings });
    Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(settings) }).catch((error: unknown) => console.error('[graphics] save', error));
  },
}));

// ponytail: AmbientLayer (wave 2) membaca `useGraphicsSettings.getState().settings.density` dan
// meneruskannya ke updateSpawns(..., preset, ...). Sambungan itu dibuat lead saat merge.
if (typeof window !== 'undefined') void useGraphicsSettings.getState().load();

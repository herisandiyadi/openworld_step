import { Preferences } from '@capacitor/preferences';
import { create } from 'zustand';

export interface AudioSettings {
  /** 0..1 */
  music: number;
  /** 0..1 */
  sfx: number;
  muted: boolean;
}

export const DEFAULT_AUDIO: AudioSettings = { music: 0.6, sfx: 0.8, muted: false };
const STORAGE_KEY = 'audio_settings_v1';

const clamp01 = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;

export function normalizeAudio(value: Partial<AudioSettings> | null | undefined): AudioSettings {
  return {
    music: clamp01(value?.music, DEFAULT_AUDIO.music),
    sfx: clamp01(value?.sfx, DEFAULT_AUDIO.sfx),
    muted: typeof value?.muted === 'boolean' ? value.muted : DEFAULT_AUDIO.muted,
  };
}

interface AudioSettingsState {
  settings: AudioSettings;
  load: () => Promise<void>;
  update: (patch: Partial<AudioSettings>) => void;
}

/** Volume settings, applied immediately and saved on the device. */
export const useAudioSettings = create<AudioSettingsState>()((set, get) => ({
  settings: DEFAULT_AUDIO,
  load: async () => {
    try {
      const { value } = await Preferences.get({ key: STORAGE_KEY });
      if (value) set({ settings: normalizeAudio(JSON.parse(value) as Partial<AudioSettings>) });
    } catch {
      // Keep defaults when storage is unavailable or the value is corrupt.
    }
  },
  update: (patch) => {
    const settings = normalizeAudio({ ...get().settings, ...patch });
    set({ settings });
    Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(settings) }).catch((error: unknown) => console.error('[audio] save', error));
  },
}));
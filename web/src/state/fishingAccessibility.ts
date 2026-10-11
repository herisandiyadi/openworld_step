/**
 * Accessibility preference for F3 fishing (docs/FISHING.md 3.1 "Mode mudah").
 * Default off; persisted like the other Capacitor Preferences settings.
 */
import { Preferences } from '@capacitor/preferences';
import { create } from 'zustand';

export interface FishingAccessibility {
  /** Easy minigame: double-wide green zone, slower fish, no line break. */
  easyMode: boolean;
}

export const DEFAULT_FISHING_ACCESSIBILITY: FishingAccessibility = { easyMode: false };
const STORAGE_KEY = 'fishing_accessibility_v1';

export function normalizeFishingAccessibility(value: Partial<FishingAccessibility> | null | undefined): FishingAccessibility {
  return {
    easyMode: typeof value?.easyMode === 'boolean' ? value.easyMode : DEFAULT_FISHING_ACCESSIBILITY.easyMode,
  };
}

interface FishingAccessibilityState {
  settings: FishingAccessibility;
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<FishingAccessibility>) => void;
}

/** Easy-mode toggle, applied immediately and saved on the device. */
export const useFishingAccessibility = create<FishingAccessibilityState>()((set, get) => ({
  settings: DEFAULT_FISHING_ACCESSIBILITY,
  loaded: false,
  load: async () => {
    try {
      const { value } = await Preferences.get({ key: STORAGE_KEY });
      if (value) set({ settings: normalizeFishingAccessibility(JSON.parse(value) as Partial<FishingAccessibility>) });
    } catch {
      // Keep defaults when storage is unavailable or the value is corrupt.
    } finally {
      set({ loaded: true });
    }
  },
  update: (patch) => {
    const settings = normalizeFishingAccessibility({ ...get().settings, ...patch });
    set({ settings, loaded: true });
    Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(settings) }).catch((error: unknown) => console.error('[fishing] save accessibility', error));
  },
}));

// Matches useGraphicsSettings: the preference is available as soon as the app
// (or any test importing this module) boots, with no extra wiring.
if (typeof window !== 'undefined') void useFishingAccessibility.getState().load();

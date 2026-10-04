/**
 * User-facing visual settings, separate from the runtime renderer tier.
 * Pure normalization keeps storage upgrades and background/resume deterministic.
 */
import { Preferences } from '@capacitor/preferences';
import { create } from 'zustand';
import type { Quality } from './gameStore';
import type { GraphicsPreset } from '../ambient/spawner';

export const DENSITY_PRESETS: readonly GraphicsPreset[] = ['low', 'medium', 'high'];
export const DENSITY_LABELS: Record<GraphicsPreset, string> = { low: 'Sepi', medium: 'Normal', high: 'Ramai' };
export const QUALITY_PRESETS: readonly Quality[] = ['low', 'medium', 'high'];
export const QUALITY_LABELS: Record<Quality, string> = { low: 'Rendah', medium: 'Sedang', high: 'Tinggi' };
export const BRIGHTNESS_RANGE = { min: 0.75, max: 1.35 } as const;

export interface GraphicsSettings {
  density: GraphicsPreset;
  quality: Quality;
  brightness: number;
  reducedMotion: boolean;
}

export const DEFAULT_GRAPHICS: GraphicsSettings = { density: 'medium', quality: 'medium', brightness: 1, reducedMotion: false };
const STORAGE_KEY = 'graphics_settings_v2';
const isQuality = (value: unknown): value is Quality => QUALITY_PRESETS.includes(value as Quality);
const isDensity = (value: unknown): value is GraphicsPreset => DENSITY_PRESETS.includes(value as GraphicsPreset);

export interface GraphicsEnvironment { prefersReducedMotion?: boolean }
export function normalizeGraphics(value: Partial<GraphicsSettings> | null | undefined, environment: GraphicsEnvironment = {}): GraphicsSettings {
  const brightness = typeof value?.brightness === 'number' && Number.isFinite(value.brightness)
    ? Math.min(BRIGHTNESS_RANGE.max, Math.max(BRIGHTNESS_RANGE.min, value.brightness))
    : DEFAULT_GRAPHICS.brightness;
  return {
    density: isDensity(value?.density) ? value!.density! : DEFAULT_GRAPHICS.density,
    quality: isQuality(value?.quality) ? value!.quality! : DEFAULT_GRAPHICS.quality,
    brightness,
    reducedMotion: typeof value?.reducedMotion === 'boolean' ? value.reducedMotion : Boolean(environment.prefersReducedMotion),
  };
}

export interface RendererRuntimeState { quality: Quality }
export function resumeRendererState(saved: GraphicsSettings | null, runtime: RendererRuntimeState): Pick<GraphicsSettings, 'quality' | 'brightness' | 'reducedMotion'> {
  const settings = saved ?? DEFAULT_GRAPHICS;
  return { quality: saved?.quality ?? runtime.quality, brightness: settings.brightness, reducedMotion: settings.reducedMotion };
}

interface GraphicsSettingsState { settings: GraphicsSettings; load: () => Promise<void>; update: (patch: Partial<GraphicsSettings>) => void }
export const useGraphicsSettings = create<GraphicsSettingsState>()((set, get) => ({
  settings: DEFAULT_GRAPHICS,
  load: async () => {
    try {
      const { value } = await Preferences.get({ key: STORAGE_KEY });
      const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (value) set({ settings: normalizeGraphics(JSON.parse(value) as Partial<GraphicsSettings>, { prefersReducedMotion }) });
      else if (prefersReducedMotion) set({ settings: normalizeGraphics(null, { prefersReducedMotion }) });
    } catch { /* defaults are safe when storage is unavailable or corrupt */ }
  },
  update: (patch) => {
    const settings = normalizeGraphics({ ...get().settings, ...patch });
    set({ settings });
    Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(settings) }).catch((error: unknown) => console.error('[graphics] save', error));
  },
}));

if (typeof window !== 'undefined') void useGraphicsSettings.getState().load();

import { CapacitorHttp, Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { create } from 'zustand';

/** OpenAI-compatible endpoint used by the NPC chat (Phase 4). Stored on the device only. */
export interface AiSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** No API key default on purpose: keys are entered by the player and never bundled in the app. */
export const DEFAULT_AI_SETTINGS: AiSettings = {
  baseUrl: 'http://10.100.133.62:20127/v1',
  apiKey: '',
  model: 'cbai',
};

const STORAGE_KEY = 'ai_settings_v1';

interface AiSettingsState {
  settings: AiSettings;
  loaded: boolean;
  load: () => Promise<void>;
  save: (settings: AiSettings) => Promise<void>;
}

export const useAiSettings = create<AiSettingsState>()((set) => ({
  settings: DEFAULT_AI_SETTINGS,
  loaded: false,
  load: async () => {
    try {
      const { value } = await Preferences.get({ key: STORAGE_KEY });
      const stored = value ? (JSON.parse(value) as Partial<AiSettings>) : {};
      set({ settings: { ...DEFAULT_AI_SETTINGS, ...stored }, loaded: true });
    } catch {
      set({ settings: DEFAULT_AI_SETTINGS, loaded: true });
    }
  },
  save: async (settings) => {
    const clean = normalizeSettings(settings);
    await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(clean) });
    set({ settings: clean });
  },
}));

export function normalizeSettings(settings: AiSettings): AiSettings {
  return {
    baseUrl: settings.baseUrl.trim().replace(/\/+$/, ''),
    apiKey: settings.apiKey.trim(),
    model: settings.model.trim(),
  };
}

/** Returns an error message, or null when the settings look usable. */
export function validateSettings(settings: AiSettings): string | null {
  const clean = normalizeSettings(settings);
  if (!clean.baseUrl) return 'Base URL wajib diisi.';
  try {
    const url = new URL(clean.baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'Base URL harus diawali http:// atau https://';
  } catch {
    return 'Base URL tidak valid.';
  }
  if (!clean.model) return 'Model wajib diisi.';
  return null;
}

export interface ConnectionResult {
  ok: boolean;
  message: string;
}

/**
 * GET {baseUrl}/models. On Android it goes through CapacitorHttp (native), which avoids the
 * WebView CORS preflight the endpoint rejects; in the browser it uses fetch.
 */
export async function testConnection(settings: AiSettings): Promise<ConnectionResult> {
  const clean = normalizeSettings(settings);
  const invalid = validateSettings(clean);
  if (invalid) return { ok: false, message: invalid };
  const url = `${clean.baseUrl}/models`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (clean.apiKey) headers.Authorization = `Bearer ${clean.apiKey}`;

  try {
    let status: number;
    let body: unknown;
    if (Capacitor.isNativePlatform()) {
      const response = await CapacitorHttp.get({ url, headers, connectTimeout: 8000, readTimeout: 8000 });
      status = response.status;
      body = response.data;
    } else {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(url, { headers, signal: controller.signal });
        status = response.status;
        body = await response.json().catch(() => null);
      } finally {
        clearTimeout(timer);
      }
    }
    if (status === 401 || status === 403) return { ok: false, message: `Ditolak server (${status}). Cek API key.` };
    if (status < 200 || status >= 300) return { ok: false, message: `Server membalas HTTP ${status}.` };
    const ids = Array.isArray((body as { data?: unknown })?.data)
      ? ((body as { data: { id?: unknown }[] }).data.map((item) => String(item.id ?? '')).filter(Boolean))
      : [];
    if (ids.length === 0) return { ok: true, message: 'Terhubung.' };
    return ids.includes(clean.model)
      ? { ok: true, message: `Terhubung. Model "${clean.model}" tersedia.` }
      : { ok: false, message: `Terhubung, tapi model "${clean.model}" tidak ada. Tersedia: ${ids.slice(0, 8).join(', ')}` };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `Gagal terhubung: ${reason}` };
  }
}
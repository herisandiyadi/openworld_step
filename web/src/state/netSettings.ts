import { Preferences } from '@capacitor/preferences';
import { create } from 'zustand';

/**
 * Alamat server multiplayer mode internet (MULTIPLAYER.md bagian 6), diisi pemain di
 * Pengaturan seperti Base URL AI. Disimpan di perangkat saja.
 */
export interface NetSettings {
  /** `ws://` atau `wss://`; string kosong = belum diatur. */
  serverUrl: string;
}

/** Default kosong: tidak ada server bawaan di dalam app. */
export const DEFAULT_NET_SETTINGS: NetSettings = {
  serverUrl: '',
};

const STORAGE_KEY = 'net_settings_v1';

interface NetSettingsState {
  settings: NetSettings;
  loaded: boolean;
  load: () => Promise<void>;
  /** Melempar Error (pesan bahasa Indonesia) kalau alamat tidak valid; tidak ada yang disimpan. */
  save: (settings: NetSettings) => Promise<void>;
}

export const useNetSettings = create<NetSettingsState>()((set) => ({
  settings: DEFAULT_NET_SETTINGS,
  loaded: false,
  load: async () => {
    try {
      const { value } = await Preferences.get({ key: STORAGE_KEY });
      const stored: unknown = value ? JSON.parse(value) : null;
      set({ settings: normalizeStored(stored), loaded: true });
    } catch {
      set({ settings: DEFAULT_NET_SETTINGS, loaded: true });
    }
  },
  save: async (settings) => {
    const clean = normalizeNetSettings(settings);
    const invalid = validateNetSettings(clean);
    if (invalid) throw new Error(invalid);
    await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(clean) });
    set({ settings: clean });
  },
}));

export function normalizeNetSettings(settings: NetSettings): NetSettings {
  return {
    serverUrl: settings.serverUrl.trim().replace(/\/+$/, ''),
  };
}

/** Nilai tersimpan yang rusak (bukan objek, tipe salah, URL tidak sah) kembali ke default. */
export function normalizeStored(stored: unknown): NetSettings {
  if (typeof stored !== 'object' || stored === null) return DEFAULT_NET_SETTINGS;
  const serverUrl = (stored as { serverUrl?: unknown }).serverUrl;
  if (typeof serverUrl !== 'string') return DEFAULT_NET_SETTINGS;
  const clean = normalizeNetSettings({ serverUrl });
  return validateNetSettings(clean) ? DEFAULT_NET_SETTINGS : clean;
}

/** Benar kalau alamat server sudah diisi (mode internet bisa dipakai). */
export const isServerConfigured = (settings: NetSettings): boolean => normalizeNetSettings(settings).serverUrl !== '';

/** Mengembalikan pesan error, atau null kalau valid. Kosong dianggap valid (= belum diatur). */
export function validateNetSettings(settings: NetSettings): string | null {
  const clean = normalizeNetSettings(settings);
  if (!clean.serverUrl) return null;
  let url: URL;
  try {
    url = new URL(clean.serverUrl);
  } catch {
    return 'Alamat server tidak valid.';
  }
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return 'Alamat server harus diawali ws:// atau wss://';
  if (!url.hostname) return 'Alamat server tidak valid.';
  return null;
}

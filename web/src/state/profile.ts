import { Capacitor, registerPlugin } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { create } from 'zustand';

/** Local player, created on first launch. Stored in the on-device SQLite DB (android/.../PlayerDbPlugin.java). */
export interface PlayerProfile {
  username: string;
  createdAt: number;
  updatedAt: number;
}

export const USERNAME_MIN = 2;
export const USERNAME_MAX = 20;
/** Letters (any script) or digits first, then letters, digits, space, dot, underscore, dash. Mirrored in PlayerDbPlugin. */
const USERNAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u;

export const normalizeUsername = (value: string): string => value.trim().replace(/\s+/g, ' ');

/** Returns an error message, or null when the username is acceptable. */
export function validateUsername(value: string): string | null {
  const name = normalizeUsername(value);
  const length = [...name].length;
  if (length < USERNAME_MIN) return `Username minimal ${USERNAME_MIN} karakter.`;
  if (length > USERNAME_MAX) return `Username maksimal ${USERNAME_MAX} karakter.`;
  if (!USERNAME_PATTERN.test(name)) return 'Gunakan huruf, angka, spasi, titik, garis bawah, atau strip.';
  return null;
}

interface PlayerDbPlugin {
  getProfile(): Promise<{ profile?: PlayerProfile }>;
  saveProfile(options: { username: string }): Promise<{ profile?: PlayerProfile }>;
}

const PlayerDb = registerPlugin<PlayerDbPlugin>('PlayerDb');
/** Browser (npm run dev) fallback: no SQLite there, so the same record goes to Preferences/localStorage. */
const WEB_KEY = 'player_profile_v1';

function parseProfile(value: unknown): PlayerProfile | null {
  const data = value as Partial<PlayerProfile> | null | undefined;
  if (!data || typeof data.username !== 'string' || validateUsername(data.username) !== null) return null;
  const now = Date.now();
  return {
    username: normalizeUsername(data.username),
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : now,
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : now,
  };
}

export async function readProfile(): Promise<PlayerProfile | null> {
  if (Capacitor.isNativePlatform()) return parseProfile((await PlayerDb.getProfile()).profile);
  const { value } = await Preferences.get({ key: WEB_KEY });
  try {
    return value ? parseProfile(JSON.parse(value)) : null;
  } catch {
    return null;
  }
}

export async function writeProfile(username: string, previous: PlayerProfile | null): Promise<PlayerProfile> {
  const invalid = validateUsername(username);
  if (invalid) throw new Error(invalid);
  const name = normalizeUsername(username);
  if (Capacitor.isNativePlatform()) {
    const profile = parseProfile((await PlayerDb.saveProfile({ username: name })).profile);
    if (!profile) throw new Error('Profil tidak tersimpan.');
    return profile;
  }
  const now = Date.now();
  const profile: PlayerProfile = { username: name, createdAt: previous?.createdAt ?? now, updatedAt: now };
  await Preferences.set({ key: WEB_KEY, value: JSON.stringify(profile) });
  return profile;
}

interface ProfileState {
  profile: PlayerProfile | null;
  loaded: boolean;
  /** Set when the DB could not be read (shown on the username screen). */
  error: string | null;
  load: () => Promise<void>;
  save: (username: string) => Promise<void>;
}

export const usePlayerProfile = create<ProfileState>()((set, get) => ({
  profile: null,
  loaded: false,
  error: null,
  load: async () => {
    try {
      set({ profile: await readProfile(), loaded: true, error: null });
    } catch (error) {
      set({ profile: null, loaded: true, error: error instanceof Error ? error.message : String(error) });
    }
  },
  save: async (username) => {
    const profile = await writeProfile(username, get().profile);
    set({ profile, error: null });
  },
}));
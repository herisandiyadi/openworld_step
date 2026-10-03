import { Capacitor, registerPlugin } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { create } from 'zustand';

/** Pilihan penampilan (NEXT_FEATURES 9.4). Semua angka 0-2, indeks ke palet di game/HeroAppearance.ts. */
export interface Appearance {
  gender: 'm' | 'f';
  skinTone: number;
  hairStyle: number;
  hairColor: number;
  expression: number;
  shirtColor: number;
  shirtStyle: number;
  pantsColor: number;
  pantsStyle: number;
  accessory: number;
}

/** Default = tampilan hero lama: laki-laki, kulit terang, rambut pendek, hoodie biru, jeans, tanpa aksesori. */
export const DEFAULT_APPEARANCE: Appearance = {
  gender: 'm',
  skinTone: 0,
  hairStyle: 0,
  hairColor: 0,
  expression: 0,
  shirtColor: 0,
  shirtStyle: 1,
  pantsColor: 0,
  pantsStyle: 0,
  accessory: 0,
};

export const APPEARANCE_FIELDS = [
  'skinTone',
  'hairStyle',
  'hairColor',
  'expression',
  'shirtColor',
  'shirtStyle',
  'pantsColor',
  'pantsStyle',
  'accessory',
] as const;

/**
 * Memaksa nilai ke rentang valid; field yang salah/absen kembali ke default. Dipakai untuk profil v1
 * (tanpa appearance) dan profil lama yang belum punya skinTone/hairStyle/accessory: field baru
 * diisi default, jadi profil tersimpan tetap bisa dimuat tanpa crash.
 */
export function parseAppearance(value: unknown): Appearance {
  const data = value as Partial<Record<string, unknown>> | null | undefined;
  if (!data || typeof data !== 'object') return DEFAULT_APPEARANCE;
  const appearance: Appearance = { ...DEFAULT_APPEARANCE, gender: data.gender === 'f' ? 'f' : 'm' };
  for (const field of APPEARANCE_FIELDS) {
    const raw = data[field];
    if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 2) appearance[field] = raw;
  }
  return appearance;
}

/** Benar hanya kalau semua field sudah dalam rentang (dipakai sebelum menyimpan). */
export function isValidAppearance(value: unknown): boolean {
  const data = value as Partial<Appearance> | null | undefined;
  if (!data || (data.gender !== 'm' && data.gender !== 'f')) return false;
  return APPEARANCE_FIELDS.every((field) => {
    const raw = data[field];
    return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 2;
  });
}

/** Local player, created on first launch. Stored in the on-device SQLite DB (android/.../PlayerDbPlugin.java). */
export interface PlayerProfile {
  username: string;
  appearance: Appearance;
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
  saveProfile(options: { username: string; appearance: string }): Promise<{ profile?: PlayerProfile }>;
}

const PlayerDb = registerPlugin<PlayerDbPlugin>('PlayerDb');
/** Browser (npm run dev) fallback: no SQLite there, so the same record goes to Preferences/localStorage. */
const WEB_KEY = 'player_profile_v1';

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseProfile(value: unknown): PlayerProfile | null {
  const data = value as (Partial<PlayerProfile> & { appearance?: unknown }) | null | undefined;
  if (!data || typeof data.username !== 'string' || validateUsername(data.username) !== null) return null;
  const now = Date.now();
  return {
    username: normalizeUsername(data.username),
    // Profil v1 tidak punya appearance; `appearance` dari plugin native berupa string JSON.
    appearance: parseAppearance(typeof data.appearance === 'string' ? safeJson(data.appearance) : data.appearance),
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

export async function writeProfile(username: string, previous: PlayerProfile | null, appearance?: Appearance): Promise<PlayerProfile> {
  const invalid = validateUsername(username);
  if (invalid) throw new Error(invalid);
  const name = normalizeUsername(username);
  const look = appearance ?? previous?.appearance ?? DEFAULT_APPEARANCE;
  if (!isValidAppearance(look)) throw new Error('Pilihan penampilan tidak valid.');
  if (Capacitor.isNativePlatform()) {
    const profile = parseProfile((await PlayerDb.saveProfile({ username: name, appearance: JSON.stringify(look) })).profile);
    if (!profile) throw new Error('Profil tidak tersimpan.');
    return profile;
  }
  const now = Date.now();
  const profile: PlayerProfile = { username: name, appearance: look, createdAt: previous?.createdAt ?? now, updatedAt: now };
  await Preferences.set({ key: WEB_KEY, value: JSON.stringify(profile) });
  return profile;
}

interface ProfileState {
  profile: PlayerProfile | null;
  loaded: boolean;
  /** Set when the DB could not be read (shown on the username screen). */
  error: string | null;
  load: () => Promise<void>;
  save: (username: string, appearance?: Appearance) => Promise<void>;
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
  save: async (username, appearance) => {
    const profile = await writeProfile(username, get().profile, appearance);
    set({ profile, error: null });
  },
}));
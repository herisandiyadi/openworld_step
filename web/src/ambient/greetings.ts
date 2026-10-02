/**
 * Sapaan singkat warga (TASKS D3): teks lokal, tanpa AI. Murni TypeScript, deterministik per
 * (warga, jendela waktu) supaya bisa diuji dan tidak berkedip antar frame.
 */
import { mulberry32 } from '../world/worldGen';
import { hourOf } from './density';
import type { Resident } from './residents';

/** Jarak maksimum pemain supaya sapaan muncul (m). */
export const GREET_DISTANCE = 6;
/** Lama gelembung tampil (detik nyata). */
export const GREET_SECONDS = 2.5;
/** Jeda minimum sebelum warga yang sama menyapa lagi (detik nyata). */
export const GREET_COOLDOWN = 25;
/** Peluang seorang warga menyapa saat pemain lewat. */
export const GREET_CHANCE = 0.35;
/** Maksimum gelembung tampil bersamaan (keterbacaan + draw call). */
export const MAX_BUBBLES = 3;

/** Sapaan pagi (5-10), siang (10-15), sore (15-18), malam (18-5). */
const BY_TIME: Record<'pagi' | 'siang' | 'sore' | 'malam', readonly string[]> = {
  pagi: ['Pagi!', 'Selamat pagi', 'Pagi, mau ke mana?'],
  siang: ['Siang!', 'Mari, Mas', 'Panas ya hari ini'],
  sore: ['Sore!', 'Mari, monggo', 'Sore, santai saja'],
  malam: ['Malam!', 'Hati-hati di jalan', 'Masih keliling, Mas?'],
};
/** Sapaan netral yang cocok kapan saja. */
const ANYTIME = ['Halo!', 'Permisi', 'Sehat, Mas?', 'Mari'] as const;

export type TimeBand = keyof typeof BY_TIME;

export function timeBand(t: number): TimeBand {
  const hour = hourOf(t);
  if (hour < 5) return 'malam';
  if (hour < 10) return 'pagi';
  if (hour < 15) return 'siang';
  if (hour < 18) return 'sore';
  return 'malam';
}

/** Ganti sapaan "Mas" jadi "Mbak" kalau pemain perempuan. */
const forGender = (text: string, playerGender?: 'm' | 'f') =>
  playerGender === 'f' ? text.replace(/\bMas\b/g, 'Mbak') : text;

/**
 * Sapaan untuk satu warga. Deterministik: seed dari id warga + nomor jendela waktu,
 * jadi sapaan yang sama stabil selama gelembung tampil.
 */
export function greetingFor(resident: Resident, t: number, slot: number, playerGender?: 'm' | 'f'): string {
  const seed = [...resident.id].reduce((sum, char) => sum * 31 + char.charCodeAt(0), 7) ^ (slot * 0x9e3779b9);
  const random = mulberry32(seed >>> 0);
  const pool = [...BY_TIME[timeBand(t)], ...ANYTIME];
  const text = pool[Math.floor(random() * pool.length)] as string;
  // Warga yang lelah atau pendiam menyapa lebih singkat.
  const short = resident.mood === 'pendiam' || resident.mood === 'lelah';
  return forGender(short ? (text.split(/[,?]/)[0] as string).trim() : text, playerGender);
}

export interface GreetCandidate {
  resident: Resident;
  /** Jarak ke pemain (m). */
  distance: number;
  /** Detik nyata saat warga ini terakhir menyapa, atau undefined kalau belum pernah. */
  lastGreetAt?: number;
}

export interface GreetDecision {
  resident: Resident;
  text: string;
  /** Detik nyata gelembung hilang. */
  until: number;
}

/**
 * Pilih warga yang menyapa sekarang. `now` detik nyata, `t` jam dalam game.
 * Terdekat didahulukan, maksimum MAX_BUBBLES, hormati jarak dan cooldown.
 */
export function chooseGreetings(
  candidates: readonly GreetCandidate[],
  now: number,
  t: number,
  random: () => number,
  playerGender?: 'm' | 'f',
): GreetDecision[] {
  const slot = Math.floor(now / GREET_COOLDOWN);
  return [...candidates]
    .filter((item) => item.distance <= GREET_DISTANCE && now - (item.lastGreetAt ?? -Infinity) >= GREET_COOLDOWN)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, MAX_BUBBLES)
    .filter(() => random() < GREET_CHANCE)
    .map((item) => ({
      resident: item.resident,
      text: greetingFor(item.resident, t, slot, playerGender),
      until: now + GREET_SECONDS,
    }));
}

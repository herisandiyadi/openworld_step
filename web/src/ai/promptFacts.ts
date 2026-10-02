/**
 * Teks prompt yang dipakai bersama oleh chat NPC bernama (`ai/chat.ts`) dan chat warga
 * ambient (`ambient/residents.ts`). Murni: tanpa three.js dan tanpa React, supaya modul
 * simulasi tetap bisa mengimpornya (NEXT_FEATURES bagian 5).
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Giliran terakhir yang dikirim ke model (dan yang disimpan di save game). */
export const HISTORY_TURNS = 10;

export const WORLD_FACTS =
  'Fakta kota: ada tiga kawasan (Pusat Kota di tengah, Perumahan di sisi barat/utara/selatan, Kawasan Industri di sisi timur). Pemain bisa jalan kaki, naik skateboard, sepeda, motor, dan mobil yang terparkir, serta naik bus dari halte untuk berpindah cepat. Tidak ada musuh.';

export const RULES =
  'Jawab dalam bahasa Indonesia, singkat (maksimal 3 kalimat), tetap sebagai karakter. Hanya bahas hal seputar kota dan kehidupan sehari-hari di dalam game. Jika ditanya di luar konteks, arahkan kembali dengan sopan.';

/**
 * Kalimat tentang pemain. `playerName` sudah divalidasi di profil (huruf, angka, spasi . _ -,
 * maks 20 karakter), jadi tidak bisa menyelipkan instruksi ke system prompt. `look` adalah
 * ringkasan penampilan dari id opsi (dihitung pemanggil agar modul ini tetap murni).
 */
export function playerLine(playerName?: string, gender?: 'm' | 'f', look?: string): string {
  if (!playerName) return '';
  const greeting = gender === 'f' ? 'Mbak' : 'Mas';
  return `Pemain yang sedang berbicara denganmu bernama "${playerName}". Panggil dia "${greeting} ${playerName}", terutama saat menyapa.${look ? ` Dia memakai ${look}.` : ''}`;
}

/** Susunan system prompt yang sama untuk semua karakter: persona, fakta kota, pemain, aturan. */
export const systemPrompt = (persona: string, player: string): string =>
  [persona, WORLD_FACTS, player, RULES].filter(Boolean).join(' ');

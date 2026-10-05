/**
 * Logika murni untuk chat antar pemain (MULTIPLAYER.md 5.1). Dipisah dari komponen React
 * supaya bisa diuji tanpa DOM: penyaringan pemain yang dibisukan, nama pengirim, dan
 * gelembung "dekat" (satu per pemain, umur 5 detik, hanya dalam radius 30 m).
 */

import { NEARBY_CHAT_RADIUS, type ChatEntry } from '../net/session';
import type { ChatChannel, PlayerId } from '../net/protocol';
import type { RemotePlayer } from '../net/netStore';

/** Umur satu gelembung di atas kepala pengirim (5.1). */
export const BUBBLE_TTL_MS = 5000;

/** Batas karakter satu pesan; sama dengan batas host/server. */
export const MAX_CHAT_INPUT = 200;

export const CHANNEL_LABELS: Record<ChatChannel, string> = {
  session: 'Sesi',
  nearby: 'Dekat',
};

export interface Bubble {
  fromId: PlayerId;
  text: string;
  /** Waktu pesan masuk menurut jam lokal, dipakai untuk kedaluwarsa. */
  shownMs: number;
}

/** Pesan dari pemain yang dibisukan tidak ditampilkan (store juga sudah menyaringnya). */
export const visibleMessages = (entries: readonly ChatEntry[], muted: readonly PlayerId[]): ChatEntry[] =>
  entries.filter((entry) => !muted.includes(entry.fromId));

/** Nama pengirim untuk panel chat; pesan sendiri ditandai "Kamu". */
export function senderName(fromId: PlayerId, localId: PlayerId | null, remotes: Record<PlayerId, RemotePlayer>): string {
  if (localId !== null && fromId === localId) return 'Kamu';
  return remotes[fromId]?.username ?? 'Pemain';
}

/** Teks dipangkas dan dibatasi 200 karakter sebelum dikirim. */
export const trimChatInput = (raw: string): string => raw.trim().slice(0, MAX_CHAT_INPUT);

/**
 * Satu gelembung per pemain: pesan baru menggantikan yang lama, bukan menumpuk.
 * Hanya kanal `nearby` yang jadi gelembung; kanal sesi cukup di panel.
 */
export function reduceBubbles(bubbles: readonly Bubble[], entry: ChatEntry, nowMs: number): Bubble[] {
  if (entry.channel !== 'nearby') return [...bubbles];
  const next = bubbles.filter((bubble) => bubble.fromId !== entry.fromId);
  next.push({ fromId: entry.fromId, text: entry.text, shownMs: nowMs });
  return next;
}

/** Gelembung yang masih hidup: belum lewat 5 detik dan pemainnya tidak dibisukan. */
export const liveBubbles = (bubbles: readonly Bubble[], nowMs: number, muted: readonly PlayerId[]): Bubble[] =>
  bubbles.filter((bubble) => nowMs - bubble.shownMs < BUBBLE_TTL_MS && !muted.includes(bubble.fromId));

/**
 * Gelembung hanya digambar kalau pengirimnya terlihat dan dalam 30 m dari pemain lokal,
 * supaya ringan di HP. Pengirim tanpa posisi (belum ada snapshot) dilewati.
 */
export function bubbleDrawable(
  bubble: Bubble,
  remotes: Record<PlayerId, RemotePlayer>,
  origin: { x: number; z: number },
): boolean {
  const position = remotes[bubble.fromId]?.position;
  if (!position) return false;
  return Math.hypot(position.x - origin.x, position.z - origin.z) <= NEARBY_CHAT_RADIUS;
}

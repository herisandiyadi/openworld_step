import { create } from 'zustand';
import { DEFAULT_APPEARANCE, type Appearance } from '../state/profile';
import type { ChatChannel, PlayerId, PlayerInfo, PlayerSnapshot } from './protocol';
import { CHAT_HISTORY_MAX, pushHistory, type ChatEntry } from './session';

/** Status koneksi untuk HUD (indikator ping, notifikasi masuk/keluar). */
export type NetStatus = 'idle' | 'connecting' | 'connected' | 'error';

export interface RemotePlayer {
  id: PlayerId;
  username: string;
  appearance: Appearance;
  /** Posisi terakhir yang diketahui (hasil interpolasi digambar oleh RemotePlayers). */
  position: { x: number; y: number; z: number; heading: number } | null;
  /** Ping pemain itu menurut host; null kalau belum diketahui. */
  ping: number | null;
}

interface NetState {
  status: NetStatus;
  /** Pesan error terakhir (bahasa Indonesia, tampil di UI). */
  error: string | null;
  /** Id pemain lokal di sesi ini. */
  playerId: PlayerId | null;
  /** Pemain lain, tanpa pemain lokal. */
  remotes: Record<PlayerId, RemotePlayer>;
  /** Ping pemain lokal ke host (ms). */
  ping: number | null;
  /** Pemain yang dibisukan, lokal di HP ini saja (5.1). */
  muted: PlayerId[];
  /** Riwayat chat per kanal, maksimal 50 pesan, hanya di memori. */
  chat: Record<ChatChannel, ChatEntry[]>;
  /** Badge pesan belum dibaca per kanal (saat panel chat tertutup). */
  unread: Record<ChatChannel, number>;
  setStatus: (status: NetStatus, error?: string | null) => void;
  setPlayerId: (playerId: PlayerId | null) => void;
  setPlayers: (players: PlayerInfo[]) => void;
  addPlayer: (player: PlayerInfo) => void;
  removePlayer: (playerId: PlayerId) => void;
  setAppearance: (playerId: PlayerId, appearance: Appearance) => void;
  applySnapshots: (snapshots: readonly PlayerSnapshot[]) => void;
  setPing: (ping: number | null) => void;
  setPlayerPing: (playerId: PlayerId, ping: number) => void;
  toggleMute: (playerId: PlayerId) => void;
  isMuted: (playerId: PlayerId) => boolean;
  addChat: (entry: ChatEntry) => void;
  clearUnread: (channel: ChatChannel) => void;
  reset: () => void;
}

const emptyChat = (): Record<ChatChannel, ChatEntry[]> => ({ session: [], nearby: [] });
const emptyUnread = (): Record<ChatChannel, number> => ({ session: 0, nearby: 0 });

const toRemote = (player: PlayerInfo): RemotePlayer => ({
  id: player.id,
  username: player.username,
  appearance: player.appearance,
  position: null,
  ping: null,
});

/** State jaringan untuk UI saja; buffer snapshot per frame ada di net/session.ts. */
export const useNetStore = create<NetState>()((set, get) => ({
  status: 'idle',
  error: null,
  playerId: null,
  remotes: {},
  ping: null,
  muted: [],
  chat: emptyChat(),
  unread: emptyUnread(),
  setStatus: (status, error = null) => set({ status, error: status === 'error' ? error : null }),
  setPlayerId: (playerId) => set({ playerId }),
  setPlayers: (players) =>
    set((state) => {
      const remotes: Record<PlayerId, RemotePlayer> = {};
      for (const player of players) {
        if (player.id === state.playerId) continue;
        // Penampilan dari pemain yang sudah dikenal dipertahankan (cache per id, 3.1).
        remotes[player.id] = state.remotes[player.id] ?? toRemote(player);
      }
      return { remotes };
    }),
  addPlayer: (player) =>
    set((state) =>
      player.id === state.playerId ? state : { remotes: { ...state.remotes, [player.id]: state.remotes[player.id] ?? toRemote(player) } },
    ),
  removePlayer: (playerId) =>
    set((state) => {
      if (!state.remotes[playerId]) return state;
      const remotes = { ...state.remotes };
      delete remotes[playerId];
      return { remotes };
    }),
  setAppearance: (playerId, appearance) =>
    set((state) => {
      const remote = state.remotes[playerId];
      if (!remote) return state;
      return { remotes: { ...state.remotes, [playerId]: { ...remote, appearance } } };
    }),
  applySnapshots: (snapshots) =>
    set((state) => {
      let changed = false;
      const remotes = { ...state.remotes };
      for (const snap of snapshots) {
        const remote = remotes[snap.id];
        if (!remote || snap.id === state.playerId) continue;
        remotes[snap.id] = { ...remote, position: { x: snap.x, y: snap.y, z: snap.z, heading: snap.heading } };
        changed = true;
      }
      return changed ? { remotes } : state;
    }),
  setPing: (ping) => set({ ping }),
  setPlayerPing: (playerId, ping) =>
    set((state) => {
      const remote = state.remotes[playerId];
      if (!remote) return state;
      return { remotes: { ...state.remotes, [playerId]: { ...remote, ping } } };
    }),
  toggleMute: (playerId) =>
    set((state) => ({
      muted: state.muted.includes(playerId) ? state.muted.filter((id) => id !== playerId) : [...state.muted, playerId],
    })),
  isMuted: (playerId) => get().muted.includes(playerId),
  addChat: (entry) =>
    set((state) => {
      // Pesan dari pemain yang dibisukan tidak masuk riwayat maupun badge.
      if (state.muted.includes(entry.fromId)) return state;
      return {
        chat: { ...state.chat, [entry.channel]: pushHistory(state.chat[entry.channel], entry, CHAT_HISTORY_MAX) },
        unread: { ...state.unread, [entry.channel]: state.unread[entry.channel] + 1 },
      };
    }),
  clearUnread: (channel) => set((state) => ({ unread: { ...state.unread, [channel]: 0 } })),
  reset: () =>
    set({
      status: 'idle',
      error: null,
      playerId: null,
      remotes: {},
      ping: null,
      muted: [],
      chat: emptyChat(),
      unread: emptyUnread(),
    }),
}));

/** Penampilan pemain remote, atau default kalau belum diketahui (dipakai RemotePlayers). */
export const remoteAppearance = (playerId: PlayerId): Appearance =>
  useNetStore.getState().remotes[playerId]?.appearance ?? DEFAULT_APPEARANCE;

import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE } from '../state/profile';
import { remoteAppearance, useNetStore } from './netStore';
import type { ChatEntry } from './session';

const chat = (id: number, fromId: number, channel: ChatEntry['channel'] = 'session'): ChatEntry => ({
  id,
  channel,
  fromId,
  timeMs: id,
  text: `pesan ${id}`,
});

beforeEach(() => useNetStore.getState().reset());

describe('netStore', () => {
  it('status koneksi dan error', () => {
    const store = useNetStore.getState();
    store.setStatus('connecting');
    expect(useNetStore.getState().status).toBe('connecting');
    store.setStatus('error', 'Koneksi terputus.');
    expect(useNetStore.getState().error).toBe('Koneksi terputus.');
    store.setStatus('connected');
    expect(useNetStore.getState().error).toBeNull();
  });

  it('daftar pemain remote tanpa pemain lokal, plus posisi dan ping', () => {
    const store = useNetStore.getState();
    store.setPlayerId(1);
    store.setPlayers([
      { id: 1, username: 'Saya', appearance: DEFAULT_APPEARANCE },
      { id: 2, username: 'Sari', appearance: { ...DEFAULT_APPEARANCE, gender: 'f' } },
    ]);
    expect(Object.keys(useNetStore.getState().remotes)).toEqual(['2']);
    store.addPlayer({ id: 3, username: 'Tono', appearance: DEFAULT_APPEARANCE });
    store.applySnapshots([{ id: 2, x: 1, y: 0, z: 2, heading: 0.5, mode: 'walk', anim: 'walk', jumping: false }]);
    store.setPlayerPing(2, 80);
    store.setPing(42);
    const state = useNetStore.getState();
    expect(state.remotes[2]?.position).toEqual({ x: 1, y: 0, z: 2, heading: 0.5 });
    expect(state.remotes[2]?.ping).toBe(80);
    expect(state.ping).toBe(42);
    expect(remoteAppearance(2).gender).toBe('f');
    expect(remoteAppearance(99)).toEqual(DEFAULT_APPEARANCE);
    store.removePlayer(3);
    expect(useNetStore.getState().remotes[3]).toBeUndefined();
  });

  it('perubahan penampilan memperbarui cache', () => {
    const store = useNetStore.getState();
    store.addPlayer({ id: 2, username: 'Sari', appearance: DEFAULT_APPEARANCE });
    store.setAppearance(2, { ...DEFAULT_APPEARANCE, hairColor: 2 });
    expect(useNetStore.getState().remotes[2]?.appearance.hairColor).toBe(2);
  });

  it('riwayat chat per kanal maks 50 dan badge belum dibaca', () => {
    const store = useNetStore.getState();
    for (let id = 1; id <= 55; id++) store.addChat(chat(id, 2));
    store.addChat(chat(100, 2, 'nearby'));
    let state = useNetStore.getState();
    expect(state.chat.session).toHaveLength(50);
    expect(state.chat.session[0]?.id).toBe(6);
    expect(state.chat.nearby).toHaveLength(1);
    expect(state.unread).toEqual({ session: 55, nearby: 1 });
    store.clearUnread('session');
    state = useNetStore.getState();
    expect(state.unread).toEqual({ session: 0, nearby: 1 });
  });

  it('pemain yang dibisukan tidak masuk riwayat', () => {
    const store = useNetStore.getState();
    store.toggleMute(2);
    expect(store.isMuted(2)).toBe(true);
    store.addChat(chat(1, 2));
    store.addChat(chat(2, 3));
    expect(useNetStore.getState().chat.session.map((entry) => entry.fromId)).toEqual([3]);
    store.toggleMute(2);
    expect(useNetStore.getState().isMuted(2)).toBe(false);
  });
});

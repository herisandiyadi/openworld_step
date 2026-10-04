/** Test logika murni chat antar pemain (MULTIPLAYER.md 5.1). Tanpa DOM, tanpa jaringan. */

import { describe, expect, it } from 'vitest';
import {
  BUBBLE_TTL_MS,
  MAX_CHAT_INPUT,
  bubbleDrawable,
  liveBubbles,
  reduceBubbles,
  senderName,
  trimChatInput,
  visibleMessages,
} from './chatLogic';
import type { Bubble } from './chatLogic';
import type { ChatEntry } from '../net/session';
import type { ChatChannel, PlayerId } from '../net/protocol';
import type { RemotePlayer } from '../net/netStore';
import { DEFAULT_APPEARANCE } from '../state/profile';

const entry = (id: number, fromId: number, text: string, channel: ChatChannel = 'nearby'): ChatEntry => ({
  id,
  channel,
  fromId: fromId as PlayerId,
  timeMs: id * 100,
  text,
});

const remote = (id: number, username: string, x: number, z: number): RemotePlayer => ({
  id: id as PlayerId,
  username,
  appearance: DEFAULT_APPEARANCE,
  position: { x, y: 0, z, heading: 0 },
  ping: null,
});

const remotesOf = (...list: RemotePlayer[]): Record<PlayerId, RemotePlayer> =>
  Object.fromEntries(list.map((r) => [r.id, r])) as Record<PlayerId, RemotePlayer>;

describe('penyaringan pesan', () => {
  it('menyembunyikan pesan dari pemain yang dibisukan', () => {
    const list = [entry(1, 7, 'halo'), entry(2, 8, 'spam'), entry(3, 7, 'lagi')];
    const kept = visibleMessages(list, [8 as PlayerId]);
    expect(kept.map((e) => e.id)).toEqual([1, 3]);
  });

  it('tanpa pembisuan semua pesan lolos', () => {
    const list = [entry(1, 7, 'a'), entry(2, 8, 'b')];
    expect(visibleMessages(list, [])).toHaveLength(2);
  });
});

describe('nama pengirim', () => {
  const remotes = remotesOf(remote(7, 'Budi', 0, 0));

  it('pesan sendiri ditandai Kamu', () => {
    expect(senderName(5 as PlayerId, 5 as PlayerId, remotes)).toBe('Kamu');
  });

  it('memakai username pemain lain', () => {
    expect(senderName(7 as PlayerId, 5 as PlayerId, remotes)).toBe('Budi');
  });

  it('pemain yang sudah keluar diberi nama cadangan', () => {
    expect(senderName(99 as PlayerId, 5 as PlayerId, remotes)).toBe('Pemain');
  });
});

describe('batas input', () => {
  it('memangkas spasi di ujung', () => {
    expect(trimChatInput('  halo  ')).toBe('halo');
  });

  it('membatasi 200 karakter', () => {
    expect(trimChatInput('x'.repeat(500))).toHaveLength(MAX_CHAT_INPUT);
  });

  it('teks hanya spasi jadi kosong', () => {
    expect(trimChatInput('   ')).toBe('');
  });
});

describe('gelembung dekat', () => {
  it('kanal sesi tidak membuat gelembung', () => {
    expect(reduceBubbles([], entry(1, 7, 'halo', 'session'), 1000)).toHaveLength(0);
  });

  it('satu gelembung per pemain: pesan baru menggantikan yang lama', () => {
    const first = reduceBubbles([], entry(1, 7, 'satu'), 1000);
    const second = reduceBubbles(first, entry(2, 7, 'dua'), 1200);
    expect(second).toHaveLength(1);
    expect(second[0]?.text).toBe('dua');
    expect(second[0]?.shownMs).toBe(1200);
  });

  it('pemain berbeda punya gelembung sendiri', () => {
    const list = reduceBubbles(reduceBubbles([], entry(1, 7, 'a'), 1000), entry(2, 8, 'b'), 1000);
    expect(list.map((b) => b.fromId)).toEqual([7, 8]);
  });

  it('gelembung kedaluwarsa setelah 5 detik', () => {
    const list: Bubble[] = [{ fromId: 7 as PlayerId, text: 'a', shownMs: 1000 }];
    expect(liveBubbles(list, 1000 + BUBBLE_TTL_MS - 1, [])).toHaveLength(1);
    expect(liveBubbles(list, 1000 + BUBBLE_TTL_MS, [])).toHaveLength(0);
  });

  it('gelembung pemain yang dibisukan tidak hidup', () => {
    const list: Bubble[] = [{ fromId: 7 as PlayerId, text: 'a', shownMs: 1000 }];
    expect(liveBubbles(list, 1100, [7 as PlayerId])).toHaveLength(0);
  });
});

describe('jangkauan gambar gelembung', () => {
  const bubble: Bubble = { fromId: 7 as PlayerId, text: 'a', shownMs: 0 };

  it('digambar saat pengirim dalam 30 m', () => {
    const remotes = remotesOf(remote(7, 'Budi', 20, 0));
    expect(bubbleDrawable(bubble, remotes, { x: 0, z: 0 })).toBe(true);
  });

  it('tidak digambar saat lebih jauh dari 30 m', () => {
    const remotes = remotesOf(remote(7, 'Budi', 40, 0));
    expect(bubbleDrawable(bubble, remotes, { x: 0, z: 0 })).toBe(false);
  });

  it('pengirim tanpa posisi dilewati', () => {
    const noPos: RemotePlayer = { ...remote(7, 'Budi', 0, 0), position: null };
    expect(bubbleDrawable(bubble, remotesOf(noPos), { x: 0, z: 0 })).toBe(false);
  });
});

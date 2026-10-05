/**
 * Gelembung chat "dekat" di atas kepala pengirim (MULTIPLAYER.md 5.1).
 * Dipasang di dalam <Canvas>. Satu gelembung per pemain, hilang setelah 5 detik,
 * hanya digambar kalau pengirim dalam 30 m dari pemain lokal.
 */

import { type ReactElement, useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type { Group } from 'three';
import { playerState } from '../game/runtime';
import { useNetStore } from '../net/netStore';
import type { ChatEntry } from '../net/session';
import type { PlayerId } from '../net/protocol';
import { type Bubble, BUBBLE_TTL_MS, bubbleDrawable, liveBubbles, reduceBubbles } from './chatLogic';
import './chat.css';

/** Tinggi gelembung di atas pijakan (di atas label nama, yang ada di 2,3 m). */
const BUBBLE_Y = 2.85;

function BubbleView({ bubble }: { bubble: Bubble }): ReactElement {
  const groupRef = useRef<Group>(null);

  // Posisi mengikuti pemain tiap frame tanpa setState.
  useFrame(() => {
    const group = groupRef.current;
    const position = useNetStore.getState().remotes[bubble.fromId]?.position;
    if (!group || !position) return;
    group.position.set(position.x, position.y + BUBBLE_Y, position.z);
  });

  return (
    <group ref={groupRef}>
      <Html center zIndexRange={[10, 0]} pointerEvents="none">
        <div className="chat-bubble-near" role="status">
          {bubble.text}
        </div>
      </Html>
    </group>
  );
}

export function ChatBubbles(): ReactElement {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const localId = useNetStore((state) => state.playerId);
  const muted = useNetStore((state) => state.muted);
  const remotes = useNetStore((state) => state.remotes);

  // Pesan baru dideteksi dari id terakhir per kanal nearby, bukan dari panjang array
  // (riwayat dipotong ke 50, jadi panjangnya bisa tetap sama).
  useEffect(() => {
    let lastId = -1;
    const latest = useNetStore.getState().chat.nearby;
    if (latest.length > 0) lastId = latest[latest.length - 1]?.id ?? -1;
    return useNetStore.subscribe((state) => {
      const list = state.chat.nearby;
      const fresh: ChatEntry[] = [];
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const entry = list[i];
        if (!entry || entry.id <= lastId) break;
        fresh.unshift(entry);
      }
      if (fresh.length === 0) return;
      lastId = fresh[fresh.length - 1]?.id ?? lastId;
      const now = Date.now();
      setBubbles((current) => fresh.reduce((acc, entry) => reduceBubbles(acc, entry, now), current));
    });
  }, []);

  // Pembersihan berkala; cukup tiap detik, tidak perlu per frame.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setBubbles((current) => {
        const next = current.filter((bubble) => now - bubble.shownMs < BUBBLE_TTL_MS);
        return next.length === current.length ? current : next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const origin = { x: playerState.x, z: playerState.z };
  const shown = liveBubbles(bubbles, Date.now(), muted).filter(
    (bubble) => bubble.fromId !== (localId as PlayerId | null) && bubbleDrawable(bubble, remotes, origin),
  );

  return (
    <>
      {shown.map((bubble) => (
        <BubbleView key={bubble.fromId} bubble={bubble} />
      ))}
    </>
  );
}

import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { chooseGreetings, type GreetDecision, GREET_DISTANCE, MAX_BUBBLES } from './greetings';
import { generateResidents, type Resident } from './residents';
import { dayClock, playerState } from '../game/runtime';
import { usePlayerProfile } from '../state/profile';
import { groundHeightAt } from '../world/worldState';

/** Tinggi gelembung di atas kepala warga (m). */
const BUBBLE_Y = 2.1;
const CHECK_INTERVAL = 0.5;

/** Posisi warga di dunia; diisi pemanggil (PedestrianLayer) lewat prop `walkers`. */
export interface GreetWalker {
  resident: Resident;
  x: number;
  z: number;
}

interface Bubble extends GreetDecision {
  x: number;
  z: number;
}

/**
 * Gelembung sapaan singkat di atas warga terdekat (TASKS D3). Pemilihan teks ada di greetings.ts
 * (murni, diuji); komponen ini hanya menggambar.
 *
 * Aksesibilitas: gelembung bukan satu-satunya kanal. Teks yang sama juga diumumkan di live region
 * `aria-live="polite"` di luar Canvas, jadi pembaca layar tetap mendapat sapaan.
 *
 * ponytail: `walkers` kosong selama PedestrianLayer (wave 2) belum ada, jadi komponen ini diam saja.
 * Saat PedestrianLayer mendarat, kirim pejalan kaki aktif beserta Resident-nya ke prop ini.
 */
export function GreetingBubbles({ walkers = [] }: { walkers?: readonly GreetWalker[] }) {
  const playerGender = usePlayerProfile((state) => state.profile?.appearance.gender);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const timer = useRef(0);
  const lastGreet = useRef(new Map<string, number>());
  const elapsed = useRef(0);

  useFrame((_, delta) => {
    elapsed.current += Math.min(delta, 0.05);
    const now = elapsed.current;
    timer.current += Math.min(delta, 0.05);

    const live = bubbles.filter((bubble) => bubble.until > now);
    if (timer.current < CHECK_INTERVAL) {
      if (live.length !== bubbles.length) setBubbles(live);
      return;
    }
    timer.current = 0;
    if (walkers.length === 0) {
      if (bubbles.length > 0) setBubbles([]);
      return;
    }

    const candidates = walkers
      .map((walker) => ({
        resident: walker.resident,
        distance: Math.hypot(walker.x - playerState.x, walker.z - playerState.z),
        lastGreetAt: lastGreet.current.get(walker.resident.id),
      }))
      .filter((item) => item.distance <= GREET_DISTANCE);
    const room = MAX_BUBBLES - live.length;
    if (room <= 0 || candidates.length === 0) {
      if (live.length !== bubbles.length) setBubbles(live);
      return;
    }
    const chosen = chooseGreetings(candidates, now, dayClock.t, Math.random, playerGender)
      .filter((item) => !live.some((bubble) => bubble.resident.id === item.resident.id))
      .slice(0, room)
      .map((item) => {
        lastGreet.current.set(item.resident.id, now);
        const walker = walkers.find((entry) => entry.resident.id === item.resident.id);
        return { ...item, x: walker?.x ?? 0, z: walker?.z ?? 0 };
      });
    setBubbles(chosen.length > 0 ? [...live, ...chosen] : live);
  });

  return (
    <>
      {bubbles.map((bubble) => (
        <Html
          key={bubble.resident.id}
          position={[bubble.x, groundHeightAt(bubble.x, bubble.z) + BUBBLE_Y, bubble.z]}
          center
          zIndexRange={[10, 0]}
          pointerEvents="none"
        >
          <div className="npc-label">{bubble.text}</div>
        </Html>
      ))}
      <Html>
        <p className="visually-hidden" role="status" aria-live="polite">
          {bubbles.map((bubble) => `${bubble.resident.name}: ${bubble.text}`).join('. ')}
        </p>
      </Html>
    </>
  );
}

/** Daftar warga tetap, dipakai pemanggil untuk memasangkan pejalan kaki ke persona. */
export const GREET_RESIDENTS = generateResidents();

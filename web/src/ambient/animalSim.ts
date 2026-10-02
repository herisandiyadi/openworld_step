/**
 * State machine hewan ambient (kucing, anjing, merpati) tanpa three.js supaya bisa di-unit-test
 * dan nanti dipindah ke web worker (NEXT_FEATURES 3.3). Satuan meter dan detik.
 */
import type { Vec2 } from '../game/movement';

export type Species = 'cat' | 'dog' | 'pigeon';
export type AnimalState = 'idle' | 'sit' | 'groom' | 'sniff' | 'peck' | 'wander' | 'flee' | 'follow' | 'fly' | 'land';

export interface Animal {
  species: Species;
  x: number;
  z: number;
  /** Pusat wilayah hewan; tujuan jalan selalu di dalam `radius` dari titik ini. */
  home: Vec2;
  /** Radius wilayah, 10-20 m. */
  radius: number;
  state: AnimalState;
  /** Sisa waktu state saat ini (detik). */
  timer: number;
  target: Vec2;
  /** Anjing sudah mengundi peluang ikut untuk pendekatan pemain saat ini. */
  rolled: boolean;
}

/** Jarak kesadaran ke pemain. */
export const AWARE: Record<Species, number> = { cat: 3, dog: 4, pigeon: 5 };
export const DOG_FOLLOW_CHANCE = 0.3;
/** Anjing mengundi lagi setelah pemain menjauh sejauh ini. */
const DOG_RESET = 8;
const DOG_KEEP = 1.5;
const WALK: Record<Species, number> = { cat: 0.8, dog: 1.2, pigeon: 0.4 };
const RUN: Record<Species, number> = { cat: 4, dog: 3, pigeon: 6 };
const RESTS: Record<Species, AnimalState[]> = { cat: ['idle', 'sit', 'groom'], dog: ['idle', 'sniff'], pigeon: ['peck'] };

export function createAnimal(species: Species, home: Vec2, random: () => number): Animal {
  const radius = 10 + 10 * random();
  return { species, x: home.x, z: home.z, home, radius, state: 'idle', timer: 1 + 3 * random(), target: { ...home }, rolled: false };
}

// ponytail: tujuan acak dalam lingkaran, belum di-snap ke navmesh. Pemanggil (AmbientLayer) mem-path-kan lewat
// world/navigation.findPath dan mengganti target bila tidak terjangkau.
function wanderTarget(a: Animal, random: () => number): Vec2 {
  const angle = random() * Math.PI * 2;
  const r = a.radius * Math.sqrt(random());
  return { x: a.home.x + Math.cos(angle) * r, z: a.home.z + Math.sin(angle) * r };
}

/** Titik sejauh `distance` dari pemain, searah menjauhi pemain. */
function awayFrom(a: Animal, player: Vec2, distance: number): Vec2 {
  const dx = a.x - player.x;
  const dz = a.z - player.z;
  const len = Math.hypot(dx, dz) || 1;
  return { x: a.x + (dx / len) * distance, z: a.z + (dz / len) * distance };
}

function rest(a: Animal, random: () => number): void {
  const options = RESTS[a.species];
  a.state = options[Math.floor(random() * options.length)] ?? 'idle';
  a.timer = 2 + 4 * random();
}

/** Gerak lurus ke target; true jika sudah sampai. */
function moveTo(a: Animal, target: Vec2, speed: number, dt: number, stopAt = 0.2): boolean {
  const dx = target.x - a.x;
  const dz = target.z - a.z;
  const dist = Math.hypot(dx, dz);
  if (dist <= stopAt) return true;
  const step = Math.min(speed * dt, dist - stopAt);
  a.x += (dx / dist) * step;
  a.z += (dz / dist) * step;
  return dist - step <= stopAt;
}

/** Satu langkah simulasi. Mengubah `a` di tempat (hemat alokasi untuk banyak hewan). */
export function stepAnimal(a: Animal, dt: number, player: Vec2, random: () => number): void {
  const near = Math.hypot(player.x - a.x, player.z - a.z);
  a.timer -= dt;

  // Reaksi ke pemain lebih dulu dari jadwal biasa.
  if (a.species === 'cat' && near < AWARE.cat && a.state !== 'flee') {
    a.state = 'flee';
    a.target = awayFrom(a, player, 6);
    a.timer = 3;
  } else if (a.species === 'pigeon' && near < AWARE.pigeon && a.state !== 'fly') {
    a.state = 'fly';
    a.target = awayFrom(a, player, 15);
    a.timer = 3;
  } else if (a.species === 'dog') {
    if (near > DOG_RESET) a.rolled = false;
    if (near < AWARE.dog && !a.rolled && a.state !== 'follow') {
      a.rolled = true;
      if (random() < DOG_FOLLOW_CHANCE) {
        a.state = 'follow';
        a.timer = 5 + 3 * random();
      }
    }
  }

  switch (a.state) {
    case 'wander':
      if (moveTo(a, a.target, WALK[a.species], dt)) rest(a, random);
      return;
    case 'flee':
      moveTo(a, a.target, RUN[a.species], dt);
      if (a.timer <= 0) rest(a, random);
      return;
    case 'follow':
      moveTo(a, player, RUN.dog, dt, DOG_KEEP);
      if (a.timer <= 0) {
        // Selesai mengikuti: kembali ke wilayahnya.
        a.state = 'wander';
        a.target = wanderTarget(a, random);
      }
      return;
    case 'fly':
      moveTo(a, a.target, RUN.pigeon, dt);
      if (a.timer <= 0) {
        a.state = 'land';
        a.timer = 1;
      }
      return;
    case 'land':
      if (a.timer <= 0) rest(a, random);
      return;
    default:
      // idle, sit, groom, sniff, peck
      if (a.timer <= 0) {
        a.state = 'wander';
        a.target = wanderTarget(a, random);
      }
  }
}

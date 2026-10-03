import { beforeEach, describe, expect, it } from 'vitest';
import type { Aabb } from './movement';
import {
  clearSeatReservations,
  findNearestFreeSeat,
  isSeatFree,
  releaseOccupant,
  releaseSeat,
  reserveSeat,
  seatOccupant,
  standPosition,
  STAND_FORWARD,
} from './seating';
import type { SeatPoint } from '../world/worldSpec';

const seatA: SeatPoint = { id: 'a', x: 0, y: 0.45, z: 0, yaw: 0 };
const seatB: SeatPoint = { id: 'b', x: 0.8, y: 0.45, z: 0, yaw: 0 };
/** Pemain (radius r) menembus collider lebih dari 1 cm; sentuhan tepat di batas (0.3 + 0.4 = 0.7 m) tidak dihitung. */
const inside = (x: number, z: number, box: Aabb, radius: number) => {
  const r = radius - 0.01;
  return x > box.minX - r && x < box.maxX + r && z > box.minZ - r && z < box.maxZ + r;
};

describe('reservasi kursi', () => {
  beforeEach(clearSeatReservations);

  it('tidak pernah memberi satu kursi ke dua karakter', () => {
    expect(reserveSeat('a', 'player')).toBe(true);
    expect(reserveSeat('a', 'warga_1')).toBe(false);
    expect(seatOccupant('a')).toBe('player');
    // Reservasi ulang oleh pemilik yang sama tetap boleh.
    expect(reserveSeat('a', 'player')).toBe(true);
    // Hanya pemilik yang bisa melepas.
    releaseSeat('a', 'warga_1');
    expect(seatOccupant('a')).toBe('player');
    releaseSeat('a', 'player');
    expect(isSeatFree('a')).toBe(true);
    expect(reserveSeat('a', 'warga_1')).toBe(true);
  });

  it('acak 2000 langkah pemain dan warga tetap satu karakter per kursi', () => {
    const seats = ['a', 'b', 'c'];
    const actors = ['player', 'w1', 'w2', 'w3', 'w4'];
    const held = new Map<string, string>();
    let state = 7;
    const rand = () => ((state = (state * 1103515245 + 12345) >>> 0) / 4294967296);
    for (let step = 0; step < 2000; step++) {
      const seat = seats[Math.floor(rand() * seats.length)] ?? 'a';
      const actor = actors[Math.floor(rand() * actors.length)] ?? 'player';
      if (rand() < 0.6) {
        const ok = reserveSeat(seat, actor);
        expect(ok).toBe(!held.has(seat) || held.get(seat) === actor);
        if (ok) held.set(seat, actor);
      } else {
        releaseSeat(seat, actor);
        if (held.get(seat) === actor) held.delete(seat);
      }
      for (const id of seats) expect(seatOccupant(id)).toBe(held.get(id) ?? null);
    }
  });

  it('melepas semua kursi milik satu warga', () => {
    reserveSeat('a', 'w1');
    reserveSeat('b', 'w1');
    reserveSeat('c', 'player');
    releaseOccupant('w1');
    expect(isSeatFree('a') && isSeatFree('b')).toBe(true);
    expect(seatOccupant('c')).toBe('player');
  });

  it('mencari kursi kosong terdekat dalam 1.5 m', () => {
    expect(findNearestFreeSeat([seatA, seatB], 1, 0)?.id).toBe('b');
    reserveSeat('b', 'w1');
    expect(findNearestFreeSeat([seatA, seatB], 1, 0)?.id).toBe('a');
    expect(findNearestFreeSeat([seatA, seatB], 3, 0)).toBeNull();
    reserveSeat('a', 'player');
    expect(findNearestFreeSeat([seatA, seatB], 0, 0, 'player')?.id).toBe('a');
    expect(findNearestFreeSeat([seatA, seatB], 0, 0, 'w2')).toBeNull();
  });
});

describe('posisi berdiri', () => {
  const bench: Aabb = { minX: -0.4, maxX: 1.2, minZ: -0.3, maxZ: 0.3 };

  it('berdiri 0.7 m di depan kursi kalau bebas', () => {
    const spot = standPosition(seatA, [bench]);
    expect(spot.x).toBeCloseTo(0);
    expect(spot.z).toBeCloseTo(-STAND_FORWARD);
  });

  it('mencoba kiri/kanan kalau depan terhalang, tidak pernah di dalam collider', () => {
    const blocker: Aabb = { minX: -0.3, maxX: 0.3, minZ: -1, maxZ: -0.4 };
    const spot = standPosition(seatA, [bench, blocker]);
    for (const box of [bench, blocker]) expect(inside(spot.x, spot.z, box, 0.4)).toBe(false);
    expect(Math.abs(spot.x)).toBeGreaterThan(0.5);
  });

  it('berlaku untuk semua arah bangku (yaw seperempat putaran)', () => {
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const seat: SeatPoint = { id: 's', x: 10, y: 0.45, z: 10, yaw };
      // Collider bangku 1.6 x 0.6 diputar sesuai yaw, kursi di tengah.
      const along = Math.abs(Math.cos(yaw)) > 0.5;
      // Titik 0.7 m di depan tepat menyentuh collider + radius pemain (0.3 + 0.4); itu harus dianggap bebas.
      const box: Aabb = along
        ? { minX: 9.2, maxX: 10.8, minZ: 9.7, maxZ: 10.3 }
        : { minX: 9.7, maxX: 10.3, minZ: 9.2, maxZ: 10.8 };
      const spot = standPosition(seat, [box]);
      expect(inside(spot.x, spot.z, box, 0.4)).toBe(false);
      expect(Math.hypot(spot.x - 10, spot.z - 10)).toBeCloseTo(STAND_FORWARD);
    }
  });
});

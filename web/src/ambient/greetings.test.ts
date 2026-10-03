import { describe, expect, it } from 'vitest';
import {
  chooseGreetings,
  GREET_COOLDOWN,
  GREET_DISTANCE,
  greetingFor,
  MAX_BUBBLES,
  timeBand,
} from './greetings';
import { generateResidents, type Resident } from './residents';

const residents = generateResidents();
const at = (hour: number) => hour / 24;
const first = residents[0] as Resident;
const candidate = (resident: Resident, distance: number, lastGreetAt?: number) => ({ resident, distance, lastGreetAt });

describe('sapaan warga', () => {
  it('jendela waktu sesuai jam', () => {
    expect(timeBand(at(6))).toBe('pagi');
    expect(timeBand(at(12))).toBe('siang');
    expect(timeBand(at(16))).toBe('sore');
    expect(timeBand(at(20))).toBe('malam');
    expect(timeBand(at(2))).toBe('malam');
  });

  it('deterministik untuk warga dan slot yang sama', () => {
    expect(greetingFor(first, at(7), 3)).toBe(greetingFor(first, at(7), 3));
    const texts = new Set(residents.slice(0, 20).map((resident) => greetingFor(resident, at(7), 3)));
    expect(texts.size).toBeGreaterThan(1);
  });

  it('sapaan selalu singkat dan tidak kosong', () => {
    for (const resident of residents) {
      for (const hour of [6, 12, 16, 22]) {
        const text = greetingFor(resident, at(hour), hour);
        expect(text.length).toBeGreaterThan(1);
        expect(text.length).toBeLessThanOrEqual(24);
      }
    }
  });

  it('pemain perempuan disapa "Mbak"', () => {
    const texts = residents.map((resident) => greetingFor(resident, at(12), 1, 'f'));
    expect(texts.some((text) => text.includes('Mbak'))).toBe(true);
    expect(texts.every((text) => !text.includes('Mas'))).toBe(true);
  });

  it('hanya warga dalam jarak dan tidak dalam cooldown yang menyapa', () => {
    const always = () => 0;
    const list = [
      candidate(residents[0] as Resident, 2),
      candidate(residents[1] as Resident, GREET_DISTANCE + 1),
      candidate(residents[2] as Resident, 3, 100 - GREET_COOLDOWN / 2),
    ];
    const chosen = chooseGreetings(list, 100, at(7), always);
    expect(chosen.map((item) => item.resident.id)).toEqual([residents[0]?.id]);
  });

  it('terdekat didahulukan dan jumlah dibatasi', () => {
    const list = residents.slice(0, 8).map((resident, index) => candidate(resident, 5 - index * 0.5));
    const chosen = chooseGreetings(list, 50, at(12), () => 0);
    expect(chosen).toHaveLength(MAX_BUBBLES);
    expect(chosen[0]?.resident.id).toBe(residents[7]?.id);
    expect(chosen[0]?.until).toBeGreaterThan(50);
  });

  it('tidak ada yang menyapa kalau undian gagal', () => {
    expect(chooseGreetings([candidate(first, 1)], 10, at(12), () => 0.999)).toEqual([]);
  });
});

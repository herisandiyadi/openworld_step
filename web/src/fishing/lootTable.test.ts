import { describe, expect, it } from 'vitest';
import { DEFAULT_FISH_SPECIES, lootTable } from './lootTable';

/** Deterministic stream: returns the listed values in order, repeating the last one. */
const stream = (...values: number[]) => {
  let i = 0;
  return () => (i < values.length ? values[i++]! : values[values.length - 1]!);
};

describe('lootTable', () => {
  it('uses bait to raise the fish chance over the trash boundary', () => {
    // Without bait the fish chance is 55%: 0.55 lands on trash (boundary),
    // while baited fish chance 70% turns 0.69 into a fish.
    expect(lootTable({ bait: false, random: stream(0.55) }).kind).toBe('trash');
    expect(lootTable({ bait: true, random: stream(0.55) }).kind).toBe('fish');

    const baited = lootTable({ bait: true, random: stream(0.69) });
    expect(baited.kind).toBe('fish');
    expect(baited.species).toBeDefined();
    expect(baited.weight).toBeGreaterThanOrEqual(0.1);
  });

  it('applies the peak-hour bonus and the anti-farming penalty', () => {
    // Morning peak (05-08): base 55% + 10% = 65%, so 0.64 is a fish...
    expect(lootTable({ hour: 6, random: stream(0.64) }).kind).toBe('fish');
    // ...but the same roll at a farming-flagged spot (65% * 0.85 = 55.25%) misses.
    expect(lootTable({ hour: 6, catchesAtSpot: 11, random: stream(0.64) }).kind).toBe('trash');
    // Off-peak: 0.64 is above the plain 55%, so no fish.
    expect(lootTable({ hour: 12, random: stream(0.64) }).kind).toBe('trash');
  });

  it('biases fish weight toward the small end (r²) and rounds to 0.01 kg', () => {
    // First draw picks mujair (30%), second draw r=0.51: 0.1 + 0.5 * 0.51^2 = 0.23005.
    const caught = lootTable({ random: stream(0, 0.25, 0.51) });
    expect(caught.kind).toBe('fish');
    expect(caught.species).toBe('mujair');
    expect(caught.weight).toBe(0.23);
  });

  it('doubles lele odds at night', () => {
    // With the same species draw, daytime picks nila; at night the doubled lele
    // slice (0.36 of 1.18 total) crosses first.
    expect(lootTable({ hour: 12, random: stream(0), fishRandom: stream(0.5) }).species).toBe('nila');
    expect(lootTable({ hour: 23, random: stream(0), fishRandom: stream(0.5) }).species).toBe('lele');
  });

  it('exposes the lake species table from FISHING.md 4.2', () => {
    const patin = DEFAULT_FISH_SPECIES.find((s: { id: string }) => s.id === 'patin');
    expect(patin).toMatchObject({ chance: 0.02, minWeight: 2.0, maxWeight: 8.0, pricePerKg: 22, difficulty: 5 });
    expect(DEFAULT_FISH_SPECIES.reduce((sum: number, s: { chance: number }) => sum + s.chance, 0)).toBeCloseTo(1, 6);
  });

  it('matches documented probabilities within ±1% over 10000 simulated catches', () => {
    // FISHING.md gate F4/F6: 10.000 tangkapan sesuai peluang (toleransi ±1%).
    let a = 12345;
    const random = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const runs = 10_000;
    const counts = { fish: 0, can: 0, sandal: 0, boot: 0, underwear: 0 };
    for (let i = 0; i < runs; i += 1) {
      const caught = lootTable({ hour: 12, bait: false, random });
      if (caught.kind === 'fish') counts.fish += 1;
      else counts[caught.id as keyof typeof counts] += 1;
    }
    expect(Math.abs(counts.fish / runs - 0.55)).toBeLessThan(0.01);
    expect(Math.abs(counts.can / runs - 0.13)).toBeLessThan(0.01);
    expect(Math.abs(counts.sandal / runs - 0.12)).toBeLessThan(0.01);
    expect(Math.abs(counts.boot / runs - 0.10)).toBeLessThan(0.01);
    expect(Math.abs(counts.underwear / runs - 0.10)).toBeLessThan(0.01);
  });
});

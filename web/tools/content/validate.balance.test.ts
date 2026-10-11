/**
 * Tests for the FISHING.md F9 balance simulation (tools/content/simulate.ts),
 * exercised through validatePack so `content:check` fails on pathological packs.
 */

import { describe, expect, it } from 'vitest';
import { validatePack, type ValidationResult } from './validate';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validManifest = {
  id: 'base', version: '1.0.0', minAppVersion: '0.1.0', worldVersion: 2,
  files: [{ path: 'npcs.json', sha256: 'a'.repeat(64), size: 10 }],
};

const validEconomy = {
  currency: 'coins', dailyBonus: 20, busFare: 5,
  jobs: [
    { id: 'job_bengkel', title: 'Antar Suku Cadang', rewardCoins: 25, dailyLimit: 10, stepTypes: ['talk', 'reach', 'talk'] },
    { id: 'job_kurir', title: 'Kurir Paket', rewardCoins: 30, dailyLimit: 8, stepTypes: ['talk', 'reach', 'talk'] },
    { id: 'job_ojek', title: 'Ojek', rewardCoins: 20, dailyLimit: 12, stepTypes: ['talk', 'ride'] },
  ],
};

const validFishing = {
  biteWaitSeconds: { min: 3, max: 12 },
  hookWindowSeconds: 1.2,
  catches: [
    { id: 'fish', kind: 'fish', chance: 0.55 },
    { id: 'can', kind: 'trash', chance: 0.13 },
    { id: 'sandal', kind: 'trash', chance: 0.12 },
    { id: 'boot', kind: 'trash', chance: 0.1 },
    { id: 'underwear', kind: 'trash', chance: 0.1 },
  ],
  baitedCatches: [
    { id: 'fish', kind: 'fish', chance: 0.7 },
    { id: 'can', kind: 'trash', chance: 0.09 },
    { id: 'sandal', kind: 'trash', chance: 0.08 },
    { id: 'boot', kind: 'trash', chance: 0.07 },
    { id: 'underwear', kind: 'trash', chance: 0.06 },
  ],
  species: [
    { id: 'mujair', name: 'Mujair', chance: 0.3, minWeight: 0.1, maxWeight: 0.6, pricePerKg: 8, difficulty: 1 },
    { id: 'nila', name: 'Nila', chance: 0.28, minWeight: 0.2, maxWeight: 1.2, pricePerKg: 10, difficulty: 1 },
    { id: 'lele', name: 'Lele', chance: 0.18, minWeight: 0.3, maxWeight: 1.5, pricePerKg: 9, difficulty: 2 },
    { id: 'ikan_mas', name: 'Ikan mas', chance: 0.14, minWeight: 0.5, maxWeight: 3, pricePerKg: 14, difficulty: 2 },
    { id: 'gurame', name: 'Gurame', chance: 0.08, minWeight: 0.8, maxWeight: 4, pricePerKg: 18, difficulty: 3 },
    { id: 'patin', name: 'Patin', chance: 0.02, minWeight: 2, maxWeight: 8, pricePerKg: 22, difficulty: 3 },
  ],
  peakHours: [
    { from: 5, to: 8, fishChanceBonus: 0.1 },
    { from: 16, to: 18, fishChanceBonus: 0.1 },
  ],
  antiFarming: { catchesBeforePenalty: 10, fishChancePenalty: 0.15 },
  market: { fullPriceSalesPerSpecies: 10, discountPerExtraSale: 0.05, minimumMultiplier: 0.5 },
  bag: { capacities: [8, 14, 20], trashStackSize: 5 },
  disposal: { coinsPerTrash: 1, dailyCoinLimit: 30 },
};

function makeNpc(id: string, questGiver: string[] = []) {
  return { id, name: id, asset: 'npc_vendor', x: 0, z: 0, yaw: 0, region: 'downtown', dialogue: `dialogue/${id}.json`, questGiver };
}

function makeQuest(id: string, giverId: string, requires: string[] = []) {
  return {
    id, title: id, giver: giverId, requires, repeatable: false,
    steps: [{ type: 'talk', npc: giverId, text: 'hi' }],
    rewards: { coins: 10, items: [] },
  };
}

function makePack(fishing: unknown = validFishing, economy: unknown = validEconomy) {
  return {
    manifest: validManifest,
    npcs: [makeNpc('npc_budi', ['q_kenalan'])],
    quests: [makeQuest('q_kenalan', 'npc_budi')],
    regions: [{ id: 'downtown', name: 'Pusat Kota', bounds: { minX: -128, maxX: 128, minZ: -128, maxZ: 128 } }],
    shops: [],
    items: [],
    economy,
    fishing,
  };
}

/** Throws if the pack is expected to validate but does not. */
function expectValid(pack: ReturnType<typeof makePack>): ValidationResult {
  const result = validatePack(pack);
  if (!result.ok) {
    throw new Error(`expected a valid pack, got violations:\n${result.violations.map((v) => `  - ${v}`).join('\n')}`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) shared by the tests and the simulation default
// ---------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Tests — happy path first (guards false positives on the real pack)
// ---------------------------------------------------------------------------

describe('balance simulation — valid pack stays valid', () => {
  it('base pack passes the 10,000-catch balance simulation', () => {
    expectValid(makePack());
  });
});

// ---------------------------------------------------------------------------
// Tests — malformed fixtures
// ---------------------------------------------------------------------------

describe('balance simulation — malformed fixtures are rejected', () => {
  it('catch table without a fish entry', () => {
    const fishing = {
      ...validFishing,
      catches: [
        { id: 'can', kind: 'trash', chance: 0.6 },
        { id: 'sandal', kind: 'trash', chance: 0.4 },
      ],
    };
    const result = validatePack(makePack(fishing));
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => /fishing: .*no "fish" entry in "catches"/.test(v))).toBe(true);
  });

  it('fish chance that makes the loot table total exceed 1.0', () => {
    const fishing = { ...validFishing, baitedCatches: validFishing.baitedCatches.map((c) => c.id === 'fish' ? { ...c, chance: 0.95 } : c) };
    const result = validatePack(makePack(fishing));
    expect(result.ok).toBe(false);
    // Either the schema sum check or the balance simulation flags it; both must be actionable.
    expect(result.violations.some((v) => /total catch probability must be <= 1\.0|chances must sum to 1/.test(v))).toBe(true);
  });

  it('species table that does not sum to 1', () => {
    const fishing = { ...validFishing, species: validFishing.species.map((s) => s.id === 'patin' ? { ...s, chance: 0.5 } : s) };
    const result = validatePack(makePack(fishing));
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => /species chances must sum to 1/.test(v))).toBe(true);
  });

  it('species with inverted weight range', () => {
    const fishing = { ...validFishing, species: validFishing.species.map((s) => s.id === 'gurame' ? { ...s, minWeight: 4.1, maxWeight: 4 } : s) };
    const result = validatePack(makePack(fishing));
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => /fishing: "gurame": minWeight \(4\.1\) must be < maxWeight \(4\)/.test(v))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests — pathological balance
// ---------------------------------------------------------------------------

describe('balance simulation — pathological balance is rejected', () => {
  it('a species with an absurd price per kg breaks the income ceiling', () => {
    const fishing = { ...validFishing, species: validFishing.species.map((s) => s.id === 'patin' ? { ...s, pricePerKg: 1000 } : s) };
    const result = validatePack(makePack(fishing));
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => /breaks the income ceiling|median income per hour/.test(v))).toBe(true);
  });

  it('a species whose smallest catch is worth more than the peak-hour coin income', () => {
    const fishing = { ...validFishing, species: validFishing.species.map((s) => s.id === 'patin' ? { ...s, pricePerKg: 200, minWeight: 10, maxWeight: 12 } : s) };
    const result = validatePack(makePack(fishing));
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => /exceeds the .* income ceiling|income ceiling/.test(v))).toBe(true);
  });

  it('disposal reward far above the income ceiling breaks the trash economy', () => {
    const fishing = { ...validFishing, disposal: { ...validFishing.disposal, coinsPerTrash: 50 } };
    const result = validatePack(makePack(fishing));
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => /trash-disposal income .* exceeds|trash-disposal income .* breaks/.test(v))).toBe(true);
  });
});

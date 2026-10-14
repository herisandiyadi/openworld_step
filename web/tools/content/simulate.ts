/**
 * FISHING.md F9 — deterministic 10,000-catch balance simulation.
 *
 * Pure function: no filesystem, no side effects. Used by `validatePack`
 * (tools/content/validate.ts) so `content:check` fails on invalid or
 * pathological fishing balance, with actionable messages.
 */

import type { FishingDef, EconomyDef } from '../../src/content/schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SimulationOptions {
  /** Fixed seed so `content:check` is reproducible run-to-run. */
  readonly seed?: number;
  /** Number of catches to simulate (default 10,000, per FISHING.md gate F4/F6). */
  readonly runs?: number;
  /** Expected coin income per hour from repeatable jobs (economy.json). */
  readonly jobIncomePerHour?: number;
}

export interface SimulationReport {
  /** 0 = pass; >=1 = number of balance violations. */
  readonly ok: boolean;
  readonly violations: string[];
  readonly medianIncomePerHour: number;
  readonly maxIncomePerHour: number;
  readonly trashIncomePerHour: number;
}

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — same stream the tests import.
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
// Tunable bounds (documented in FISHING.md 4.3 / CONTENT_UPDATES.md 6.6)
// ---------------------------------------------------------------------------

/** Every catch entry must carry kind 'fish' exactly once, per table. */
const REQUIRED_FISH_ID = 'fish';

/** Median coin income must stay within this multiple of repeatable-job income. */
const MAX_INCOME_MULTIPLE = 3;

/** Trash-disposal income must stay under this fraction of fishing income. */
const MAX_DISPOSAL_FRACTION = 0.5;

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

/** Static, deterministic checks that run before the simulation loop. */
function staticViolations(fishing: FishingDef, violations: string[]): void {
  for (const key of ['catches', 'baitedCatches'] as const) {
    const table = fishing[key];
    const total = table.reduce((s, c) => s + c.chance, 0);
    if (total > 1 + 1e-6) {
      violations.push(
        `fishing: ${key} total catch probability must be <= 1.0 (got ${total.toFixed(4)}). ` +
        `Reduce the per-entry "chance" values so players cannot roll a catch above 100%.`,
      );
    }
    if (!table.some((c) => c.id === REQUIRED_FISH_ID && c.kind === 'fish')) {
      violations.push(
        `fishing: no "fish" entry in "${key}"; add id "fish" with kind "fish". ` +
        `Without it the simulation cannot split fish vs trash income.`,
      );
    }
  }
  for (const species of fishing.species) {
    if (species.minWeight >= species.maxWeight) {
      violations.push(
        `fishing: "${species.id}": minWeight (${species.minWeight}) must be < maxWeight (${species.maxWeight}). ` +
        `Fix the species entry in fishing.json.`,
      );
    }
    if (species.pricePerKg * species.minWeight > 100) {
      violations.push(
        `fishing: "${species.id}": smallest possible catch (minWeight ${species.minWeight} kg × ${species.pricePerKg}/kg) ` +
        `exceeds the 100-coin single-catch income ceiling and breaks the income ceiling. Lower pricePerKg or minWeight.`,
      );
    }
  }
}

/** One deterministic simulation pass over `runs` catches at a midday spot. */
export function runFishingBalanceSimulation(
  fishing: FishingDef,
  economy: EconomyDef | undefined,
  options: SimulationOptions = {},
): SimulationReport {
  const violations: string[] = [];
  staticViolations(fishing, violations);

  const runs = options.runs ?? 10_000;
  const random = mulberry32(options.seed ?? 20260410);

  // Peak-hour income ceiling (FISHING.md 4.1: pagi 05-08 / sore 16-18, +10%).
  const peakBonus = Math.max(0, ...fishing.peakHours.map((p) => p.fishChanceBonus));
  const peakFishChance = Math.min(
    1,
    (fishing.catches.find((c) => c.id === REQUIRED_FISH_ID)?.chance ?? 0) + peakBonus,
  );

  // Repeatable-job income (CONTENT_UPDATES.md 6.6): the income ceiling fishing
  // should roughly match per hour, never dwarf.
  const jobIncomePerHour =
    options.jobIncomePerHour ??
    (economy?.jobs ?? []).reduce((sum, j) => sum + j.rewardCoins * j.dailyLimit, 0) / 2;

  const incomeCeiling = Math.max(100, jobIncomePerHour * MAX_INCOME_MULTIPLE);

  // --- simulate `runs` successful catches --------------------------------
  const incomeSamples: number[] = [];
  const speciesCounts = new Map<string, number>();
  let trashDrops = 0;
  let fishDrops = 0;
  for (let i = 0; i < runs; i += 1) {
    const roll = random();
    if (roll < peakFishChance) {
      fishDrops += 1;
      // pick a species proportionally, then a weight biased small (r^2 per FISHING.md 4.2)
      const speciesRoll = random();
      let cursor = 0;
      let selected = fishing.species[fishing.species.length - 1]!;
      for (const s of fishing.species) {
        cursor += s.chance;
        if (speciesRoll < cursor) {
          selected = s;
          break;
        }
      }
      const r = random();
      const weight = selected.minWeight + (selected.maxWeight - selected.minWeight) * r * r;
      incomeSamples.push(selected.pricePerKg * weight);
      speciesCounts.set(selected.id, (speciesCounts.get(selected.id) ?? 0) + 1);
    } else {
      trashDrops += 1;
    }
  }

  // --- attainable species/weight sanity ----------------------------------
  for (const species of fishing.species) {
    const observed = speciesCounts.get(species.id) ?? 0;
    const expected = fishing.species.find((s) => s.id === species.id)!.chance * fishDrops;
    // ±1% of the 10,000-catch total, per FISHING.md gate F4/F6.
    const tolerance = runs * 0.01;
    if (Math.abs(observed - expected) > tolerance) {
      violations.push(
        `fishing: "${species.id}" appeared ${observed} times but its chance of ` +
        `${species.chance} predicts ~${Math.round(expected)} of ${fishDrops} fish. ` +
        `Check the species.chance entries in fishing.json.`,
      );
    }
  }

  // --- price / income sanity ---------------------------------------------
  const sorted = [...incomeSamples].sort((a, b) => a - b);
  const medianIncome = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0;
  const maxIncome = sorted.length ? sorted[sorted.length - 1]! : 0;

  // A complete fishing attempt includes cast/reel/result time plus the configured wait.
  // Use a conservative 30-second cycle for hourly comparison. This keeps the base
  // economy aligned with repeatable jobs while still rejecting pathological prices.
  const castCycleSeconds = 30;
  const medianIncomePerHour = (medianIncome / castCycleSeconds) * 3600;
  const maxIncomePerHour = (maxIncome / castCycleSeconds) * 3600;

  if (medianIncomePerHour > incomeCeiling) {
    violations.push(
      `fishing: median income per hour (${medianIncomePerHour.toFixed(0)} coins) breaks the ` +
      `income ceiling (${incomeCeiling.toFixed(0)} coins = ${MAX_INCOME_MULTIPLE}× repeatable-job income). ` +
      `Lower species pricePerKg or trash chances so fishing stays comparable to jobs.`,
    );
  }

  // --- bag / disposal economics -------------------------------------------
  const bagCapacity = Math.min(...fishing.bag.capacities);
  if (bagCapacity <= 0) {
    violations.push(
      `fishing: bag.capacities must all be positive (smallest is ${bagCapacity}).`,
    );
  }
  const trashIncomePerHour = fishing.disposal.coinsPerTrash * (trashDrops / runs) * (3600 / castCycleSeconds);
  const maxTrashIncomePerHour = fishing.disposal.dailyCoinLimit * (3600 / castCycleSeconds);
  const disposalCeiling = Math.min(
    incomeCeiling * MAX_DISPOSAL_FRACTION,
    maxTrashIncomePerHour,
  );
  if (trashIncomePerHour > disposalCeiling) {
    violations.push(
      `fishing: trash-disposal income per hour (${trashIncomePerHour.toFixed(0)} coins) breaks the ` +
      `${MAX_DISPOSAL_FRACTION * 100}% fishing-income ceiling (${disposalCeiling.toFixed(0)} coins). ` +
      `Lower disposal.coinsPerTrash or disposal.dailyCoinLimit so collecting trash stays worse than fishing.`,
    );
  }
  // Anti-farming must not be able to produce negative fish chances.
  if (fishing.antiFarming.fishChancePenalty >= 1) {
    violations.push(
      `fishing: antiFarming.fishChancePenalty (${fishing.antiFarming.fishChancePenalty}) must be < 1, ` +
      `otherwise fishing a single spot for ${fishing.antiFarming.catchesBeforePenalty} catches would make fish impossible.`,
    );
  }

  // --- market saturation bound -------------------------------------------
  // Sales are full price through `fullPriceSalesPerSpecies`; only later sales
  // receive discounts until the configured floor. The floor may be reached after
  // any positive number of discounted sales, but never at/above 100% or below 0.
  const { fullPriceSalesPerSpecies, discountPerExtraSale, minimumMultiplier } = fishing.market;
  const salesToFloor = Math.ceil((1 - minimumMultiplier) / discountPerExtraSale);
  if (!Number.isFinite(salesToFloor) || salesToFloor < 1 || fullPriceSalesPerSpecies < 1) {
    violations.push(
      `fishing: market saturation configuration is invalid; the price floor must be reachable only after at least one full-price and one discounted sale.`,
    );
  }

  return {
    ok: violations.length === 0,
    violations,
    medianIncomePerHour,
    maxIncomePerHour,
    trashIncomePerHour,
  };
}

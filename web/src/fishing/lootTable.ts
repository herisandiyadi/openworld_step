export type CatchKind = 'fish' | 'trash';

export interface FishSpecies {
  readonly id: string;
  readonly name: string;
  readonly chance: number;
  readonly minWeight: number;
  readonly maxWeight: number;
  readonly pricePerKg: number;
  readonly difficulty: number;
}

export interface FishingLoot {
  readonly kind: CatchKind;
  readonly id: string;
  readonly species?: string;
  readonly weight?: number;
}

export interface FishingLootConfig {
  readonly catches: readonly { id: string; kind: CatchKind; chance: number }[];
  readonly baitedCatches: readonly { id: string; kind: CatchKind; chance: number }[];
  readonly species: readonly FishSpecies[];
  readonly peakHours?: readonly { from: number; to: number; fishChanceBonus: number }[];
  readonly antiFarming?: { catchesBeforePenalty: number; fishChancePenalty: number };
}

export interface LootTableOptions {
  /** In-game hour, 0 <= hour < 24. */
  readonly hour?: number;
  readonly bait?: boolean;
  /** Number of successful catches already made at this spot. */
  readonly catchesAtSpot?: number;
  readonly random?: () => number;
  /** Separate random stream for species/weight; useful for deterministic callers. */
  readonly fishRandom?: () => number;
  /** Test and simulation hook; normal callers should omit it. */
  readonly forceKind?: CatchKind;
  readonly species?: readonly FishSpecies[];
  readonly config?: FishingLootConfig;
}

export const DEFAULT_FISH_SPECIES: readonly FishSpecies[] = [
  { id: 'mujair', name: 'Mujair', chance: 0.30, minWeight: 0.1, maxWeight: 0.6, pricePerKg: 8, difficulty: 1 },
  { id: 'nila', name: 'Nila', chance: 0.28, minWeight: 0.2, maxWeight: 1.2, pricePerKg: 10, difficulty: 1 },
  { id: 'lele', name: 'Lele', chance: 0.18, minWeight: 0.3, maxWeight: 1.5, pricePerKg: 9, difficulty: 2 },
  { id: 'ikan-mas', name: 'Ikan mas', chance: 0.14, minWeight: 0.5, maxWeight: 3.0, pricePerKg: 14, difficulty: 3 },
  { id: 'gurame', name: 'Gurame', chance: 0.08, minWeight: 0.8, maxWeight: 4.0, pricePerKg: 18, difficulty: 4 },
  { id: 'patin', name: 'Patin', chance: 0.02, minWeight: 2.0, maxWeight: 8.0, pricePerKg: 22, difficulty: 5 },
];

export const DEFAULT_TRASH: readonly { id: string; chance: number }[] = [
  { id: 'can', chance: 0.13 / 0.45 },
  { id: 'sandal', chance: 0.12 / 0.45 },
  { id: 'boot', chance: 0.10 / 0.45 },
  { id: 'underwear', chance: 0.10 / 0.45 },
];

/** Built-in loot-table shape matching the bundled content/fishing.json values. */
export const DEFAULT_CATCHES: readonly { id: string; kind: CatchKind; chance: number }[] = [
  { id: 'fish', kind: 'fish', chance: 0.55 },
  { id: 'can', kind: 'trash', chance: 0.13 },
  { id: 'sandal', kind: 'trash', chance: 0.12 },
  { id: 'boot', kind: 'trash', chance: 0.10 },
  { id: 'underwear', kind: 'trash', chance: 0.10 },
];

export const DEFAULT_BAITED_CATCHES: readonly { id: string; kind: CatchKind; chance: number }[] = [
  { id: 'fish', kind: 'fish', chance: 0.70 },
  { id: 'can', kind: 'trash', chance: 0.09 },
  { id: 'sandal', kind: 'trash', chance: 0.08 },
  { id: 'boot', kind: 'trash', chance: 0.07 },
  { id: 'underwear', kind: 'trash', chance: 0.06 },
];

export const DEFAULT_PEAK_HOURS: readonly { from: number; to: number; fishChanceBonus: number }[] = [
  { from: 5, to: 8, fishChanceBonus: 0.10 },
  { from: 16, to: 18, fishChanceBonus: 0.10 },
];

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const normalizedRandom = (random: () => number): number => clamp(random(), 0, 0.999999999999);

function weightedPick<T extends { chance: number }>(items: readonly T[], random: number): T {
  const total = items.reduce((sum, item) => sum + item.chance, 0);
  let cursor = random * total;
  for (const item of items) {
    cursor -= item.chance;
    if (cursor < 0) return item;
  }
  return items[items.length - 1] as T;
}

function isNight(hour: number): boolean {
  return hour < 5 || hour >= 19;
}

/** Selects the result of a successful fishing attempt. No UI or game state is involved. */
export function lootTable(options: LootTableOptions = {}): FishingLoot {
  const random = options.random ?? Math.random;
  const fishRandom = options.fishRandom ?? random;
  const hour = options.hour ?? 12;
  const baited = options.bait === true;
  const config = options.config;
  const baseFishChance = baited
    ? (config?.baitedCatches ?? DEFAULT_BAITED_CATCHES).find((entry) => entry.kind === 'fish')?.chance ?? 0.70
    : (config?.catches ?? DEFAULT_CATCHES).find((entry) => entry.kind === 'fish')?.chance ?? 0.55;
  const peakBonus = (config?.peakHours ?? DEFAULT_PEAK_HOURS).some((p) => hour >= p.from && hour < p.to)
    ? (config?.peakHours ?? DEFAULT_PEAK_HOURS).find((p) => hour >= p.from && hour < p.to)!.fishChanceBonus
    : 0;
  const antiFarmingMultiplier = (options.catchesAtSpot ?? 0) > (config?.antiFarming?.catchesBeforePenalty ?? 10)
    ? 1 - (config?.antiFarming?.fishChancePenalty ?? 0.15)
    : 1;
  const fishChance = clamp((baseFishChance + peakBonus) * antiFarmingMultiplier, 0, 1);

  let kind: CatchKind;
  if (options.forceKind) {
    kind = options.forceKind;
  } else {
    kind = normalizedRandom(random) < fishChance ? 'fish' : 'trash';
  }

  if (kind === 'trash') {
    const trashEntries = (baited ? config?.baitedCatches : config?.catches)?.filter(
      (entry): entry is { id: string; kind: 'trash'; chance: number } => entry.kind === 'trash',
    );
    const trash = weightedPick(trashEntries?.length ? trashEntries : DEFAULT_TRASH, normalizedRandom(fishRandom));
    return { kind, id: trash.id };
  }

  const species = options.species ?? config?.species ?? DEFAULT_FISH_SPECIES;
  const weightedSpecies = species.map((entry) => ({
    ...entry,
    chance: entry.chance * (isNight(hour) && entry.id === 'lele' ? 2 : 1),
  }));
  const selected = weightedPick(weightedSpecies, normalizedRandom(fishRandom));
  const r = normalizedRandom(fishRandom);
  const rawWeight = selected.minWeight + (selected.maxWeight - selected.minWeight) * r * r;
  return {
    kind,
    id: selected.id,
    species: selected.id,
    weight: Math.round(rawWeight * 100) / 100,
  };
}

export function fishSpecies(id: string, species: readonly FishSpecies[] = DEFAULT_FISH_SPECIES): FishSpecies | undefined {
  return species.find((entry) => entry.id === id);
}

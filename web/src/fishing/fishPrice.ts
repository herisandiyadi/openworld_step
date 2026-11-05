/** FISHING.md 4.3 — price formula and daily market saturation. */

export interface MarketConfig {
  /** Sales at full price per species per in-game day. */
  readonly fullPriceSalesPerSpecies: number;
  /** Price multiplier lost for each sale beyond the cap (0.05 = 5%). */
  readonly discountPerExtraSale: number;
  /** Saturation floor for the multiplier (0.5 = prices never drop below 50%). */
  readonly minimumMultiplier: number;
}

export interface MarketState {
  readonly config: MarketConfig;
  /** Current in-game day. Advancing it resets the per-species counters. */
  readonly dayIndex: number;
  /** Day the counters below belong to. */
  readonly salesDay: number;
  readonly salesBySpecies: Readonly<Record<string, number>>;
}

export function createMarket(config: MarketConfig, dayIndex = 0): MarketState {
  return { config, dayIndex, salesDay: dayIndex, salesBySpecies: {} };
}

/** Rolls the market into the day stored in `state.dayIndex` if a new day started. */
function currentDay(state: MarketState): MarketState {
  if (state.salesDay === state.dayIndex) return state;
  return { ...state, salesDay: state.dayIndex, salesBySpecies: {} };
}

export function recordSale(state: MarketState, speciesId: string): MarketState {
  const rolled = currentDay(state);
  const current = rolled.salesBySpecies[speciesId] ?? 0;
  return {
    ...rolled,
    salesBySpecies: { ...rolled.salesBySpecies, [speciesId]: current + 1 },
  };
}

function marketMultiplier(state: MarketState, speciesId: string): number {
  const { fullPriceSalesPerSpecies, discountPerExtraSale, minimumMultiplier } = state.config;
  const sold = currentDay(state).salesBySpecies[speciesId] ?? 0;
  if (sold < fullPriceSalesPerSpecies) return 1;
  const extra = sold - fullPriceSalesPerSpecies + 1;
  return Math.max(minimumMultiplier, 1 - extra * discountPerExtraSale);
}

/**
 * Computes the sell price of a single fish.
 * FISHING.md 4.3: `round(hargaPerKg × berat)`, minimum 1 coin,
 * times the daily saturation multiplier when a MarketState is provided.
 */
export function fishPrice(
  speciesId: string,
  weight: number,
  pricePerKg: number,
  market?: MarketState,
): number {
  const multiplier = market ? marketMultiplier(market, speciesId) : 1;
  return Math.max(1, Math.round(pricePerKg * weight * multiplier));
}

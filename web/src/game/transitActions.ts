import { contentRuntime } from '../app/contentRuntime';
import { useContentProgress } from '../state/contentProgress';
import { useGameStore } from '../state/gameStore';

const today = (): string => new Date().toISOString().slice(0, 10);

/** Configured bus fare; 0 when the economy pack is unavailable (free transit fallback). */
export function configuredBusFare(): number {
  return contentRuntime.economy?.busFare ?? 0;
}

/**
 * Charges the bus fare before a ride starts. Uses the contentProgress ledger so
 * every trip is auditable. Returns false (and blocks the ride) when the player
 * cannot afford it; a valid day pass rides for free.
 */
export function payBusFare(fare = configuredBusFare()): boolean {
  if (fare <= 0) return true;
  return useContentProgress.getState().rideBusWithFare(fare, today());
}

/** Buys the day pass at its configured price. */
export function buyDayPassAction(price = 30): boolean {
  return useContentProgress.getState().buyTransitDayPass(price, today());
}

/** Marks a paid ride as started (called by the bus menu after payBusFare succeeds). */
export function markRideStarted(): void {
  if (useGameStore.getState().busRide) return;
  useGameStore.setState({ busRide: { phase: 'menunggu', nextStopId: '', destinationId: '', progress: 0, eta: 0 } });
}

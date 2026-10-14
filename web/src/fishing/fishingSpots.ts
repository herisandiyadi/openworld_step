export interface SpotReservation {
  readonly playerId: string;
  readonly heartbeatAt: number;
}

export type FishingSpotReservations = Readonly<Record<string, SpotReservation>>;

/** Host-owned registry. All operations return a fresh value for predictable replication. */
export function createSpotReservations(): FishingSpotReservations {
  return {};
}

export function reservationOwner(
  reservations: FishingSpotReservations,
  spotId: string,
): string | null {
  return reservations[spotId]?.playerId ?? null;
}

export function isSpotReserved(reservations: FishingSpotReservations, spotId: string): boolean {
  return reservations[spotId] !== undefined;
}

/**
 * Claims an empty spot, or refreshes the current owner's heartbeat.
 * A conflicting claim is rejected by returning the unchanged registry.
 */
export function reserveSpot(
  reservations: FishingSpotReservations,
  spotId: string,
  playerId: string,
  now: number,
): FishingSpotReservations {
  if (!spotId || !playerId || !Number.isFinite(now)) return reservations;
  const current = reservations[spotId];
  if (current && current.playerId !== playerId) return reservations;
  return { ...reservations, [spotId]: { playerId, heartbeatAt: now } };
}

/** Pass no playerId only for host eviction of an expired/disconnected owner. */
export function releaseSpot(
  reservations: FishingSpotReservations,
  spotId: string,
  playerId?: string,
): FishingSpotReservations {
  const current = reservations[spotId];
  if (!current || (playerId !== undefined && current.playerId !== playerId)) return reservations;
  const next = { ...reservations };
  delete next[spotId];
  return next;
}

/** Returns ids whose owner has not refreshed within ttlMs (default 5 s). */
export function staleSpotsOf(
  reservations: FishingSpotReservations,
  now: number,
  ttlMs = 5000,
): string[] {
  if (!Number.isFinite(now) || ttlMs < 0) return [];
  return Object.entries(reservations)
    .filter(([, reservation]) => now - reservation.heartbeatAt >= ttlMs)
    .map(([spotId]) => spotId);
}

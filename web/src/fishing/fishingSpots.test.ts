import { describe, expect, it } from 'vitest';
import {
  createSpotReservations,
  reserveSpot,
  releaseSpot,
  isSpotReserved,
  staleSpotsOf,
} from './fishingSpots';

describe('fishing spot reservation', () => {
  it('starts empty — no spots are reserved', () => {
    const r = createSpotReservations();
    expect(isSpotReserved(r, 'spot-1')).toBe(false);
  });

  it('reserves a spot for a player and returns the updated registry', () => {
    const r0 = createSpotReservations();
    const r1 = reserveSpot(r0, 'spot-1', 'player-A', 1000);
    expect(isSpotReserved(r1, 'spot-1')).toBe(true);
    // Different spot still free
    expect(isSpotReserved(r1, 'spot-2')).toBe(false);
  });

  it('releasing a spot makes it available again', () => {
    const r0 = createSpotReservations();
    const r1 = reserveSpot(r0, 'spot-1', 'player-A', 1000);
    const r2 = releaseSpot(r1, 'spot-1', 'player-A');
    expect(isSpotReserved(r2, 'spot-1')).toBe(false);
  });

  it('only the owner can release a reservation; non-owners are ignored', () => {
    const r0 = createSpotReservations();
    const r1 = reserveSpot(r0, 'spot-1', 'player-A', 1000);
    const r2 = releaseSpot(r1, 'spot-1', 'player-B');
    expect(isSpotReserved(r2, 'spot-1')).toBe(true);
  });

  it('re-reserving a spot by the same player updates the timestamp', () => {
    const r0 = createSpotReservations();
    const r1 = reserveSpot(r0, 'spot-1', 'player-A', 1000);
    const r2 = reserveSpot(r1, 'spot-1', 'player-A', 9999);
    const stale = staleSpotsOf(r2, 5000);
    // Should NOT be stale because refreshed to 9999
    expect(stale).not.toContain('spot-1');
  });

  it('reports spots whose heartbeat is older than the TTL as stale', () => {
    const r0 = createSpotReservations();
    const r1 = reserveSpot(r0, 'spot-1', 'player-A', 1000);
    const stale = staleSpotsOf(r1, 6000);
    expect(stale).toContain('spot-1');
    const notStale = staleSpotsOf(r1, 4000);
    expect(notStale).not.toContain('spot-1');
  });

  it('does not mutate the input registry object', () => {
    const r0 = createSpotReservations();
    const copy = structuredClone(r0);
    reserveSpot(r0, 'spot-1', 'player-A', 1000);
    expect(r0).toEqual(copy);
  });

  it('allows a new player to claim a spot after the previous reservation expires', () => {
    const r0 = createSpotReservations();
    const r1 = reserveSpot(r0, 'spot-1', 'player-A', 1000);
    // Simulate eviction of stale entry before re-reservation
    const staleIds = staleSpotsOf(r1, 6000);
    let r2 = r1;
    for (const id of staleIds) r2 = releaseSpot(r2, id, undefined);
    const r3 = reserveSpot(r2, 'spot-1', 'player-B', 7000);
    expect(isSpotReserved(r3, 'spot-1')).toBe(true);
  });
});

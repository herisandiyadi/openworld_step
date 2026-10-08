import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useGameStore, NO_NEARBY } from '../state/gameStore';
import { useContentProgress } from '../state/contentProgress';
import {
  startFishing,
  cancelFishing,
  pullFishing,
  releaseFishingResult,
  canStartFishing,
  fishPriceFor,
  updateFishing,
  setFishingMultiplayerBridge,
} from './fishingActions';
import { contentRuntime } from '../app/contentRuntime';
import type { FishingDef } from '../content/loader';

const spot = { id: 'spot_1', x: 10, z: 10, yaw: 0, water: 'lake' as const };

describe('fishingActions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    useGameStore.setState({
      nearby: { ...NO_NEARBY, fishingSpotId: spot.id },
      fishing: null,
      mode: 'walk',
    });
    useContentProgress.setState({ bag: { capacity: 8, trashStackSize: 5, items: [] }, quests: [] });
  });

  it('starts a session when a fishing spot is nearby and walking', () => {
    startFishing();
    expect(useGameStore.getState().fishing).not.toBeNull();
    expect(useGameStore.getState().fishing?.spotId).toBe(spot.id);
  });

  it('does not start a session without a nearby spot', () => {
    useGameStore.setState({ nearby: { ...NO_NEARBY } });
    expect(canStartFishing()).toBe(false);
    startFishing();
    expect(useGameStore.getState().fishing).toBeNull();
  });

  it('does not start while riding a vehicle', () => {
    useGameStore.setState({ mode: 'moto' });
    expect(canStartFishing()).toBe(false);
  });

  it('pulls during the bite window and stores a caught fish in the bag on release', () => {
    // Deterministic: force a fish catch.
    startFishing({ rng: () => 0.1, now: () => Date.now() });
    cancelFishing();
    expect(useGameStore.getState().fishing?.phase).toBe('result');
    releaseFishingResult();
    expect(useGameStore.getState().fishing).toBeNull();
  });

  it('cancels an active session', () => {
    startFishing();
    cancelFishing();
    expect(useGameStore.getState().fishing?.outcome).toBe('cancelled');
    releaseFishingResult();
    expect(useGameStore.getState().fishing).toBeNull();
  });

  it('pullFishing is a no-op when no session is active', () => {
    expect(() => pullFishing()).not.toThrow();
    expect(useGameStore.getState().fishing).toBeNull();
  });
});

describe('fishingActions with contentRuntime.fishing', () => {
  const FISHING_DEF = {
    biteWaitSeconds: { min: 3, max: 12 },
    hookWindowSeconds: 1.2,
    catches: [{ id: 'fish', kind: 'fish', chance: 0.55 }],
    baitedCatches: [{ id: 'fish', kind: 'fish', chance: 0.7 }],
    species: [
      { id: 'cumi', name: 'Cumi', chance: 1, minWeight: 0.2, maxWeight: 0.5, pricePerKg: 40, difficulty: 2 },
    ],
    peakHours: [],
    antiFarming: { catchesBeforePenalty: 10, fishChancePenalty: 0.15 },
    market: { fullPriceSalesPerSpecies: 10, discountPerExtraSale: 0.05, minimumMultiplier: 0.5 },
    bag: { capacities: [8], trashStackSize: 5 },
    disposal: { coinsPerTrash: 1, dailyCoinLimit: 30 },
  } as unknown as FishingDef;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    useGameStore.setState({
      nearby: { ...NO_NEARBY, fishingSpotId: spot.id },
      fishing: null,
      mode: 'walk',
    });
    useContentProgress.setState({ bag: { capacity: 8, trashStackSize: 5, items: [] }, quests: [] });
  });

  afterEach(() => {
    contentRuntime.fishing = null;
    setFishingMultiplayerBridge(null);
  });

  it('uses content species for loot when contentRuntime.fishing exists', () => {
    contentRuntime.fishing = FISHING_DEF;
    startFishing({ rng: () => 0.1 });
    let session = useGameStore.getState().fishing;
    // cast -> wait -> bite (past the 12 s max wait so the wait roll is irrelevant)
    session = updateFishing(Date.now() + 800);
    session = updateFishing(Date.now() + 800 + 12_500);
    expect(session?.phase).toBe('bite');
    // Pull at the start of the bite window: the fish weight roll r=0 gives the minimum weight.
    session = updateFishing(Date.now() + 800 + 12_500 + 1, true);
    expect(session?.phase).toBe('reel');
    expect(session?.pendingLoot?.kind).toBe('fish');
    expect(session?.pendingLoot?.species).toBe('cumi');
    expect(session?.pendingLoot?.weight).toBe(0.2);
  });

  it('falls back to DEFAULT_FISH_SPECIES when contentRuntime.fishing is null', () => {
    contentRuntime.fishing = null;
    startFishing({ rng: () => 0.1 });
    updateFishing(Date.now() + 800);
    const session = updateFishing(Date.now() + 800 + 12_500, true);
    expect(session?.pendingLoot?.kind).toBe('fish');
    expect(session?.pendingLoot?.species).toBe('mujair');
  });

  it('prices fish with contentRuntime species instead of defaults', () => {
    contentRuntime.fishing = FISHING_DEF;
    expect(fishPriceFor({ species: 'cumi', weight: 2 })).toBe(80);
  });

  it('reserves the spot on start so a second concurrent start fails', () => {
    expect(startFishing()).toBe(true);
    expect(startFishing()).toBe(false);
    expect(useGameStore.getState().fishing?.spotId).toBe(spot.id);
  });

  it('releases the reservation when the result is released so the spot can be reused', () => {
    startFishing();
    cancelFishing();
    releaseFishingResult();
    expect(useGameStore.getState().fishing).toBeNull();
    expect(startFishing()).toBe(true);
  });

  it('releases the reservation once when an attempt reaches result', () => {
    const release = vi.fn();
    setFishingMultiplayerBridge({ playerId: 'player-a', reserve: () => true, release });
    startFishing({ rng: () => 0 });
    updateFishing(800);
    updateFishing(4000);
    expect(updateFishing(5300)?.phase).toBe('result');
    expect(release).toHaveBeenCalledTimes(1);
    releaseFishingResult();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('does not start when the multiplayer host rejects the spot reservation', () => {
    setFishingMultiplayerBridge({ playerId: 'player-b', reserve: () => false, release: () => undefined });
    expect(startFishing()).toBe(false);
    expect(useGameStore.getState().fishing).toBeNull();
  });

  it('releases the reservation on cancel while keeping the result visible', () => {
    const released: string[] = [];
    setFishingMultiplayerBridge({
      playerId: 'player-a',
      reserve: () => true,
      release: (spotId) => released.push(spotId),
    });
    startFishing();
    cancelFishing();
    expect(useGameStore.getState().fishing?.phase).toBe('result');
    expect(released).toEqual([spot.id]);
    expect(startFishing()).toBe(false);
  });
});

import { contentRuntime } from '../app/contentRuntime';
import type { FishingMultiplayerBridge } from '../fishing/fishingMultiplayerBridge';
import {
  advanceFishingSession,
  cancelFishingSession,
  createFishingSession,
  type FishingCallbacks,
  type FishingSession,
} from '../fishing/FishingController';
import type { FishingLoot } from '../fishing/lootTable';
import { fishSpecies, type FishingLootConfig } from '../fishing/lootTable';
import { createFishingVibrator } from '../fishing/fishingHaptics';
import {
  createSpotReservations,
  releaseSpot,
  reserveSpot,
  type FishingSpotReservations,
} from '../fishing/fishingSpots';
import { useContentProgress } from '../state/contentProgress';
import { useFishingAccessibility } from '../state/fishingAccessibility';
import { useGameStore } from '../state/gameStore';
import { findStreamedFishingSpot } from '../world/worldState';
import { dayClock, playerState } from './runtime';
import { routeQuestEvent } from './questRuntime';

const DEFAULT_NOW = (): number => Date.now();
const DEFAULT_RNG = (): number => Math.random();
const DEFAULT_VIBRATE = createFishingVibrator();

let spotReservations: FishingSpotReservations = createSpotReservations();
const activeReservedSpots = new Set<string>();

const LOCAL_PLAYER_ID = 'local';

let multiplayerBridge: FishingMultiplayerBridge | null = null;

/** Net runtime currently has no custom-data channel; install an adapter when one is available. */
export function setFishingMultiplayerBridge(bridge: FishingMultiplayerBridge | null): void {
  if (bridge === null) activeReservedSpots.clear();
  multiplayerBridge = bridge;
}

function reserveFishingSpot(spotId: string, now: number): boolean {
  if (multiplayerBridge) {
    if (activeReservedSpots.has(spotId)) return false;
    const ok = multiplayerBridge.reserve(spotId, now);
    if (ok) activeReservedSpots.add(spotId);
    return ok;
  }
  const next = reserveSpot(spotReservations, spotId, LOCAL_PLAYER_ID, now);
  if (next === spotReservations) return false;
  spotReservations = next;
  activeReservedSpots.add(spotId);
  return true;
}

function releaseFishingSpot(spotId: string): void {
  if (!activeReservedSpots.has(spotId)) return;
  activeReservedSpots.delete(spotId);
  if (multiplayerBridge) multiplayerBridge.release(spotId);
  else spotReservations = releaseSpot(spotReservations, spotId, LOCAL_PLAYER_ID);
}

function publishFishing(session: FishingSession | null): void {
  multiplayerBridge?.publish?.(session);
}

function currentSpot() {
  const id = useGameStore.getState().nearby.fishingSpotId;
  return id ? findStreamedFishingSpot(id) ?? null : null;
}

function callbacks(overrides: Partial<FishingCallbacks> = {}): FishingCallbacks {
  return {
    now: overrides.now ?? DEFAULT_NOW,
    rng: overrides.rng ?? DEFAULT_RNG,
    vibrate: overrides.vibrate ?? DEFAULT_VIBRATE,
    playSound: overrides.playSound ?? (() => undefined),
  };
}

export function canStartFishing(): boolean {
  const state = useGameStore.getState();
  return state.mode === 'walk' && state.fishing === null && state.nearby.fishingSpotId !== null && !state.seated && !state.busRide && !state.paused && !state.mapOpen;
}

/** Starts fishing; world metadata is optional so a missing index fails gracefully. */
export function startFishing(overrides: Partial<FishingCallbacks> = {}): boolean {
  if (!canStartFishing()) return false;
  const state = useGameStore.getState();
  const spot = currentSpot();
  const spotId = state.nearby.fishingSpotId;
  if (!spotId || !spot) return false;
  const sideEffects = callbacks(overrides);
  // Clear a stale local claim left by a previous terminal session; active sessions
  // remain protected by canStartFishing before this point.
  spotReservations = releaseSpot(spotReservations, spotId, LOCAL_PLAYER_ID);
  if (!reserveFishingSpot(spotId, sideEffects.now())) return false;
  // Rotate toward the actual water cast target BEFORE session activates the movement lock,
  // so the locked heading is correct for the cast animation. Convention: forward = (-sin h, -cos h).
  const castTargetX = spot.x - Math.sin(spot.yaw) * 3.2;
  const castTargetZ = spot.z - Math.cos(spot.yaw) * 3.2;
  if (castTargetX !== playerState.x || castTargetZ !== playerState.z) {
    playerState.heading = Math.atan2(-(castTargetX - playerState.x), -(castTargetZ - playerState.z));
  }
  playerState.target = null;
  playerState.path = [];
  const content = useContentProgress.getState();
  const hour = dayClock.t * 24;
  const fishingConfig: FishingLootConfig | undefined = contentRuntime.fishing
    ? {
        catches: contentRuntime.fishing.catches,
        baitedCatches: contentRuntime.fishing.baitedCatches,
        species: contentRuntime.fishing.species,
        peakHours: contentRuntime.fishing.peakHours,
        antiFarming: contentRuntime.fishing.antiFarming,
      }
    : undefined;
  const session = createFishingSession({
    spotId,
    spot,
    hour,
    // F3 accessibility preference (Settings → Kontrol) drives the minigame difficulty.
    easyMode: useFishingAccessibility.getState().settings.easyMode,
    carbonRod: content.inventory.equipped.tool === 'fishing_rod_carbon',
    bait: content.inventory.equipped.tool?.startsWith('bait_') ?? false,
    ...(fishingConfig ? { fishingConfig } : {}),
    callbacks: sideEffects,
  });
  useGameStore.setState({
    fishing: session,
    nearby: { ...state.nearby, vehicleId: null, seatId: null },
  });
  publishFishing(session);
  return true;
}

export function updateFishing(now = Date.now(), pulling = false): FishingSession | null {
  const session = useGameStore.getState().fishing;
  if (!session) return null;
  const next = advanceFishingSession(session, { now, pull: pulling });
  useGameStore.setState({ fishing: next });
  publishFishing(next);
  if (next.phase === 'result' && session.phase !== 'result') {
    releaseFishingSpot(session.spotId);
    if (next.outcome === 'caught' && next.loot) onFishingLoot(next.loot);
  }
  return next;
}

function onFishingLoot(loot: FishingLoot): void {
  const progress = useContentProgress.getState();
  const item = loot.kind === 'fish'
    ? { id: `${loot.id}-${Date.now()}`, kind: 'fish' as const, species: loot.species ?? loot.id, weight: loot.weight ?? 0, qty: 1 }
    : { id: loot.id, kind: 'trash' as const, trashType: loot.id, qty: 1 };
  if (progress.addFishToBag(item)) {
    routeQuestEvent({ type: 'catch', ...(loot.kind === 'fish' ? { species: loot.species ?? loot.id, weight: loot.weight } : {}), quantity: 1 });
  }
}

export function pullFishing(): FishingSession | null {
  return updateFishing(Date.now(), true);
}

export function cancelFishing(): void {
  const session = useGameStore.getState().fishing;
  if (!session) return;
  const cancelled = cancelFishingSession(session);
  releaseFishingSpot(session.spotId);
  useGameStore.setState({ fishing: cancelled });
  publishFishing(cancelled);
}

export function releaseFishingResult(): void {
  const session = useGameStore.getState().fishing;
  if (session?.phase !== 'result') return;
  releaseFishingSpot(session.spotId);
  useGameStore.setState({ fishing: null });
  publishFishing(null);
}

export function fishPriceFor(item: { species?: string; weight?: number }): number {
  const species = fishSpecies(item.species ?? '', contentRuntime.fishing?.species);
  return species ? Math.max(1, Math.round(species.pricePerKg * (item.weight ?? 0))) : 1;
}

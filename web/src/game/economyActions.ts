import { useContentProgress } from '../state/contentProgress';
import { useGameStore } from '../state/gameStore';
import type { StoreItem } from '../economy/store';
import type { BagItem } from '../economy/bag';
import { worldState } from '../world/worldState';
import { contentRuntime } from '../app/contentRuntime';
import { routeQuestEvent } from './questRuntime';
import { collected } from '../quest/questEvents';

const today = (): string => new Date().toISOString().slice(0, 10);

/** Store item definition from the content pack, with a graceful fallback. */
function storeItemFor(id: string): StoreItem | null {
  const def = contentRuntime.registry?.getItem(id);
  if (!def) return null;
  return { id: def.id, name: def.name, category: def.category, price: def.price, retired: def.retired, ...(def.unlockAfter ? { unlockAfter: def.unlockAfter } : {}) };
}

export function openNearbyShop(): boolean {
  const state = useGameStore.getState();
  if (!state.nearby.shopId) return false;
  useGameStore.setState({ economyScreen: 'shop', activeShopId: state.nearby.shopId });
  return true;
}

export function openNearbyBag(): void {
  useGameStore.setState({ economyScreen: 'bag', activeShopId: null });
}

export function openNearbyStall(): boolean {
  if (!useGameStore.getState().nearby.fishStallId) return false;
  useGameStore.setState({ economyScreen: 'stall', activeShopId: null });
  return true;
}

export function closeEconomy(): void {
  useGameStore.setState({ economyScreen: null, activeShopId: null });
}

/** Buys one content item by id (used by ShopScreen.onBuy). */
export function buyItemById(id: string): boolean {
  if (!useGameStore.getState().nearby.shopId) return false;
  const item = storeItemFor(id);
  if (!item) return false;
  const purchased = useContentProgress.getState().purchaseStoreItem(item);
  if (purchased) routeQuestEvent(collected(item.id));
  return purchased;
}

export function buyNearbyItem(item: StoreItem): boolean {
  if (!useGameStore.getState().nearby.shopId) return false;
  const purchased = useContentProgress.getState().purchaseStoreItem({ id: item.id, category: item.category, retired: item.retired, price: item.price });
  if (purchased) routeQuestEvent(collected(item.id));
  return purchased;
}

export function equipItemById(itemId: string): void {
  useContentProgress.getState().equipStoreItem(itemId);
}

/** Disposes trash at a bin; awards quest event on success. */
export function disposeNearbyTrash(): number {
  const state = useGameStore.getState();
  if (!state.nearby.trashBinId) return 0;
  const fishing = contentRuntime.fishing;
  const coinsPerTrash = fishing?.disposal.coinsPerTrash ?? 1;
  const dailyLimit = fishing?.disposal.dailyCoinLimit ?? 30;
  const result = useContentProgress.getState().disposeBagTrash(true, today(), coinsPerTrash, dailyLimit);
  if (result.qty > 0) routeQuestEvent({ type: 'dispose', quantity: result.qty });
  return result.coins;
}

export function sellAtNearbyStall(ids: readonly string[]): number {
  if (!useGameStore.getState().nearby.fishStallId) return 0;
  return useContentProgress.getState().sellBagFish(ids, fishPriceOf);
}

export function fishPriceOf(item: BagItem): number {
  const speciesId = item.species ?? '';
  const species = contentRuntime.fishing?.species.find((entry) => entry.id === speciesId);
  const pricePerKg = species?.pricePerKg ?? 1;
  return Math.max(1, Math.round(pricePerKg * (item.weight ?? 0)));
}

/** Bag capacity from the equipped bag item, clamped to the fishing config. */
export function bagCapacityFor(): number {
  const equipped = useContentProgress.getState().inventory.equipped.tool;
  const capacities = contentRuntime.fishing?.bag.capacities ?? [8, 14, 20];
  if (equipped === 'bag_carrier') return capacities[2] ?? 20;
  if (equipped === 'bag_ransel') return capacities[1] ?? 14;
  return capacities[0] ?? 8;
}

/** Nearby water check for releasing fish (falls back to false when metadata is missing). */
export function nearWater(): boolean {
  const spots = (worldState.index as { fishingSpots?: unknown[] } | null)?.fishingSpots;
  return Array.isArray(spots) && spots.length > 0;
}

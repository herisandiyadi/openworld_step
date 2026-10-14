import { describe, it, expect, beforeEach } from 'vitest';
import { useContentProgress } from '../state/contentProgress';
import { useGameStore, NO_NEARBY } from '../state/gameStore';
import { buyNearbyItem, equipItemById, disposeNearbyTrash, sellAtNearbyStall, openNearbyShop, openNearbyBag, closeEconomy } from './economyActions';
import { initQuests, resetQuestRuntime } from './questRuntime';
import { loadContentPack } from '../content/loader';
import type { StoreItem } from '../economy/store';
import baseManifest from '../../content/base/manifest.json';
import baseNpcs from '../../content/base/npcs.json';
import baseQuests from '../../content/base/quests.json';
import baseRegions from '../../content/base/regions.json';
import baseShops from '../../content/base/shops.json';
import baseItems from '../../content/base/items.json';

const item: StoreItem = { id: 'tool_1', name: 'Alat', category: 'tool', price: 5, retired: false };

function reg() {
  return loadContentPack({ manifest: baseManifest, npcs: baseNpcs, quests: baseQuests, regions: baseRegions, shops: baseShops, items: baseItems }).registry;
}

describe('economyActions', () => {
  beforeEach(() => {
    resetQuestRuntime();
    useGameStore.setState({ nearby: { ...NO_NEARBY }, economyScreen: null, activeShopId: null });
    useContentProgress.setState({ coins: 10, ledger: [], inventory: { owned: [], equipped: {} }, bag: { capacity: 8, trashStackSize: 5, items: [] }, disposeCoinsToday: 0, quests: [] });
  });
  it('opens context screens', () => {
    useGameStore.setState({ nearby: { ...NO_NEARBY, shopId: 'shop_1' } });
    expect(openNearbyShop()).toBe(true);
    expect(useGameStore.getState().economyScreen).toBe('shop');
    openNearbyBag();
    expect(useGameStore.getState().economyScreen).toBe('bag');
    closeEconomy();
    expect(useGameStore.getState().economyScreen).toBeNull();
  });
  it('buys and equips an item through contentProgress', () => {
    expect(buyNearbyItem(item)).toBe(false); // no shop metadata
    useGameStore.setState({ nearby: { ...NO_NEARBY, shopId: 'shop_1' } });
    expect(buyNearbyItem(item)).toBe(true);
    expect(useContentProgress.getState().coins).toBe(5);
    equipItemById(item.id);
    expect(useContentProgress.getState().inventory.equipped.tool).toBe(item.id);
  });
  it('disposes and sells only in the matching context', () => {
    expect(disposeNearbyTrash()).toBe(0);
    expect(sellAtNearbyStall([])).toBe(0);
  });
  it('emits collect event after successful purchase', () => {
    initQuests(reg());
    // q_belajar_mancing step 1 is collect fishing_rod_bamboo
    useContentProgress.setState({ quests: [{ questId: 'q_belajar_mancing', status: 'active', step: 1, progress: [{ current: 1, required: 1 }, { current: 0, required: 1 }, { current: 0, required: 1 }, { current: 0, required: 1 }, { current: 0, required: 1 }], completions: 0 }], coins: 100 });
    useGameStore.setState({ nearby: { ...NO_NEARBY, shopId: 'shop_pak_darto' } });
    const rod: StoreItem = { id: 'fishing_rod_bamboo', name: 'Joran Bambu', category: 'tool', price: 0, retired: false };
    expect(buyNearbyItem(rod)).toBe(true);
    const state = useContentProgress.getState().quests.find((q) => q.questId === 'q_belajar_mancing')!;
    expect(state.step).toBe(2);
    expect(state.progress[1]).toEqual({ current: 1, required: 1 });
  });
});

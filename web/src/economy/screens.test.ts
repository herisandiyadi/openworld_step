import { describe, expect, it } from 'vitest';
import { availableShopItems, canBuyShopItem, selectedShopItemIds } from './ShopScreen';
import { bagSummary, fishItems, trashItems } from './BagPanel';
import { fishStallTotal, selectableFish } from './FishStallScreen';
import type { Bag } from './bag';
import type { StoreItem } from './store';

const items: readonly StoreItem[] = [
  { id: 'paint_blue', name: 'Blue Paint', category: 'vehicle_paint', price: 10, retired: false },
  { id: 'old_hat', name: 'Old Hat', category: 'clothing', price: 5, retired: true },
  { id: 'locked_rod', name: 'Rod', category: 'tool', price: 20, retired: false, unlockAfter: 'q_fishing' },
];
const bag: Bag = {
  capacity: 8,
  trashStackSize: 5,
  items: [
    { id: 'fish-1', kind: 'fish', species: 'nila', weight: 0.8, qty: 1 },
    { id: 'can-1', kind: 'trash', trashType: 'can', qty: 2 },
    { id: 'rod', kind: 'tool', qty: 1 },
  ],
};

describe('economy screen logic', () => {
  it('filters retired shop items and preserves content order', () => {
    expect(availableShopItems(items)).toEqual([items[0], items[2]]);
  });

  it('only permits a visible unlocked item that is affordable and not owned', () => {
    expect(canBuyShopItem(items[0]!, 10, [], [])).toBe(true);
    expect(canBuyShopItem(items[0]!, 10, ['paint_blue'], [])).toBe(false);
    expect(canBuyShopItem(items[2]!, 100, [], [])).toBe(false);
    expect(canBuyShopItem(items[2]!, 100, [], ['q_fishing'])).toBe(true);
  });

  it('selects owned shop items by category', () => {
    expect(selectedShopItemIds(items, ['paint_blue'], 'vehicle_paint')).toEqual(['paint_blue']);
  });

  it('summarizes bag slots and separates fish, trash, and tools', () => {
    expect(bagSummary(bag)).toEqual({ used: 2, capacity: 8, label: '2/8' });
    expect(fishItems(bag).map((item) => item.id)).toEqual(['fish-1']);
    expect(trashItems(bag).map((item) => item.id)).toEqual(['can-1']);
  });

  it('totals only selected fish at the supplied prices', () => {
    expect(selectableFish(bag).map((item) => item.id)).toEqual(['fish-1']);
    expect(fishStallTotal(bag, ['fish-1'], (item) => item.id === 'fish-1' ? 9 : 0)).toBe(9);
    expect(fishStallTotal(bag, ['can-1'], () => 99)).toBe(0);
  });
});

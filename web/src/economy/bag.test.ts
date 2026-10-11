import { describe, expect, it } from 'vitest';
import {
  addBagItem,
  bagSlotsUsed,
  createBag,
  disposeTrash,
  releaseFish,
  sellFish,
  type BagItem,
} from './bag';

const fish = (id: string, species = 'mujair', weight = 0.35): BagItem => ({
  id,
  kind: 'fish',
  species,
  weight,
  qty: 1,
});
const trash = (id: string, trashType = 'can', qty = 1): BagItem => ({
  id,
  kind: 'trash',
  trashType,
  qty,
});

describe('bag', () => {
  it('counts each fish as one slot and never stacks fish', () => {
    let bag = createBag(8);
    bag = addBagItem(bag, fish('fish-a')).bag;
    bag = addBagItem(bag, fish('fish-b')).bag;
    expect(bagSlotsUsed(bag)).toBe(2);
    expect(bag.items).toHaveLength(2);
  });

  it('stacks same-kind trash to 5 per slot and spills into another slot', () => {
    let bag = createBag(8);
    bag = addBagItem(bag, trash('can-a', 'can', 4)).bag;
    bag = addBagItem(bag, trash('can-b', 'can', 3)).bag;
    expect(bag.items.map((item) => item.qty)).toEqual([5, 2]);
    expect(bagSlotsUsed(bag)).toBe(2);
  });

  it('splits a large trash quantity across stack-sized slots', () => {
    const result = addBagItem(createBag(3), trash('can-bulk', 'can', 12));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bag.items.map((item) => item.qty)).toEqual([5, 5, 2]);
      expect(bagSlotsUsed(result.bag)).toBe(3);
    }
  });

  it('rejects a trash batch that does not fit atomically', () => {
    const result = addBagItem(createBag(2), trash('can-bulk', 'can', 12));
    expect(result.ok).toBe(false);
  });

  it('rejects additions atomically when capacity is insufficient', () => {
    let bag = createBag(1);
    bag = addBagItem(bag, fish('fish-a')).bag;
    const result = addBagItem(bag, trash('can-a'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('bag-full');
      expect(result.bag).toBe(bag);
    }
  });

  it('does not count tools or cosmetics against result slots', () => {
    let bag = createBag(1);
    bag = addBagItem(bag, { id: 'rod', kind: 'tool', qty: 1 }).bag;
    bag = addBagItem(bag, { id: 'hat', kind: 'cosmetic', qty: 1 }).bag;
    expect(bagSlotsUsed(bag)).toBe(0);
    expect(addBagItem(bag, fish('fish-a')).ok).toBe(true);
  });

  it('disposes all trash only when at a trash bin and caps the daily reward', () => {
    let bag = createBag(8);
    bag = addBagItem(bag, trash('can', 'can', 5)).bag;
    bag = addBagItem(bag, trash('boot', 'boot', 2)).bag;
    bag = addBagItem(bag, fish('fish-a')).bag;

    const blocked = disposeTrash(bag, { atTrashBin: false, coinsEarnedToday: 0, dailyCoinLimit: 30 });
    expect(blocked.ok).toBe(false);
    expect(blocked.bag).toBe(bag);

    const disposed = disposeTrash(bag, { atTrashBin: true, coinsEarnedToday: 27, dailyCoinLimit: 30 });
    expect(disposed.ok).toBe(true);
    if (disposed.ok) {
      expect(disposed.removedQty).toBe(7);
      expect(disposed.coins).toBe(3);
      expect(disposed.bag.items).toEqual([fish('fish-a')]);
    }
  });

  it('releases only fish and only near water', () => {
    let bag = createBag(8);
    bag = addBagItem(bag, fish('fish-a')).bag;
    bag = addBagItem(bag, trash('can-a')).bag;
    expect(releaseFish(bag, 'fish-a', false).ok).toBe(false);
    expect(releaseFish(bag, 'can-a', true).ok).toBe(false);
    const released = releaseFish(bag, 'fish-a', true);
    expect(released.ok).toBe(true);
    expect(released.bag.items).toEqual([trash('can-a')]);
  });

  it('sells selected fish, removes them, totals coins, and leaves trash untouched', () => {
    let bag = createBag(8);
    bag = addBagItem(bag, fish('m1', 'mujair', 0.35)).bag;
    bag = addBagItem(bag, fish('n1', 'nila', 1.0)).bag;
    bag = addBagItem(bag, trash('can-a')).bag;
    const prices: Record<string, number> = { mujair: 8, nila: 10 };
    const result = sellFish(bag, ['m1', 'n1'], (item: BagItem) =>
      Math.max(1, Math.round((prices[item.species ?? ''] ?? 0) * (item.weight ?? 0))),
    );
    expect(result.coins).toBe(13);
    expect(result.sold).toHaveLength(2);
    expect(result.bag.items).toEqual([trash('can-a')]);
  });
});

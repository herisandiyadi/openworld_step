import { describe, expect, it } from 'vitest';
import { buyItem, createStoreState, equipPurchasedItem, type StoreItem } from './store';
import { busFare, buyDayPass, createTransitPass, rideBus } from './busFare';
import { createWallet } from './wallet';
import { createInventory } from './inventory';

const paint: StoreItem = { id: 'paint_blue', name: 'Blue Paint', category: 'vehicle_paint', price: 12, retired: false };

describe('store', () => {
  it('buys an unlocked item with sufficient funds and records ownership', () => {
    const result = buyItem(createStoreState(createWallet(20), createInventory()), paint, { id: 'buy-1', timestamp: 5 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.wallet.balance).toBe(8);
      expect(result.inventory.owned[0]?.id).toBe('paint_blue');
    }
  });

  it('rejects retired, locked, duplicate, and unaffordable items without changes', () => {
    const state = createStoreState(createWallet(10), createInventory());
    expect(buyItem(state, { ...paint, retired: true })).toMatchObject({ ok: false, reason: 'retired', state });
    expect(buyItem(state, { ...paint, unlockAfter: 'q_later' })).toMatchObject({ ok: false, reason: 'locked', state });
    expect(buyItem(state, { ...paint, price: 11 })).toMatchObject({ ok: false, reason: 'insufficient-funds', state });
    const owned = buyItem(createStoreState(createWallet(20), createInventory([{ id: paint.id, category: paint.category, retired: false }])), paint);
    expect(owned).toMatchObject({ ok: false, reason: 'already-owned' });
  });

  it('equips only owned items through the store seam', () => {
    const state = createStoreState(createWallet(20), createInventory([{ id: paint.id, category: paint.category, retired: false }]));
    expect(equipPurchasedItem(state, paint.id).inventory.equipped.vehicle_paint).toBe(paint.id);
    const emptyState = createStoreState(createWallet(), createInventory());
    expect(equipPurchasedItem(emptyState, paint.id)).toBe(emptyState);
  });
});

describe('bus fare and day pass', () => {
  it('charges the configured fare for a ride', () => {
    const result = rideBus(createWallet(10), 5, false, { id: 'bus-1', timestamp: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.wallet.balance).toBe(5);
  });

  it('uses a valid day pass instead of charging fare', () => {
    let wallet = createWallet(20);
    const bought = buyDayPass(wallet, 7, '2026-10-08', { id: 'pass-1', timestamp: 1 });
    expect(bought.ok).toBe(true);
    if (!bought.ok) return;
    const ride = rideBus(bought.wallet, 5, bought.pass.activeDate === '2026-10-08', { id: 'bus-1', timestamp: 2 });
    expect(ride.ok).toBe(true);
    if (ride.ok) expect(ride.wallet.balance).toBe(13);
    expect(createTransitPass(null).activeDate).toBeNull();
  });

  it('rejects fares below zero and invalid dates', () => {
    expect(busFare(-1)).toBe(0);
    expect(() => createTransitPass('tomorrow')).toThrow();
    expect(buyDayPass(createWallet(5), 7, '2026-10-08')).toMatchObject({ ok: false, reason: 'insufficient-funds' });
  });
});

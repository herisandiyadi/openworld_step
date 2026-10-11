import { addOwnedItem, equipItem, type Inventory, type ItemCategory, ownedIds } from './inventory';
import { debit, type Wallet } from './wallet';

export interface StoreItem {
  readonly id: string;
  readonly name: string;
  readonly category: ItemCategory;
  readonly price: number;
  readonly retired: boolean;
  readonly unlockAfter?: string;
}

export interface StoreState {
  readonly wallet: Wallet;
  readonly inventory: Inventory;
  readonly completedQuests: readonly string[];
}

export type PurchaseResult =
  | { readonly ok: true; readonly wallet: Wallet; readonly inventory: Inventory }
  | { readonly ok: false; readonly reason: 'retired' | 'locked' | 'already-owned' | 'insufficient-funds' | 'invalid-price'; readonly state: StoreState };

export function createStoreState(wallet: Wallet, inventory: Inventory, completedQuests: readonly string[] = []): StoreState {
  return { wallet, inventory, completedQuests };
}

export function buyItem(state: StoreState, item: StoreItem, transaction?: { readonly id?: string; readonly timestamp?: number }): PurchaseResult {
  if (item.retired) return { ok: false, reason: 'retired', state };
  if (item.unlockAfter && !state.completedQuests.includes(item.unlockAfter)) return { ok: false, reason: 'locked', state };
  if (ownedIds(state.inventory).includes(item.id)) return { ok: false, reason: 'already-owned', state };
  if (!Number.isInteger(item.price) || item.price < 0) return { ok: false, reason: 'invalid-price', state };
  let wallet = state.wallet;
  if (item.price > 0) {
    const payment = debit(wallet, item.price, `store:${item.id}`, transaction?.id, transaction?.timestamp);
    if (!payment.ok) return { ok: false, reason: payment.reason === 'insufficient-funds' ? 'insufficient-funds' : 'invalid-price', state };
    wallet = payment.wallet;
  }
  const inventory = addOwnedItem(state.inventory, { id: item.id, category: item.category, retired: item.retired });
  return { ok: true, wallet, inventory };
}

export function equipPurchasedItem(state: StoreState, itemId: string): StoreState {
  const inventory = equipItem(state.inventory, itemId);
  return inventory === state.inventory ? state : { ...state, inventory };
}

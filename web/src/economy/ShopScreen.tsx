import { useState } from 'react';
import type { ItemCategory } from './inventory';
import type { StoreItem } from './store';

export interface ShopScreenProps {
  readonly items: readonly StoreItem[];
  readonly balance: number;
  readonly ownedIds: readonly string[];
  readonly completedQuests?: readonly string[];
  readonly onBuy: (item: StoreItem) => void;
  readonly onEquip?: (item: StoreItem) => void;
  readonly onPreview?: (item: StoreItem) => void;
  readonly onClose?: () => void;
}

const CATEGORIES: readonly { readonly id: ItemCategory | 'all'; readonly label: string }[] = [
  { id: 'all', label: 'Semua' },
  { id: 'vehicle', label: 'Kendaraan' },
  { id: 'vehicle_paint', label: 'Cat' },
  { id: 'vehicle_upgrade', label: 'Upgrade' },
  { id: 'clothing', label: 'Pakaian' },
  { id: 'ticket', label: 'Tiket' },
  { id: 'tool', label: 'Alat' },
];

export function availableShopItems(items: readonly StoreItem[]): readonly StoreItem[] {
  return items.filter((item) => !item.retired);
}

export function canBuyShopItem(item: StoreItem, balance: number, owned: readonly string[], completedQuests: readonly string[]): boolean {
  return !item.retired && !owned.includes(item.id) && (!item.unlockAfter || completedQuests.includes(item.unlockAfter)) && item.price >= 0 && item.price <= balance;
}

export function selectedShopItemIds(items: readonly StoreItem[], owned: readonly string[], category: ItemCategory | 'all'): readonly string[] {
  return availableShopItems(items).filter((item) => owned.includes(item.id) && (category === 'all' || item.category === category)).map((item) => item.id);
}

export function ShopScreen({ items, balance, ownedIds, completedQuests = [], onBuy, onEquip, onPreview, onClose }: ShopScreenProps) {
  const [category, setCategory] = useState<ItemCategory | 'all'>('all');
  const visibleItems = availableShopItems(items).filter((item) => category === 'all' || item.category === category);
  return (
    <section role="dialog" aria-modal="true" aria-labelledby="shop-title" className="economy-screen shop-screen">
      <header>
        <h2 id="shop-title">Toko</h2>
        <p aria-live="polite">Saldo: {balance} koin</p>
        {onClose && <button type="button" onClick={onClose} aria-label="Tutup toko">Tutup</button>}
      </header>
      <nav aria-label="Kategori toko" role="tablist">
        {CATEGORIES.map((entry) => (
          <button key={entry.id} type="button" role="tab" aria-selected={category === entry.id} onClick={() => setCategory(entry.id)}>
            {entry.label}
          </button>
        ))}
      </nav>
      <ul aria-label="Daftar barang toko">
        {visibleItems.map((item) => {
          const owned = ownedIds.includes(item.id);
          const unlocked = !item.unlockAfter || completedQuests.includes(item.unlockAfter);
          const canBuy = canBuyShopItem(item, balance, ownedIds, completedQuests);
          return (
            <li key={item.id}>
              <span>{item.name}</span> <span>{item.price} koin</span>
              {onPreview && <button type="button" onClick={() => onPreview(item)} aria-label={`Pratinjau ${item.name}`}>Pratinjau</button>}
              {owned ? (
                <button type="button" onClick={() => onEquip?.(item)} disabled={!onEquip} aria-label={`Pasang ${item.name}`}>Pasang</button>
              ) : (
                <button type="button" onClick={() => onBuy(item)} disabled={!canBuy} aria-label={`Beli ${item.name}`}>
                  {!unlocked ? 'Terkunci' : balance < item.price ? 'Koin kurang' : 'Beli'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

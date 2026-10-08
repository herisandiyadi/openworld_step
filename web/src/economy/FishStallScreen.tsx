import { useState } from 'react';
import type { Bag, BagItem } from './bag';

export interface FishStallScreenProps {
  readonly bag: Bag;
  readonly priceOf: (item: BagItem) => number;
  readonly onSell: (ids: readonly string[]) => void;
  readonly onClose?: () => void;
}

export function selectableFish(bag: Bag): readonly BagItem[] {
  return bag.items.filter((item) => item.kind === 'fish');
}

export function fishStallTotal(bag: Bag, selectedIds: readonly string[], priceOf: (item: BagItem) => number): number {
  const idSet = new Set(selectedIds);
  return bag.items.filter((item) => item.kind === 'fish' && idSet.has(item.id)).reduce((sum, item) => sum + priceOf(item), 0);
}

export function FishStallScreen({ bag, priceOf, onSell, onClose }: FishStallScreenProps) {
  const fish = selectableFish(bag);
  const [selected, setSelected] = useState<readonly string[]>(fish.map((item) => item.id));
  const total = fishStallTotal(bag, selected, priceOf);

  function toggle(id: string): void {
    setSelected((prev) => prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]);
  }

  function sellAll(): void {
    setSelected(fish.map((item) => item.id));
    onSell(fish.map((item) => item.id));
  }

  return (
    <section role="dialog" aria-modal="true" aria-labelledby="stall-title" className="economy-screen fish-stall-screen">
      <header>
        <h2 id="stall-title">Lapak Ikan</h2>
        {onClose && <button type="button" onClick={onClose} aria-label="Tutup lapak ikan">Tutup</button>}
      </header>
      {fish.length === 0 ? <p>Tidak ada ikan untuk dijual.</p> : (
        <>
          <ul aria-label="Pilih ikan untuk dijual">
            {fish.map((item) => {
              const price = priceOf(item);
              const isSelected = selected.includes(item.id);
              return (
                <li key={item.id}>
                  <label>
                    <input type="checkbox" checked={isSelected} onChange={() => toggle(item.id)} aria-label={`Pilih ${item.species ?? item.id}, ${item.weight?.toFixed(2)} kg, ${price} koin`} />
                    <span>{item.species ?? item.id}</span> <span>{item.weight?.toFixed(2)} kg</span> <span>{price} koin</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <p aria-live="polite">Total: {total} koin</p>
          <button type="button" disabled={selected.length === 0} onClick={() => onSell(selected)} aria-label={`Jual ${selected.length} ikan seharga ${total} koin`}>Jual</button>
          <button type="button" onClick={sellAll} disabled={fish.length === 0} aria-label="Jual semua ikan">Jual semua</button>
        </>
      )}
    </section>
  );
}

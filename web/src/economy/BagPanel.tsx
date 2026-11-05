import type { Bag, BagItem } from './bag';
import { bagSlotsUsed } from './bag';

export interface BagPanelProps {
  readonly bag: Bag;
  readonly nearWater: boolean;
  readonly priceOf?: (item: BagItem) => number;
  readonly onReleaseFish: (itemId: string) => void;
  readonly onClose?: () => void;
}

export function bagSummary(bag: Bag): { readonly used: number; readonly capacity: number; readonly label: string } {
  const used = bagSlotsUsed(bag);
  return { used, capacity: bag.capacity, label: `${used}/${bag.capacity}` };
}

export function fishItems(bag: Bag): readonly BagItem[] {
  return bag.items.filter((item) => item.kind === 'fish');
}

export function trashItems(bag: Bag): readonly BagItem[] {
  return bag.items.filter((item) => item.kind === 'trash');
}

export function BagPanel({ bag, nearWater, priceOf, onReleaseFish, onClose }: BagPanelProps) {
  const summary = bagSummary(bag);
  return (
    <section role="dialog" aria-modal="true" aria-labelledby="bag-title" className="economy-screen bag-panel">
      <header>
        <h2 id="bag-title">Tas</h2>
        <p aria-label={`${summary.used} dari ${summary.capacity} slot terpakai`}>{summary.label}</p>
        {onClose && <button type="button" onClick={onClose} aria-label="Tutup tas">Tutup</button>}
      </header>
      {bag.items.length === 0 ? <p>Tas kosong.</p> : (
        <ul aria-label="Isi tas">
          {bag.items.map((item) => (
            <li key={item.id}>
              <span>{item.species ?? item.trashType ?? item.id}</span>
              {item.kind === 'fish' && <span>{item.weight?.toFixed(2)} kg</span>}
              {item.kind === 'trash' && <span>×{item.qty}</span>}
              {item.kind === 'fish' && priceOf && <span>Perkiraan {priceOf(item)} koin</span>}
              {item.kind === 'fish' && (
                <button type="button" disabled={!nearWater} onClick={() => onReleaseFish(item.id)} aria-label={`Lepas ${item.species ?? item.id}`}>
                  {nearWater ? 'Lepas' : 'Dekati air untuk melepas'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

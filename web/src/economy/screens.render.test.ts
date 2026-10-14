import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BagPanel } from './BagPanel';
import { FishStallScreen } from './FishStallScreen';
import { ShopScreen } from './ShopScreen';
import type { Bag } from './bag';

const bag: Bag = {
  capacity: 8,
  trashStackSize: 5,
  items: [{ id: 'fish-1', kind: 'fish', species: 'nila', weight: 0.8, qty: 1 }],
};

describe('economy React screens', () => {
  it('renders an accessible shop dialog with buy, preview, category, and close controls', () => {
    const html = renderToStaticMarkup(createElement(ShopScreen, {
      items: [{ id: 'paint_blue', name: 'Cat Biru', category: 'vehicle_paint', price: 10, retired: false }],
      balance: 10,
      ownedIds: [],
      onBuy: vi.fn(),
      onPreview: vi.fn(),
      onClose: vi.fn(),
    }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Beli Cat Biru"');
    expect(html).toContain('aria-label="Pratinjau Cat Biru"');
    expect(html).toContain('aria-label="Kategori toko"');
    expect(html).toContain('aria-label="Tutup toko"');
  });

  it('renders bag occupancy, fish details, and a disabled release control away from water', () => {
    const html = renderToStaticMarkup(createElement(BagPanel, {
      bag,
      nearWater: false,
      priceOf: () => 8,
      onReleaseFish: vi.fn(),
    }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('1 dari 8 slot terpakai');
    expect(html).toContain('0.80 kg');
    expect(html).toContain('aria-label="Lepas nila"');
    expect(html).toContain('disabled=""');
  });

  it('renders fish sale selection, total, sell-one/all, and close controls', () => {
    const html = renderToStaticMarkup(createElement(FishStallScreen, {
      bag,
      priceOf: () => 8,
      onSell: vi.fn(),
      onClose: vi.fn(),
    }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Pilih nila, 0.80 kg, 8 koin"');
    expect(html).toContain('Total: 8 koin');
    expect(html).toContain('aria-label="Jual 1 ikan seharga 8 koin"');
    expect(html).toContain('aria-label="Jual semua ikan"');
    expect(html).toContain('aria-label="Tutup lapak ikan"');
  });
});

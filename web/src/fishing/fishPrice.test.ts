import { describe, expect, it } from 'vitest';
import { fishPrice, createMarket, recordSale } from './fishPrice';

describe('fishPrice', () => {
  it('computes base price as round(pricePerKg × weight), minimum 1 coin', () => {
    expect(fishPrice('mujair', 0.35, 8)).toBe(3);
    expect(fishPrice('ikan-mas', 2.4, 14)).toBe(34);
    expect(fishPrice('patin', 6.8, 22)).toBe(150);
    expect(fishPrice('mujair', 0.05, 8)).toBe(1);
  });

  it('applies a market multiplier of 1.0 for the first 10 sales', () => {
    const market = createMarket({ fullPriceSalesPerSpecies: 10, discountPerExtraSale: 0.05, minimumMultiplier: 0.5 });
    expect(fishPrice('mujair', 1.0, 10, market)).toBe(10);
  });

  it('discounts 5% for each sale beyond the daily cap, minimum 50%', () => {
    let market = createMarket({ fullPriceSalesPerSpecies: 10, discountPerExtraSale: 0.05, minimumMultiplier: 0.5 });
    for (let i = 0; i < 10; i += 1) market = recordSale(market, 'nila');
    // 11th sale today: 95% of 100.
    expect(fishPrice('nila', 1.0, 100, market)).toBe(95);
    for (let i = 0; i < 8; i += 1) market = recordSale(market, 'nila');
    // 19th sale: 1 - 9×5% = 55%.
    expect(fishPrice('nila', 1.0, 100, market)).toBe(55);
    for (let i = 0; i < 10; i += 1) market = recordSale(market, 'nila');
    // Floored at 50%.
    expect(fishPrice('nila', 1.0, 100, market)).toBe(50);
  });

  it('resets to full price on the next day', () => {
    let market = createMarket({ fullPriceSalesPerSpecies: 10, discountPerExtraSale: 0.05, minimumMultiplier: 0.5 });
    for (let i = 0; i < 15; i += 1) market = recordSale(market, 'gurame');
    const discounted = fishPrice('gurame', 1.0, 18, market);
    expect(discounted).toBeLessThan(18);
    const nextDay = { ...market, dayIndex: market.dayIndex + 1 };
    expect(fishPrice('gurame', 1.0, 18, nextDay)).toBe(18);
  });

  it('does not apply saturation to a different species', () => {
    let market = createMarket({ fullPriceSalesPerSpecies: 10, discountPerExtraSale: 0.05, minimumMultiplier: 0.5 });
    for (let i = 0; i < 15; i += 1) market = recordSale(market, 'mujair');
    expect(fishPrice('nila', 1.0, 10, market)).toBe(10);
  });
});

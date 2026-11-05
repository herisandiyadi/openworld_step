import { describe, expect, it } from 'vitest';
import {
  EconomySchema,
  FishingSchema,
  ItemSchema,
  ManifestSchema,
  NpcSchema,
  QuestSchema,
  RegionSchema,
  ShopSchema,
} from './schema';

const validQuest = {
  id: 'q_kenalan',
  title: 'Kenalan dengan warga',
  giver: 'npc_budi',
  requires: [],
  repeatable: false,
  steps: [
    { type: 'talk', npc: 'npc_budi', text: 'Bicara dengan Pak Budi' },
    { type: 'reach', x: 1, z: 2, radius: 3, text: 'Pergi ke plaza' },
    { type: 'ride', vehicle: 'bicycle', text: 'Naik sepeda' },
    { type: 'collect', item: 'parcel', count: 1, text: 'Ambil paket' },
    { type: 'visit_district', region: 'downtown', text: 'Kunjungi pusat kota' },
    { type: 'time', from: 5, to: 8, text: 'Datang pagi hari' },
    { type: 'catch', species: 'mujair', count: 1, minWeight: 0.1, text: 'Tangkap mujair' },
    { type: 'dispose', count: 1, text: 'Buang sampah' },
  ],
  rewards: { coins: 20, items: ['rod_bamboo'] },
};

describe('content schemas', () => {
  it('accepts the supported content definitions', () => {
    expect(NpcSchema.parse({
      id: 'npc_budi', name: 'Pak Budi', asset: 'npc_vendor', x: 5, z: 10, yaw: Math.PI / 2,
      region: 'downtown', dialogue: 'dialogue/npc_budi.json', questGiver: ['q_kenalan'],
    }).id).toBe('npc_budi');
    expect(QuestSchema.parse(validQuest).steps).toHaveLength(8);
    expect(RegionSchema.parse({ id: 'downtown', name: 'Pusat Kota', bounds: { minX: -128, maxX: 128, minZ: -128, maxZ: 128 } }).id).toBe('downtown');
    expect(ShopSchema.parse({ id: 'shop_bike', name: 'Toko Sepeda', region: 'downtown', x: 1, z: 2, items: ['bike_red'] }).id).toBe('shop_bike');
    expect(ItemSchema.parse({ id: 'bike_red', category: 'vehicle', name: 'Sepeda Merah', price: 100, asset: { model: 'bike' } }).price).toBe(100);
    expect(EconomySchema.parse({ currency: 'coins', dailyBonus: 20, busFare: 5, jobs: [] }).currency).toBe('coins');
    expect(ManifestSchema.parse({ id: 'base', version: '1.0.0', minAppVersion: '0.1.0', worldVersion: 2, files: [{ path: 'npcs.json', sha256: 'a'.repeat(64), size: 10 }] }).files).toHaveLength(1);
  });

  it('rejects malformed ids, impossible ranges, and unsafe manifest paths', () => {
    expect(() => NpcSchema.parse({ id: '../budi', name: 'Budi', asset: 'npc_vendor', x: 0, z: 0, yaw: 0, region: 'downtown', dialogue: '../secret.json' })).toThrow();
    expect(() => QuestSchema.parse({ ...validQuest, steps: [{ type: 'reach', x: 0, z: 0, radius: 0, text: 'no' }] })).toThrow();
    expect(() => ManifestSchema.parse({ id: 'base', version: '1', minAppVersion: '1', worldVersion: 1, files: [{ path: '../outside.json', sha256: 'a'.repeat(64), size: 1 }] })).toThrow();
  });

  it('requires fishing probabilities and species shares to each total one', () => {
    const fishing = {
      biteWaitSeconds: { min: 3, max: 12 }, hookWindowSeconds: 1.2,
      catches: [{ id: 'fish', kind: 'fish', chance: 0.55 }, { id: 'can', kind: 'trash', chance: 0.45 }],
      baitedCatches: [{ id: 'fish', kind: 'fish', chance: 0.7 }, { id: 'can', kind: 'trash', chance: 0.3 }],
      species: [
        { id: 'mujair', name: 'Mujair', chance: 0.8, minWeight: 0.1, maxWeight: 0.6, pricePerKg: 8, difficulty: 1 },
        { id: 'patin', name: 'Patin', chance: 0.2, minWeight: 2, maxWeight: 8, pricePerKg: 22, difficulty: 3 },
      ],
      peakHours: [{ from: 5, to: 8, fishChanceBonus: 0.1 }],
      antiFarming: { catchesBeforePenalty: 10, fishChancePenalty: 0.15 },
      market: { fullPriceSalesPerSpecies: 10, discountPerExtraSale: 0.05, minimumMultiplier: 0.5 },
      bag: { capacities: [8, 14, 20], trashStackSize: 5 },
      disposal: { coinsPerTrash: 1, dailyCoinLimit: 30 },
    };
    expect(FishingSchema.parse(fishing).species).toHaveLength(2);
    expect(() => FishingSchema.parse({ ...fishing, catches: [{ id: 'fish', kind: 'fish', chance: 0.9 }] })).toThrow();
    expect(() => FishingSchema.parse({ ...fishing, species: [{ ...fishing.species[0], chance: 0.9 }] })).toThrow();
  });
});

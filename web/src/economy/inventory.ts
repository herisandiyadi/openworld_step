export type ItemCategory =
  | 'vehicle'
  | 'vehicle_paint'
  | 'vehicle_upgrade'
  | 'clothing'
  | 'ticket'
  | 'tool'
  | 'fish'
  | 'trash';

export type EquipSlot = 'vehicle' | 'vehicle_paint' | 'vehicle_upgrade' | 'clothing' | 'ticket' | 'tool';

export interface OwnedItem {
  readonly id: string;
  readonly category: ItemCategory;
  readonly retired: boolean;
}

export interface Inventory {
  readonly owned: readonly OwnedItem[];
  readonly equipped: Readonly<Partial<Record<EquipSlot, string>>>;
}

export function createInventory(owned: readonly OwnedItem[] = []): Inventory {
  return { owned: [...owned], equipped: {} };
}

export function ownedIds(inventory: Inventory): readonly string[] {
  return inventory.owned.map((item) => item.id);
}

export function addOwnedItem(inventory: Inventory, item: OwnedItem): Inventory {
  if (inventory.owned.some((owned) => owned.id === item.id)) return inventory;
  return { ...inventory, owned: [...inventory.owned, item] };
}

export function equipSlotOf(itemId: string, category?: ItemCategory): EquipSlot | undefined {
  const prefix = itemId.split('_')[0] ?? '';
  if (category === 'vehicle' || prefix === 'vehicle') return 'vehicle';
  if (category === 'vehicle_paint' || prefix === 'paint') return 'vehicle_paint';
  if (category === 'vehicle_upgrade' || prefix === 'upgrade') return 'vehicle_upgrade';
  if (category === 'clothing' || ['hat', 'helmet', 'shirt', 'outfit', 'bag'].includes(prefix)) return 'clothing';
  if (category === 'ticket' || prefix === 'ticket') return 'ticket';
  if (category === 'tool' || ['rod', 'bait'].includes(prefix)) return 'tool';
  return undefined;
}

export function equipItem(inventory: Inventory, itemId: string): Inventory {
  const item = inventory.owned.find((owned) => owned.id === itemId);
  if (!item || item.retired) return inventory;
  const slot = equipSlotOf(item.id, item.category);
  if (!slot || inventory.equipped[slot] === itemId) return inventory;
  return { ...inventory, equipped: { ...inventory.equipped, [slot]: itemId } };
}

export function unequipSlot(inventory: Inventory, slot: EquipSlot): Inventory {
  if (!(slot in inventory.equipped)) return inventory;
  const equipped = { ...inventory.equipped };
  delete equipped[slot];
  return { ...inventory, equipped };
}

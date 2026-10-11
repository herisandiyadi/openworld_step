import { describe, expect, it } from 'vitest';
import {
  addOwnedItem,
  createInventory,
  equipItem,
  type EquipSlot,
  equipSlotOf,
  ownedIds,
  unequipSlot,
} from './inventory';

describe('inventory', () => {
  it('adds an item to owned items and is idempotent on re-add', () => {
    const inv = createInventory();
    const inv2 = addOwnedItem(inv, { id: 'paint_blue', category: 'vehicle_paint', retired: false });
    expect(ownedIds(inv2)).toContain('paint_blue');
    const inv3 = addOwnedItem(inv2, { id: 'paint_blue', category: 'vehicle_paint', retired: false });
    expect(ownedIds(inv3)).toHaveLength(1);
  });

  it('equips an item in the correct slot and replaces the previous occupant', () => {
    let inv = createInventory();
    inv = addOwnedItem(inv, { id: 'helmet_red', category: 'clothing', retired: false });
    inv = addOwnedItem(inv, { id: 'helmet_blue', category: 'clothing', retired: false });
    inv = equipItem(inv, 'helmet_red');
    const slot = equipSlotOf('helmet_red', 'clothing') as EquipSlot;
    expect(inv.equipped[slot]).toBe('helmet_red');
    inv = equipItem(inv, 'helmet_blue');
    expect(inv.equipped[slot]).toBe('helmet_blue');
  });

  it('un-equips an item from a slot', () => {
    let inv = createInventory();
    inv = addOwnedItem(inv, { id: 'rod_carbon', category: 'tool', retired: false });
    inv = equipItem(inv, 'rod_carbon');
    const slot = equipSlotOf('rod_carbon', 'tool') as EquipSlot;
    expect(inv.equipped[slot]).toBe('rod_carbon');
    inv = unequipSlot(inv, slot);
    expect(inv.equipped[slot]).toBeUndefined();
  });

  it('preserves retired items in owned list and never auto-equips them', () => {
    let inv = createInventory();
    inv = addOwnedItem(inv, { id: 'paint_old', category: 'vehicle_paint', retired: true });
    expect(ownedIds(inv)).toContain('paint_old');
    // Not found in any equip slot
    const allEquipped = Object.values(inv.equipped);
    expect(allEquipped).not.toContain('paint_old');
  });

  it('does not equip an item that is not owned', () => {
    const inv = createInventory();
    const next = equipItem(inv, 'not_owned_item');
    expect(Object.values(next.equipped)).not.toContain('not_owned_item');
    expect(next).toBe(inv); // same reference if no change
  });

  it('allows multiple independent slots to be equipped simultaneously', () => {
    let inv = createInventory();
    inv = addOwnedItem(inv, { id: 'hat_straw', category: 'clothing', retired: false });
    inv = addOwnedItem(inv, { id: 'ticket_day', category: 'ticket', retired: false });
    inv = equipItem(inv, 'hat_straw');
    inv = equipItem(inv, 'ticket_day');
    expect(Object.values(inv.equipped)).toContain('hat_straw');
    expect(Object.values(inv.equipped)).toContain('ticket_day');
  });
});

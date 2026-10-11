/**
 * FISHING.md §5 — limited-slot bag.
 *
 * Rules:
 *  • Each fish occupies exactly one slot (weights vary, so no stacking).
 *  • Trash of the same kind stacks up to trashStackSize (default 5) per slot.
 *  • Tool and cosmetic items do not count against the catch/result slots.
 *  • The bag never exceeds capacity; all mutations are atomic and pure.
 */

export type BagItemKind = 'fish' | 'trash' | 'tool' | 'cosmetic';

export interface BagItem {
  readonly id: string;
  readonly kind: BagItemKind;
  /** Species id for kind 'fish'. */
  readonly species?: string;
  readonly weight?: number;
  /** Trash variety (e.g. 'can', 'sandal') for kind 'trash'. */
  readonly trashType?: string;
  readonly qty: number;
}

export interface Bag {
  readonly capacity: number;
  readonly trashStackSize: number;
  readonly items: readonly BagItem[];
}

export type AddResult =
  | { readonly ok: true; readonly bag: Bag }
  | { readonly ok: false; readonly reason: 'bag-full'; readonly bag: Bag };

export type DisposeOptions = {
  readonly atTrashBin: boolean;
  readonly coinsEarnedToday: number;
  readonly dailyCoinLimit: number;
  /** Coins awarded per piece of trash disposed. Default 1. */
  readonly coinsPerTrash?: number;
};
export type DisposeResult =
  | { readonly ok: true; readonly bag: Bag; readonly removedQty: number; readonly coins: number }
  | { readonly ok: false; readonly reason: 'not-at-bin' | 'no-trash'; readonly bag: Bag };

export type ReleaseResult =
  | { readonly ok: true; readonly bag: Bag }
  | { readonly ok: false; readonly reason: 'not-near-water' | 'not-fish' | 'not-found'; readonly bag: Bag };

export type SellResult = {
  readonly bag: Bag;
  readonly sold: readonly BagItem[];
  readonly coins: number;
};

const countableKinds: ReadonlySet<BagItemKind> = new Set(['fish', 'trash']);

/** Number of slots consumed by items that count against capacity. */
export function bagSlotsUsed(bag: Bag): number {
  return bag.items.filter((item) => countableKinds.has(item.kind)).length;
}

function isFull(bag: Bag): boolean {
  return bagSlotsUsed(bag) >= bag.capacity;
}

export function createBag(capacity: number, trashStackSize = 5): Bag {
  return { capacity, trashStackSize, items: [] };
}

/** Adds trash: fills partial stacks first, then opens new stack-sized slots. Atomic. */
function addTrash(bag: Bag, item: BagItem): AddResult {
  let remaining = item.qty;
  const updated: BagItem[] = bag.items.map((slot) => {
    if (remaining <= 0 || slot.kind !== 'trash' || slot.trashType !== item.trashType) return slot;
    const space = bag.trashStackSize - slot.qty;
    if (space <= 0) return slot;
    const absorb = Math.min(space, remaining);
    remaining -= absorb;
    return { ...slot, qty: slot.qty + absorb };
  });
  const newSlots: BagItem[] = [];
  while (remaining > 0) {
    const qty = Math.min(bag.trashStackSize, remaining);
    newSlots.push({ ...item, qty });
    remaining -= qty;
  }
  if (bagSlotsUsed(bag) + newSlots.length > bag.capacity) {
    return { ok: false, reason: 'bag-full', bag };
  }
  if (newSlots.length > 1) {
    // Unique ids per opened slot so later operations can target one stack.
    newSlots.forEach((slot, i) => {
      updated.push({ ...slot, id: `${slot.id}-${i + 1}` });
    });
  } else {
    updated.push(...newSlots);
  }
  return { ok: true, bag: { ...bag, items: updated } };
}

/** Adds an item to the bag. Never mutates the input. */
export function addBagItem(bag: Bag, item: BagItem): AddResult {
  if (!countableKinds.has(item.kind)) {
    return { ok: true, bag: { ...bag, items: [...bag.items, item] } };
  }
  if (item.kind === 'trash') {
    return addTrash(bag, item);
  }
  if (isFull(bag)) return { ok: false, reason: 'bag-full', bag };
  return { ok: true, bag: { ...bag, items: [...bag.items, item] } };
}

/** Removes all trash from the bag; awards coins only up to the daily limit. */
export function disposeTrash(bag: Bag, options: DisposeOptions): DisposeResult {
  if (!options.atTrashBin) return { ok: false, reason: 'not-at-bin', bag };
  const trashItems = bag.items.filter((i) => i.kind === 'trash');
  if (trashItems.length === 0) return { ok: false, reason: 'no-trash', bag };
  const coinsPerTrash = options.coinsPerTrash ?? 1;
  const totalQty = trashItems.reduce((sum, i) => sum + i.qty, 0);
  const budget = Math.max(0, options.dailyCoinLimit - options.coinsEarnedToday);
  const coins = Math.min(totalQty * coinsPerTrash, budget);
  const nextItems = bag.items.filter((i) => i.kind !== 'trash');
  return { ok: true, bag: { ...bag, items: nextItems }, removedQty: totalQty, coins };
}

/** Releases a single fish back to the water; requires being near water. */
export function releaseFish(bag: Bag, itemId: string, nearWater: boolean): ReleaseResult {
  if (!nearWater) return { ok: false, reason: 'not-near-water', bag };
  const idx = bag.items.findIndex((i) => i.id === itemId);
  if (idx < 0) return { ok: false, reason: 'not-found', bag };
  if (bag.items[idx]!.kind !== 'fish') return { ok: false, reason: 'not-fish', bag };
  const nextItems = bag.items.filter((_, i) => i !== idx);
  return { ok: true, bag: { ...bag, items: nextItems } };
}

/**
 * Sells a list of fish by id; calls priceOf to determine each fish's value.
 * Removes sold items and returns the total coins earned.
 */
export function sellFish(
  bag: Bag,
  ids: readonly string[],
  priceOf: (item: BagItem) => number,
): SellResult {
  const idSet = new Set(ids);
  const sold: BagItem[] = [];
  let coins = 0;
  const remaining: BagItem[] = [];
  for (const item of bag.items) {
    if (item.kind === 'fish' && idSet.has(item.id)) {
      sold.push(item);
      coins += priceOf(item);
    } else {
      remaining.push(item);
    }
  }
  return { bag: { ...bag, items: remaining }, sold, coins };
}

/**
 * ContentRegistry – merges one or more content packs and exposes typed lookups.
 *
 * A "pack" is a plain object conforming to ContentPack; packs are applied in
 * order.  The first pack (base/) is the source of truth; later packs overwrite
 * ids they redefine and add ids they introduce.  An id that already exists in
 * the SAME pack is a hard error; overwriting across packs is legal (update packs).
 */

import type { EconomyDef, ItemDef, NpcDef, QuestDef, RegionDef, ShopDef } from './schema';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ContentPack {
  npcs: NpcDef[];
  quests: QuestDef[];
  regions: RegionDef[];
  shops: ShopDef[];
  items: ItemDef[];
}

export interface ContentRegistry {
  getNpc(id: string): NpcDef | undefined;
  getQuest(id: string): QuestDef | undefined;
  getRegion(id: string): RegionDef | undefined;
  getShop(id: string): ShopDef | undefined;
  getItem(id: string): ItemDef | undefined;
  allNpcs(): readonly NpcDef[];
  allQuests(): readonly QuestDef[];
  allRegions(): readonly RegionDef[];
  allShops(): readonly ShopDef[];
  allItems(): readonly ItemDef[];
  economy(): EconomyDef | undefined;
  /** Create a new registry that applies an update pack on top of this one. */
  merge(updatePack: ContentPack): ContentRegistry;
}

// ---------------------------------------------------------------------------
// Internal implementation
// ---------------------------------------------------------------------------

function checkNoDuplicates<T extends { id: string }>(items: T[], label: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) throw new Error(`Duplicate ${label} id: ${item.id}`);
    seen.add(item.id);
  }
}

/**
 * Build a Map<id, T> from multiple arrays; later entries overwrite earlier ones
 * (used when merging update packs).
 */
function mergeIntoMap<T extends { id: string }>(
  ...arrays: T[][]
): Map<string, T> {
  const map = new Map<string, T>();
  for (const arr of arrays) {
    for (const item of arr) map.set(item.id, item);
  }
  return map;
}

class RegistryImpl implements ContentRegistry {
  private readonly npcsMap: Map<string, NpcDef>;
  private readonly questsMap: Map<string, QuestDef>;
  private readonly regionsMap: Map<string, RegionDef>;
  private readonly shopsMap: Map<string, ShopDef>;
  private readonly itemsMap: Map<string, ItemDef>;
  private readonly _economy: EconomyDef | undefined;

  constructor(pack: ContentPack, economy?: EconomyDef) {
    // Within a single pack, duplicates are programming errors.
    checkNoDuplicates(pack.npcs, 'npc');
    checkNoDuplicates(pack.quests, 'quest');
    checkNoDuplicates(pack.regions, 'region');
    checkNoDuplicates(pack.shops, 'shop');
    checkNoDuplicates(pack.items, 'item');

    this.npcsMap = mergeIntoMap(pack.npcs);
    this.questsMap = mergeIntoMap(pack.quests);
    this.regionsMap = mergeIntoMap(pack.regions);
    this.shopsMap = mergeIntoMap(pack.shops);
    this.itemsMap = mergeIntoMap(pack.items);
    this._economy = economy;
  }

  /** Internal constructor for merged registries; skips duplicate check on merged maps. */
  static fromMaps(
    npcsMap: Map<string, NpcDef>,
    questsMap: Map<string, QuestDef>,
    regionsMap: Map<string, RegionDef>,
    shopsMap: Map<string, ShopDef>,
    itemsMap: Map<string, ItemDef>,
    economy?: EconomyDef,
  ): RegistryImpl {
    const reg = Object.create(RegistryImpl.prototype) as RegistryImpl;
    (reg as unknown as { npcsMap: Map<string, NpcDef> }).npcsMap = npcsMap;
    (reg as unknown as { questsMap: Map<string, QuestDef> }).questsMap = questsMap;
    (reg as unknown as { regionsMap: Map<string, RegionDef> }).regionsMap = regionsMap;
    (reg as unknown as { shopsMap: Map<string, ShopDef> }).shopsMap = shopsMap;
    (reg as unknown as { itemsMap: Map<string, ItemDef> }).itemsMap = itemsMap;
    (reg as unknown as { _economy: EconomyDef | undefined })._economy = economy;
    return reg;
  }

  getNpc(id: string): NpcDef | undefined { return this.npcsMap.get(id); }
  getQuest(id: string): QuestDef | undefined { return this.questsMap.get(id); }
  getRegion(id: string): RegionDef | undefined { return this.regionsMap.get(id); }
  getShop(id: string): ShopDef | undefined { return this.shopsMap.get(id); }
  getItem(id: string): ItemDef | undefined { return this.itemsMap.get(id); }

  allNpcs(): readonly NpcDef[] { return [...this.npcsMap.values()]; }
  allQuests(): readonly QuestDef[] { return [...this.questsMap.values()]; }
  allRegions(): readonly RegionDef[] { return [...this.regionsMap.values()]; }
  allShops(): readonly ShopDef[] { return [...this.shopsMap.values()]; }
  allItems(): readonly ItemDef[] { return [...this.itemsMap.values()]; }
  economy(): EconomyDef | undefined { return this._economy; }

  merge(updatePack: ContentPack): ContentRegistry {
    // Update pack may reference ids already in base; that is intentional.
    // Within the update pack itself, duplicates are still errors.
    checkNoDuplicates(updatePack.npcs, 'npc');
    checkNoDuplicates(updatePack.quests, 'quest');
    checkNoDuplicates(updatePack.regions, 'region');
    checkNoDuplicates(updatePack.shops, 'shop');
    checkNoDuplicates(updatePack.items, 'item');

    return RegistryImpl.fromMaps(
      mergeIntoMap([...this.npcsMap.values()], updatePack.npcs),
      mergeIntoMap([...this.questsMap.values()], updatePack.quests),
      mergeIntoMap([...this.regionsMap.values()], updatePack.regions),
      mergeIntoMap([...this.shopsMap.values()], updatePack.shops),
      mergeIntoMap([...this.itemsMap.values()], updatePack.items),
      this._economy,
    );
  }
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Build a registry from a single content pack.  Pass the base pack first,
 * then call .merge() for each update pack.
 */
export function buildRegistry(pack: ContentPack, economy?: EconomyDef): ContentRegistry {
  return new RegistryImpl(pack, economy);
}

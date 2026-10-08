import { z } from 'zod';
import {
  ContentSchemas,
  EconomySchema,
  FishingSchema,
  ItemSchema,
  ManifestSchema,
  NpcSchema,
  QuestSchema,
  RegionSchema,
  ShopSchema,
  type EconomyDef,
  type FishingDef,
  type ItemDef,
  type ManifestDef,
  type NpcDef,
  type QuestDef,
  type RegionDef,
  type ShopDef,
} from './schema';
import { buildRegistry, type ContentRegistry } from './registry';

/** JSON-shaped input accepted by loadPackFromJson. */
export interface RawContentPack {
  manifest: unknown;
  npcs: unknown;
  quests: unknown;
  regions: unknown;
  shops: unknown;
  items: unknown;
  economy?: unknown;
  fishing?: unknown;
}

export interface LoadedContentPack {
  registry: ContentRegistry;
  manifest: ManifestDef;
  economy?: EconomyDef;
  fishing?: FishingDef;
}

/** A small helper that makes Zod errors actionable for CLI and runtime logs. */
function parseNamed<T>(label: string, value: unknown, schema: z.ZodType<T>): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid ${label}: ${details}`);
  }
  return result.data;
}

function parseArray<T>(label: string, value: unknown, schema: z.ZodType<T>): T[] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${label}: expected an array`);
  return value.map((entry) => {
    // Include the item's id field in the error context when available.
    const idHint =
      entry !== null && typeof entry === 'object' && 'id' in entry &&
      typeof (entry as Record<string, unknown>).id === 'string'
        ? ` (id: ${String((entry as Record<string, unknown>).id)})`
        : '';
    return parseNamed(`${label}${idHint}`, entry, schema);
  });
}

/**
 * Load a pack from already-decoded JSON.  This is intentionally side-effect
 * free so the same path is usable in browser runtime, CLI, and unit tests.
 *
 * Returns a ContentRegistry ready for use at runtime.
 */
export function loadPackFromJson(raw: RawContentPack): ContentRegistry {
  parseNamed('manifest', raw.manifest, ManifestSchema);
  const npcs = parseArray('npc', raw.npcs, NpcSchema) as NpcDef[];
  const quests = parseArray('quest', raw.quests, QuestSchema) as QuestDef[];
  const regions = parseArray('region', raw.regions, RegionSchema) as RegionDef[];
  const shops = parseArray('shop', raw.shops, ShopSchema) as ShopDef[];
  const items = parseArray('item', raw.items, ItemSchema) as ItemDef[];
  const economy =
    raw.economy === undefined
      ? undefined
      : (parseNamed('economy', raw.economy, EconomySchema) as EconomyDef);
  // Validate fishing even though registry does not yet expose fishing behavior.
  if (raw.fishing !== undefined) parseNamed('fishing', raw.fishing, FishingSchema);

  return buildRegistry({ npcs, quests, regions, shops, items }, economy);
}

/**
 * Fully loaded form for callers that need the manifest or the fishing table.
 */
export function loadContentPack(raw: RawContentPack): LoadedContentPack {
  const manifest = parseNamed('manifest', raw.manifest, ManifestSchema) as ManifestDef;
  const npcs = parseArray('npc', raw.npcs, NpcSchema) as NpcDef[];
  const quests = parseArray('quest', raw.quests, QuestSchema) as QuestDef[];
  const regions = parseArray('region', raw.regions, RegionSchema) as RegionDef[];
  const shops = parseArray('shop', raw.shops, ShopSchema) as ShopDef[];
  const items = parseArray('item', raw.items, ItemSchema) as ItemDef[];
  const economy =
    raw.economy === undefined
      ? undefined
      : (parseNamed('economy', raw.economy, EconomySchema) as EconomyDef);
  const fishing =
    raw.fishing === undefined
      ? undefined
      : (parseNamed('fishing', raw.fishing, FishingSchema) as FishingDef);
  return {
    registry: buildRegistry({ npcs, quests, regions, shops, items }, economy),
    manifest,
    economy,
    fishing,
  };
}

/**
 * Fetch the bundled base pack from a public content root.
 * Files are kept separate so the same JSON can be packed into an APK
 * or distributed as a download pack later (U5).
 */
export async function loadBundledContent(baseUrl = '/content/base'): Promise<LoadedContentPack> {
  const names = [
    'manifest', 'npcs', 'quests', 'regions', 'shops', 'items', 'economy', 'fishing',
  ] as const;
  const responses = await Promise.all(
    names.map(async (name) => {
      const res = await fetch(`${baseUrl}/${name}.json`);
      if (!res.ok)
        throw new Error(`Unable to load content/${name}.json (HTTP ${res.status})`);
      return [name, await res.json()] as const;
    }),
  );
  const json = Object.fromEntries(responses);
  return loadContentPack(json as unknown as RawContentPack);
}

/**
 * Adapter that reads from a ContentUpdateManager-compatible source (bundled or staged/active downloaded packs).
 * Used by the runtime to initialize the registry at app launch.
 */
export async function loadContentFromSource(source: {
  activeManifest(): Promise<ManifestDef>;
  readFile(path: string): Promise<Uint8Array>;
}): Promise<LoadedContentPack> {
  const manifest = await source.activeManifest();
  const decoder = new TextDecoder();
  const names = ['npcs', 'quests', 'regions', 'shops', 'items', 'economy', 'fishing'] as const;
  const entries = await Promise.all(
    names.map(async (name) => {
      try {
        const bytes = await source.readFile(`${name}.json`);
        return [name, JSON.parse(decoder.decode(bytes))];
      } catch {
        return [name, name === 'npcs' || name === 'quests' || name === 'regions' || name === 'shops' || name === 'items' ? [] : undefined];
      }
    }),
  );
  const json = { manifest, ...Object.fromEntries(entries) };
  return loadContentPack(json as unknown as RawContentPack);
}

/** Re-exported for CLI tools that need the schema map. */
export { ContentSchemas };
export type { NpcDef, QuestDef, RegionDef, ShopDef, ItemDef, EconomyDef, FishingDef, ManifestDef };


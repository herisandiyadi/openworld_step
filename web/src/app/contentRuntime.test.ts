import { describe, it, expect, beforeEach } from 'vitest';
import { loadContentPack } from '../content/loader';
import { bootstrapContentRuntime } from './contentRuntime';
import { contentRuntime } from './contentRuntime';
import baseManifest from '../../content/base/manifest.json';
import baseNpcs from '../../content/base/npcs.json';
import baseQuests from '../../content/base/quests.json';
import baseRegions from '../../content/base/regions.json';
import baseShops from '../../content/base/shops.json';
import baseItems from '../../content/base/items.json';
import baseEconomy from '../../content/base/economy.json';
import baseFishing from '../../content/base/fishing.json';

describe('contentRuntime bootstrap', () => {
  beforeEach(() => {
    contentRuntime.registry = null;
    contentRuntime.manifest = null;
    contentRuntime.economy = null;
    contentRuntime.fishing = null;
  });

  it('loads bundled base pack', () => {
    const pack = loadContentPack({
      manifest: baseManifest,
      npcs: baseNpcs,
      quests: baseQuests,
      regions: baseRegions,
      shops: baseShops,
      items: baseItems,
      economy: baseEconomy,
      fishing: baseFishing,
    });

    contentRuntime.registry = pack.registry;
    contentRuntime.manifest = pack.manifest;
    contentRuntime.economy = pack.economy ?? null;
    contentRuntime.fishing = pack.fishing ?? null;

    expect(contentRuntime.registry).not.toBeNull();
    expect(contentRuntime.manifest?.id).toBe('base');
    expect(contentRuntime.economy?.currency).toBe('coins');
    expect(contentRuntime.fishing?.species).toHaveLength(6);
  });

  it('loads downloaded active content through the runtime source instead of bundled content', async () => {
    const downloaded = loadContentPack({
      manifest: { ...baseManifest, version: '1.1.0' },
      npcs: [{ ...baseNpcs[0], name: 'Downloaded NPC' }],
      quests: baseQuests,
      regions: baseRegions,
      shops: baseShops,
      items: baseItems,
      economy: baseEconomy,
      fishing: baseFishing,
    });

    const loaded = await bootstrapContentRuntime({
      activeManifest: async () => downloaded.manifest,
      readFile: async (path) => new TextEncoder().encode(JSON.stringify({
        'npcs.json': [{ ...baseNpcs[0], name: 'Downloaded NPC' }],
        'quests.json': baseQuests,
        'regions.json': baseRegions,
        'shops.json': baseShops,
        'items.json': baseItems,
        'economy.json': baseEconomy,
        'fishing.json': baseFishing,
      }[path])),
    }, loadContentPack({
      manifest: baseManifest,
      npcs: baseNpcs,
      quests: baseQuests,
      regions: baseRegions,
      shops: baseShops,
      items: baseItems,
      economy: baseEconomy,
      fishing: baseFishing,
    }));

    expect(loaded.registry.getNpc(baseNpcs[0]!.id)?.name).toBe('Downloaded NPC');
    expect(contentRuntime.manifest?.version).toBe('1.1.0');
  });

  it('exposes quest defs', () => {
    const pack = loadContentPack({
      manifest: baseManifest,
      npcs: baseNpcs,
      quests: baseQuests,
      regions: baseRegions,
      shops: baseShops,
      items: baseItems,
      economy: baseEconomy,
      fishing: baseFishing,
    });
    contentRuntime.registry = pack.registry;

    const quests = contentRuntime.registry.allQuests();
    expect(quests.length).toBeGreaterThan(0);
  });
});

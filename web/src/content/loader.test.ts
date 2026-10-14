/**
 * Tests for the content loader (web/src/content/loader.ts).
 *
 * The loader reads bundled JSON files from the base content pack,
 * validates each one through its Zod schema, and returns a ContentRegistry.
 * These tests use in-memory stub data – no real file I/O, no network.
 */

import { describe, expect, it } from 'vitest';
import { loadContentFromSource, loadPackFromJson, type RawContentPack } from './loader';

// ---------------------------------------------------------------------------
// Minimal valid stub data
// ---------------------------------------------------------------------------

const stubNpcs = [
  {
    id: 'npc_budi', name: 'Pak Budi', asset: 'npc_vendor',
    x: 5, z: 10, yaw: 1.57, region: 'downtown',
    dialogue: 'dialogue/npc_budi.json', questGiver: [],
  },
];

const stubQuests = [
  {
    id: 'q_kenalan', title: 'Kenalan dengan warga', giver: 'npc_budi',
    requires: [], repeatable: false,
    steps: [{ type: 'talk', npc: 'npc_budi', text: 'Halo' }],
    rewards: { coins: 20, items: [] },
  },
];

const stubRegions = [
  { id: 'downtown', name: 'Pusat Kota', bounds: { minX: -128, maxX: 128, minZ: -128, maxZ: 128 } },
];

const stubManifest = {
  id: 'base', version: '1.0.0', minAppVersion: '0.1.0', worldVersion: 2,
  files: [{ path: 'npcs.json', sha256: 'a'.repeat(64), size: 10 }],
};

const stubPack: RawContentPack = {
  manifest: stubManifest,
  npcs: stubNpcs,
  quests: stubQuests,
  regions: stubRegions,
  shops: [],
  items: [],
  economy: { currency: 'coins', dailyBonus: 20, busFare: 5, jobs: [] },
};

describe('loadPackFromJson', () => {
  it('returns a registry with NPCs / quests / regions from valid JSON', () => {
    const reg = loadPackFromJson(stubPack);
    expect(reg.getNpc('npc_budi')?.name).toBe('Pak Budi');
    expect(reg.getQuest('q_kenalan')?.title).toBe('Kenalan dengan warga');
    expect(reg.getRegion('downtown')?.id).toBe('downtown');
  });

  it('exposes economy through the registry', () => {
    const reg = loadPackFromJson(stubPack);
    expect(reg.economy()?.currency).toBe('coins');
  });

  it('throws a descriptive error when an NPC fails schema validation', () => {
    const badPack: RawContentPack = {
      ...stubPack,
      npcs: [{ id: '../hacked', name: 'Bad', asset: 'npc_vendor', x: 0, z: 0, yaw: 0, region: 'downtown', dialogue: 'ok.json', questGiver: [] }],
    };
    expect(() => loadPackFromJson(badPack)).toThrow(/npc.*hacked/i);
  });

  it('throws a descriptive error when a quest step has radius 0', () => {
    const badPack: RawContentPack = {
      ...stubPack,
      quests: [{
        id: 'q_bad', title: 'Bad', giver: 'npc_budi',
        requires: [], repeatable: false,
        steps: [{ type: 'reach', x: 0, z: 0, radius: 0, text: 'bad' }],
        rewards: {},
      }],
    };
    expect(() => loadPackFromJson(badPack)).toThrow(/quest.*q_bad/i);
  });

  it('throws a descriptive error when the manifest has an unsafe path', () => {
    const badPack: RawContentPack = {
      ...stubPack,
      manifest: {
        ...stubManifest,
        files: [{ path: '../outside.json', sha256: 'a'.repeat(64), size: 1 }],
      },
    };
    expect(() => loadPackFromJson(badPack)).toThrow(/manifest/i);
  });

  it('succeeds with empty optional arrays', () => {
    const minimalPack: RawContentPack = {
      manifest: stubManifest,
      npcs: [],
      quests: [],
      regions: [],
      shops: [],
      items: [],
    };
    const reg = loadPackFromJson(minimalPack);
    expect(reg.allNpcs()).toHaveLength(0);
    expect(reg.economy()).toBeUndefined();
  });

  it('loads registry JSON through an active content source', async () => {
    const files: Record<string, unknown> = {
      'npcs.json': stubNpcs,
      'quests.json': stubQuests,
      'regions.json': stubRegions,
      'shops.json': [],
      'items.json': [],
    };
    const loaded = await loadContentFromSource({
      activeManifest: async () => stubManifest,
      readFile: async (path) => new TextEncoder().encode(JSON.stringify(files[path])),
    });
    expect(loaded.registry.getNpc('npc_budi')?.name).toBe('Pak Budi');
  });
});

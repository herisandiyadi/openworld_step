import { describe, expect, it } from 'vitest';
import type { NpcDef, QuestDef, RegionDef } from './schema';
import { buildRegistry, type ContentRegistry } from './registry';

// ---------------------------------------------------------------------------
// Minimal valid fixture objects
// ---------------------------------------------------------------------------

function npc(id: string, region = 'downtown'): NpcDef {
  return {
    id,
    name: id,
    asset: 'npc_vendor',
    x: 0,
    z: 0,
    yaw: 0,
    region,
    questGiver: [],
    retired: false,
    dialogue: `dialogue/${id}.json`,
  };
}

function quest(id: string, giver: string): QuestDef {
  return {
    id,
    title: id,
    giver,
    requires: [],
    repeatable: false,
    steps: [{ type: 'talk', npc: giver, text: 'hello' }],
    rewards: { coins: 0, items: [] },
    retired: false,
  };
}

function region(id: string): RegionDef {
  return {
    id,
    name: id,
    bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 },
    busStops: [],
    retired: false,
  };
}

function baseRegistry(): ContentRegistry {
  return buildRegistry({
    npcs: [npc('npc_budi'), npc('npc_sari', 'residential')],
    quests: [quest('q_kenalan', 'npc_budi')],
    regions: [region('downtown'), region('residential')],
    shops: [],
    items: [],
  });
}

describe('ContentRegistry', () => {
  it('looks up an NPC by id', () => {
    const reg = baseRegistry();
    expect(reg.getNpc('npc_budi')?.name).toBe('npc_budi');
    expect(reg.getNpc('nonexistent')).toBeUndefined();
  });

  it('looks up a quest by id', () => {
    const reg = baseRegistry();
    expect(reg.getQuest('q_kenalan')?.giver).toBe('npc_budi');
  });

  it('looks up a region by id', () => {
    const reg = baseRegistry();
    expect(reg.getRegion('residential')?.id).toBe('residential');
  });

  it('exposes typed read-only arrays for each entity kind', () => {
    const reg = baseRegistry();
    expect(reg.allNpcs().length).toBe(2);
    expect(reg.allQuests().length).toBe(1);
    expect(reg.allRegions().length).toBe(2);
  });

  it('throws when an id appears more than once', () => {
    expect(() =>
      buildRegistry({
        npcs: [npc('npc_budi'), npc('npc_budi')],
        quests: [],
        regions: [],
        shops: [],
        items: [],
      }),
    ).toThrow(/duplicate.*npc_budi/i);
  });

  it('merges an update pack by overwriting existing ids and adding new ones', () => {
    const reg = baseRegistry();
    const updated = reg.merge({
      npcs: [{ ...npc('npc_budi'), name: 'Pak Budi Updated' }],
      quests: [quest('q_new', 'npc_sari')],
      regions: [],
      shops: [],
      items: [],
    });
    expect(updated.getNpc('npc_budi')?.name).toBe('Pak Budi Updated');
    expect(updated.allQuests().length).toBe(2);
  });

  it('does NOT throw when an update pack overwrites an id from base', () => {
    expect(() =>
      baseRegistry().merge({
        npcs: [npc('npc_budi')],
        quests: [],
        regions: [],
        shops: [],
        items: [],
      }),
    ).not.toThrow();
  });

  it('keeps retired NPCs in the registry but marks them', () => {
    const reg = buildRegistry({
      npcs: [{ ...npc('npc_old'), retired: true }],
      quests: [],
      regions: [],
      shops: [],
      items: [],
    });
    expect(reg.getNpc('npc_old')?.retired).toBe(true);
    // allNpcs includes retired (so saves referencing them stay valid)
    expect(reg.allNpcs().length).toBe(1);
  });
});

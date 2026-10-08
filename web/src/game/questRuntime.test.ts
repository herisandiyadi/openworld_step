import { describe, it, expect, beforeEach } from 'vitest';
import { useContentProgress } from '../state/contentProgress';
import { initQuests, routeQuestEvent, activeQuestSummaries, resetQuestRuntime } from './questRuntime';
import type { ContentRegistry } from '../content/registry';
import { loadContentPack } from '../content/loader';
import baseManifest from '../../content/base/manifest.json';
import baseNpcs from '../../content/base/npcs.json';
import baseQuests from '../../content/base/quests.json';
import baseRegions from '../../content/base/regions.json';
import baseShops from '../../content/base/shops.json';
import baseItems from '../../content/base/items.json';

function baseRegistry(): ContentRegistry {
  return loadContentPack({
    manifest: baseManifest,
    npcs: baseNpcs,
    quests: baseQuests,
    regions: baseRegions,
    shops: baseShops,
    items: baseItems,
  }).registry;
}

describe('questRuntime', () => {
  beforeEach(() => {
    resetQuestRuntime();
    useContentProgress.setState({ quests: [], coins: 0, ledger: [] });
  });

  it('seeds quest states from the content registry', () => {
    initQuests(baseRegistry());
    const quests = useContentProgress.getState().quests;
    expect(quests.length).toBeGreaterThan(0);
    const first = quests.find((q) => q.questId === 'q_kenalan');
    expect(first).toBeDefined();
    expect(first!.status).toBe('active');
  });

  it('routes a talk event and grants the quest reward through contentProgress', () => {
    initQuests(baseRegistry());
    const npcs = ['npc_budi', 'npc_sari', 'npc_rina', 'npc_dewi', 'npc_joko'];
    for (const npc of npcs) routeQuestEvent({ type: 'talk', npc });

    const quest = useContentProgress.getState().quests.find((q) => q.questId === 'q_kenalan');
    expect(quest!.status).toBe('completed');
    expect(useContentProgress.getState().coins).toBe(20);
  });

  it('omits out-of-range talk events', () => {
    initQuests(baseRegistry());
    routeQuestEvent({ type: 'talk', npc: 'npc_unknown' });
    const quest = useContentProgress.getState().quests.find((q) => q.questId === 'q_kenalan');
    expect(quest!.step).toBe(0);
  });

  it('exposes active quest summaries for HUD and NPC context', () => {
    initQuests(baseRegistry());
    routeQuestEvent({ type: 'talk', npc: 'npc_budi' });
    const summaries = activeQuestSummaries();
    expect(summaries.some((s) => s.title.includes('Kenalan'))).toBe(true);
    expect(summaries.every((s) => s.status === 'active')).toBe(true);
  });
});

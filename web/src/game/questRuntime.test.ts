import { describe, it, expect, beforeEach } from 'vitest';
import { useContentProgress } from '../state/contentProgress';
import { initQuests, questNpcMarkerState, routeQuestEvent, activeQuestSummaries, resetQuestRuntime } from './questRuntime';
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

  it('computes live quest marker states for NPCs', () => {
    initQuests(baseRegistry());
    // A fresh active quest is offered by its giver; a later talk step is a turn-in.
    expect(questNpcMarkerState('npc_budi')).toBe('available');
    expect(questNpcMarkerState('npc_sari')).toBeNull();
    routeQuestEvent({ type: 'talk', npc: 'npc_budi' });
    expect(questNpcMarkerState('npc_sari')).toBe('turn-in');
    expect(questNpcMarkerState('npc_budi')).toBeNull();

    // Continue q_kenalan: the live current step moves the turn-in marker along
    // the chain, while locked quests do not produce markers at their givers.
    routeQuestEvent({ type: 'talk', npc: 'npc_sari' });
    expect(questNpcMarkerState('npc_rina')).toBe('turn-in');
    routeQuestEvent({ type: 'talk', npc: 'npc_rina' });
    expect(questNpcMarkerState('npc_dewi')).toBe('turn-in');
    routeQuestEvent({ type: 'talk', npc: 'npc_dewi' });
    expect(questNpcMarkerState('npc_joko')).toBe('turn-in');
    expect(questNpcMarkerState('npc_agus')).toBeNull();
  });
});

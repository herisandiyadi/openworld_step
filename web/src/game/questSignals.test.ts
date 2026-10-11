import { describe, it, expect, beforeEach } from 'vitest';
import { useContentProgress } from '../state/contentProgress';
import { useGameStore, NO_NEARBY } from '../state/gameStore';
import { resetQuestRuntime, initQuests } from './questRuntime';
import { routeDistrictSignal, routeTimeSignal, routeRideSignal, routeReachSignal } from './questSignals';
import { loadContentPack } from '../content/loader';
import baseManifest from '../../content/base/manifest.json';
import baseNpcs from '../../content/base/npcs.json';
import baseQuests from '../../content/base/quests.json';
import baseRegions from '../../content/base/regions.json';
import baseShops from '../../content/base/shops.json';
import baseItems from '../../content/base/items.json';
import { engineQuestDef } from './contentBridge';

function reg() {
  return loadContentPack({ manifest: baseManifest, npcs: baseNpcs, quests: baseQuests, regions: baseRegions, shops: baseShops, items: baseItems }).registry;
}

describe('questSignals', () => {
  beforeEach(() => {
    resetQuestRuntime();
    useContentProgress.setState({ quests: [], coins: 0, ledger: [] });
    useGameStore.setState({ nearby: { ...NO_NEARBY }, district: null });
  });

  it('routes a district signal into an active visit_district step', () => {
    // q_eksplorasi_industri step 0 is visit_district industrial.
    useContentProgress.setState({ quests: [{ questId: 'q_eksplorasi_industri', status: 'active', step: 0, progress: [{ current: 0, required: 1 }, { current: 0, required: 1 }, { current: 0, required: 1 }], completions: 0 }] });
    const def = engineQuestDef(reg().getQuest('q_eksplorasi_industri')!);
    useContentProgress.setState({ quests: [{ questId: def.id, status: 'active', step: 0, progress: [{ current: 0, required: 1 }, { current: 0, required: 1 }, { current: 0, required: 1 }], completions: 0 }] });
    // Register defs by running initQuests for the whole pack so the runtime knows the def.
    initQuests(reg());
    useContentProgress.setState({ quests: [{ questId: 'q_eksplorasi_industri', status: 'active', step: 0, progress: [{ current: 0, required: 1 }, { current: 0, required: 1 }, { current: 0, required: 1 }], completions: 0 }] });
    routeDistrictSignal('industrial');
    expect(useContentProgress.getState().quests.find((q) => q.questId === 'q_eksplorasi_industri')!.step).toBe(1);
  });

  it('routes a reach signal within the step radius', () => {
    initQuests(reg());
    // q_antar_paket step 1 is reach(69, -54, radius 6)
    useContentProgress.setState({ quests: [{ questId: 'q_antar_paket', status: 'active', step: 1, progress: [{ current: 1, required: 1 }, { current: 0, required: 1 }, { current: 0, required: 1 }], completions: 0 }] });
    routeReachSignal(70, -52);
    const state = useContentProgress.getState().quests.find((q) => q.questId === 'q_antar_paket')!;
    expect(state.step).toBe(2);
  });

  it('ignores reach signals outside radius', () => {
    initQuests(reg());
    useContentProgress.setState({ quests: [{ questId: 'q_antar_paket', status: 'active', step: 1, progress: [{ current: 1, required: 1 }, { current: 0, required: 1 }, { current: 0, required: 1 }], completions: 0 }] });
    routeReachSignal(100, 0);
    expect(useContentProgress.getState().quests.find((q) => q.questId === 'q_antar_paket')!.step).toBe(1);
  });

  it('routes a ride signal with coordinate destination matching', () => {
    initQuests(reg());
    // q_ojek_cepat step 1 is ride with destination {x:-123, z:74, radius:10}
    useContentProgress.setState({ quests: [{ questId: 'q_ojek_cepat', status: 'active', step: 1, progress: [{ current: 1, required: 1 }, { current: 0, required: 1 }], completions: 0 }] });
    routeRideSignal('scooter_standard', { x: -120, z: 72, radius: 0 }, 60);
    const state = useContentProgress.getState().quests.find((q) => q.questId === 'q_ojek_cepat')!;
    expect(state.completions).toBe(1);
    expect(state.status).toBe('active');
    expect(useContentProgress.getState().coins).toBe(20);
  });

  it('does nothing without quest state', () => {
    expect(() => routeTimeSignal(7)).not.toThrow();
  });
});

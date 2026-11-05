import { beforeEach, describe, expect, it } from 'vitest';
import { useContentProgress } from '../state/contentProgress';
import { resetJobRuntime, jobDefinitions } from '../game/jobRuntime';
import { resetQuestRuntime } from '../game/questRuntime';
import { loadContentPack } from '../content/loader';
import baseManifest from '../../content/base/manifest.json';
import baseNpcs from '../../content/base/npcs.json';
import baseQuests from '../../content/base/quests.json';
import baseRegions from '../../content/base/regions.json';
import baseShops from '../../content/base/shops.json';
import baseItems from '../../content/base/items.json';
import baseEconomy from '../../content/base/economy.json';
import baseFishing from '../../content/base/fishing.json';
import { contentRuntime } from './contentRuntime';
import { initQuests } from '../game/questRuntime';
import { initJobs } from '../game/jobRuntime';

function reset() {
  useContentProgress.setState({
    coins: 0,
    ledger: [],
    quests: [],
    inventory: { owned: [], equipped: {} },
    jobs: { date: '', completed: {} },
    bag: { capacity: 8, trashStackSize: 5, items: [] },
    transitPass: { activeDate: null },
    contentVersion: '',
    market: { dayIndex: 0, salesBySpecies: {} },
    bonusDate: '',
    disposeCoinsToday: 0,
  });
  resetJobRuntime();
  resetQuestRuntime();
  contentRuntime.registry = null;
  contentRuntime.manifest = null;
  contentRuntime.economy = null;
  contentRuntime.fishing = null;
}

describe('contentRuntime boot sequence (daily bonus + jobs)', () => {
  beforeEach(reset);

  it('loads bundled content pack, seeds quests, jobs, rolls daily state, and claims daily bonus exactly once per real date', () => {
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

    // Simulate App.tsx boot: initQuests, initJobs, rollDailyState, claimDailyBonus
    initQuests(pack.registry);
    initJobs(pack.registry, pack.economy);
    const date = new Date().toISOString().slice(0, 10);
    useContentProgress.getState().rollDailyState(date);
    const bonus = useContentProgress.getState().claimDailyBonus(date, pack.economy?.dailyBonus ?? 0);

    expect(useContentProgress.getState().quests.length).toBeGreaterThan(0);
    expect(jobDefinitions().length).toBeGreaterThan(0);
    expect(bonus).toBe(pack.economy?.dailyBonus ?? 0);
    expect(useContentProgress.getState().coins).toBe(pack.economy?.dailyBonus ?? 0);

    // Second claim same date → 0
    const second = useContentProgress.getState().claimDailyBonus(date, pack.economy?.dailyBonus ?? 0);
    expect(second).toBe(0);
    expect(useContentProgress.getState().coins).toBe(pack.economy?.dailyBonus ?? 0);
  });
});

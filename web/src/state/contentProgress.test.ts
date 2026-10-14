import { describe, expect, it } from 'vitest';
import { talked } from '../quest/questEvents';
import { useContentProgress } from './contentProgress';

const reset = (): void => {
  useContentProgress.setState({
    coins: 0,
    ledger: [],
    quests: [],
    inventory: { owned: [], equipped: {} },
    jobs: { date: '2026-01-01', completed: {} },
    bag: { capacity: 8, trashStackSize: 5, items: [] },
    transitPass: { activeDate: null },
    contentVersion: '',
    market: { dayIndex: 0, salesBySpecies: {} },
    bonusDate: '',
    disposeCoinsToday: 0,
  });
};

describe('content progress coordinator', () => {
  it('applies a quest reward once and keeps the wallet non-negative', () => {
    reset();
    const quest = {
      id: 'q_test', title: 'Test', repeatable: false,
      steps: [{ type: 'talk' as const, npc: 'npc_test' }],
      rewards: { coins: 10, items: ['tool_net'] },
    };
    useContentProgress.setState({ quests: [{ questId: 'q_test', status: 'active', step: 0, progress: [{ current: 0, required: 1 }], completions: 0 }] });
    expect(useContentProgress.getState().dispatchQuestEvent([quest], talked('npc_test'))).toHaveLength(2);
    expect(useContentProgress.getState().coins).toBe(10);
    expect(useContentProgress.getState().dispatchQuestEvent([quest], talked('npc_test'))).toEqual([]);
    expect(useContentProgress.getState().coins).toBe(10);
    expect(useContentProgress.getState().inventory.owned.map((item) => item.id)).toEqual(['tool_net']);
  });

  it('rejects unaffordable purchases and charges affordable ones atomically', () => {
    reset();
    expect(useContentProgress.getState().purchaseStoreItem({ id: 'rod_basic', category: 'tool', retired: false, price: 5 })).toBe(false);
    expect(useContentProgress.getState().coins).toBe(0);
    useContentProgress.getState().directCredit(10, 'test');
    expect(useContentProgress.getState().purchaseStoreItem({ id: 'rod_basic', category: 'tool', retired: false, price: 5 })).toBe(true);
    expect(useContentProgress.getState().coins).toBe(5);
    expect(useContentProgress.getState().purchaseStoreItem({ id: 'rod_basic', category: 'tool', retired: false, price: 5 })).toBe(false);
  });

  it('limits dispose rewards by day and grants daily bonus once per date', () => {
    reset();
    useContentProgress.getState().addFishToBag({ id: 'trash-1', kind: 'trash', trashType: 'can', qty: 3 });
    expect(useContentProgress.getState().disposeBagTrash(true, '2026-01-01', 1, 2)).toEqual({ coins: 2, qty: 3 });
    expect(useContentProgress.getState().claimDailyBonus('2026-01-01', 25)).toBe(25);
    expect(useContentProgress.getState().claimDailyBonus('2026-01-01', 25)).toBe(0);
    expect(useContentProgress.getState().coins).toBe(27);
  });

  it('supports fish add, release, sale and market counters', () => {
    reset();
    expect(useContentProgress.getState().addFishToBag({ id: 'fish-1', kind: 'fish', species: 'nila', weight: 1, qty: 1 })).toBe(true);
    expect(useContentProgress.getState().sellBagFish(['fish-1'], () => 7)).toBe(7);
    expect(useContentProgress.getState().coins).toBe(7);
    expect(useContentProgress.getState().market.salesBySpecies.nila).toBe(1);
    expect(useContentProgress.getState().addFishToBag({ id: 'fish-2', kind: 'fish', species: 'lele', weight: 1, qty: 1 })).toBe(true);
    expect(useContentProgress.getState().releaseOneFish('fish-2', true)).toBe(true);
  });

  it('charges bus fare and day passes without allowing negative balances', () => {
    reset();
    expect(useContentProgress.getState().rideBusWithFare(5, '2026-01-01')).toBe(false);
    useContentProgress.getState().directCredit(10, 'test');
    expect(useContentProgress.getState().buyTransitDayPass(5, '2026-01-01')).toBe(true);
    expect(useContentProgress.getState().rideBusWithFare(5, '2026-01-01')).toBe(true);
    expect(useContentProgress.getState().coins).toBe(5);
  });
});

import { create } from 'zustand';
import { createBag, addBagItem, disposeTrash, releaseFish, sellFish, type Bag, type BagItem, type DisposeOptions } from '../economy/bag';
import { createWallet, credit, debit, type Wallet } from '../economy/wallet';
import { createInventory, addOwnedItem, equipItem, type Inventory, type OwnedItem } from '../economy/inventory';
import { createDailyJobs, completeJob, rollDailyJobs, type DailyJobs, type JobDefinition } from '../economy/dailyJobs';
import { type QuestDef, type QuestState, type QuestOutputEvent, applyQuestEvent, refreshQuestState } from '../quest/questEngine';
import { type QuestEvent } from '../quest/questEvents';
import { rideBus, buyDayPass, createTransitPass, type TransitPass } from '../economy/busFare';

export interface ContentProgressState {
  coins: number;
  ledger: ReturnType<typeof createWallet>['ledger'];
  quests: QuestState[];
  inventory: Inventory;
  jobs: DailyJobs;
  bag: Bag;
  transitPass: TransitPass;
  contentVersion: string;
  /** Per-in-game-day market sale counters by species (fish market saturation). */
  market: { dayIndex: number; salesBySpecies: Record<string, number> };
  /** Real calendar date (YYYY-MM-DD) the daily login bonus was last claimed. */
  bonusDate: string;
  disposeCoinsToday: number;
}

interface ContentProgressStore extends ContentProgressState {
  dispatchQuestEvent: (questDefs: readonly QuestDef[], event: QuestEvent) => QuestOutputEvent[];
  purchaseStoreItem: (item: OwnedItem & { price: number }) => boolean;
  equipStoreItem: (itemId: string) => void;
  completeJobTask: (job: JobDefinition, date: string) => number;
  rideBusWithFare: (fare: number, date: string) => boolean;
  buyTransitDayPass: (price: number, date: string) => boolean;
  disposeBagTrash: (atBin: boolean, date: string, coinsPerTrash?: number, dailyLimit?: number) => { coins: number; qty: number };
  releaseOneFish: (itemId: string, nearWater: boolean) => boolean;
  sellBagFish: (ids: readonly string[], priceOf: (item: BagItem) => number) => number;
  addFishToBag: (fish: BagItem) => boolean;
  rollDailyState: (date: string) => void;
  claimDailyBonus: (date: string, amount?: number) => number;
  rollMarketDay: (dayIndex: number) => void;
  directCredit: (amount: number, reason: string) => void;
  refreshQuestLocks: (questDefs: readonly QuestDef[]) => void;
  setContentVersion: (version: string) => void;
}

const DISPOSE_DAILY_LIMIT = 50;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function completedQuestIds(quests: readonly QuestState[]): string[] {
  return quests.filter((q) => q.status === 'completed' || q.completions > 0).map((q) => q.questId);
}

export const useContentProgress = create<ContentProgressStore>((set, get) => ({
  coins: 0,
  ledger: [],
  quests: [],
  inventory: createInventory(),
  jobs: createDailyJobs(today()),
  bag: createBag(8, 5),
  transitPass: createTransitPass(),
  contentVersion: '',
  market: { dayIndex: 0, salesBySpecies: {} },
  bonusDate: '',
  disposeCoinsToday: 0,

  dispatchQuestEvent: (questDefs, event) => {
    const state = get();
    let quests = state.quests;
    let wallet: Wallet = { balance: state.coins, ledger: state.ledger };
    let inventory = state.inventory;
    const allEvents: QuestOutputEvent[] = [];

    for (let i = 0; i < quests.length; i++) {
      const quest = quests[i];
      if (!quest || quest.status !== 'active') continue;
      const def = questDefs.find((d) => d.id === quest.questId);
      if (!def) continue;
      const result = applyQuestEvent(def, quest, event);
      if (result.events.length === 0) continue;
      quests = quests.map((q, idx) => (idx === i ? result.state : q));
      allEvents.push(...result.events);
      for (const evt of result.events) {
        if (evt.type === 'reward') {
          if (evt.coins !== undefined && evt.coins > 0) {
            const cr = credit(wallet, evt.coins, `quest:${evt.questId}`);
            if (cr.ok) wallet = cr.wallet;
          }
          if (evt.items !== undefined) {
            for (const itemId of evt.items) {
              inventory = addOwnedItem(inventory, { id: itemId, category: 'tool', retired: false });
            }
          }
        }
      }
    }

    if (allEvents.length > 0) {
      set({ quests, coins: wallet.balance, ledger: wallet.ledger, inventory });
    }
    return allEvents;
  },

  purchaseStoreItem: (item) => {
    const state = get();
    if (item.retired || !Number.isInteger(item.price) || item.price < 0 || state.inventory.owned.some((owned) => owned.id === item.id)) return false;
    const wallet: Wallet = { balance: state.coins, ledger: state.ledger };
    if (item.price > 0) {
      const payment = debit(wallet, item.price, `store:${item.id}`);
      if (!payment.ok) return false;
      set({ coins: payment.wallet.balance, ledger: payment.wallet.ledger, inventory: addOwnedItem(state.inventory, item) });
    } else {
      set({ inventory: addOwnedItem(state.inventory, item) });
    }
    return true;
  },

  equipStoreItem: (itemId) => {
    const state = get();
    set({ inventory: equipItem(state.inventory, itemId) });
  },

  completeJobTask: (job, date) => {
    const state = get();
    const jobs = rollDailyJobs(state.jobs, date);
    const result = completeJob(jobs, job, date);
    if (!result.ok) return 0;
    const wallet: Wallet = { balance: state.coins, ledger: state.ledger };
    const cr = credit(wallet, result.rewardCoins, `job:${job.id}`);
    if (!cr.ok) return 0;
    set({ jobs: result.jobs, coins: cr.wallet.balance, ledger: cr.wallet.ledger });
    return result.rewardCoins;
  },

  rideBusWithFare: (fare, date) => {
    const state = get();
    const pass = state.transitPass;
    const hasValidPass = pass.activeDate === date;
    const wallet: Wallet = { balance: state.coins, ledger: state.ledger };
    const result = rideBus(wallet, fare, hasValidPass);
    if (!result.ok) return false;
    set({ coins: result.wallet.balance, ledger: result.wallet.ledger });
    return true;
  },

  buyTransitDayPass: (price, date) => {
    const state = get();
    const wallet: Wallet = { balance: state.coins, ledger: state.ledger };
    const result = buyDayPass(wallet, price, date);
    if (!result.ok) return false;
    set({ coins: result.wallet.balance, ledger: result.wallet.ledger, transitPass: result.pass });
    return true;
  },

  disposeBagTrash: (atBin, date, coinsPerTrash = 1, dailyLimit = DISPOSE_DAILY_LIMIT) => {
    const state = get();
    const jobs = rollDailyJobs(state.jobs, date);
    const disposeCoins = jobs.date === state.jobs.date ? state.disposeCoinsToday : 0;
    const options: DisposeOptions = { atTrashBin: atBin, coinsEarnedToday: disposeCoins, dailyCoinLimit: dailyLimit, coinsPerTrash };
    const result = disposeTrash(state.bag, options);
    if (!result.ok) return { coins: 0, qty: 0 };
    const wallet: Wallet = { balance: state.coins, ledger: state.ledger };
    const cr = result.coins > 0 ? credit(wallet, result.coins, 'dispose:trash') : { ok: true, wallet };
    if (!cr.ok) return { coins: 0, qty: 0 };
    set({ bag: result.bag, coins: cr.wallet.balance, ledger: cr.wallet.ledger, disposeCoinsToday: disposeCoins + result.coins, jobs });
    return { coins: result.coins, qty: result.removedQty };
  },

  releaseOneFish: (itemId, nearWater) => {
    const state = get();
    const result = releaseFish(state.bag, itemId, nearWater);
    if (!result.ok) return false;
    set({ bag: result.bag });
    return true;
  },

  sellBagFish: (ids, priceOf) => {
    const state = get();
    const result = sellFish(state.bag, ids, priceOf);
    if (result.coins === 0) return 0;
    const wallet: Wallet = { balance: state.coins, ledger: state.ledger };
    const cr = credit(wallet, result.coins, 'market:fish');
    if (!cr.ok) return 0;
    let market = state.market;
    for (const item of result.sold) {
      const species = item.species ?? 'unknown';
      const rolled = market.dayIndex === market.dayIndex ? market : { dayIndex: market.dayIndex, salesBySpecies: {} };
      market = { dayIndex: rolled.dayIndex, salesBySpecies: { ...rolled.salesBySpecies, [species]: (rolled.salesBySpecies[species] ?? 0) + 1 } };
    }
    set({ bag: result.bag, coins: cr.wallet.balance, ledger: cr.wallet.ledger, market });
    return result.coins;
  },

  addFishToBag: (fish) => {
    const state = get();
    const result = addBagItem(state.bag, fish);
    if (!result.ok) return false;
    set({ bag: result.bag });
    return true;
  },

  rollDailyState: (date) => {
    const state = get();
    const jobs = rollDailyJobs(state.jobs, date);
    const disposeCoins = jobs.date === state.jobs.date ? state.disposeCoinsToday : 0;
    set({ jobs, disposeCoinsToday: disposeCoins });
  },

  claimDailyBonus: (date, amount = 25) => {
    const state = get();
    if (state.bonusDate === date) return 0;
    const wallet: Wallet = { balance: state.coins, ledger: state.ledger };
    const cr = credit(wallet, amount, 'bonus:daily');
    if (!cr.ok) return 0;
    set({ coins: cr.wallet.balance, ledger: cr.wallet.ledger, bonusDate: date });
    return amount;
  },

  rollMarketDay: (dayIndex) => {
    const state = get();
    if (state.market.dayIndex !== dayIndex) set({ market: { dayIndex, salesBySpecies: {} } });
  },

  directCredit: (amount, reason) => {
    const state = get();
    const wallet: Wallet = { balance: state.coins, ledger: state.ledger };
    const cr = credit(wallet, amount, reason);
    if (cr.ok) set({ coins: cr.wallet.balance, ledger: cr.wallet.ledger });
  },

  refreshQuestLocks: (questDefs) => {
    const state = get();
    const completed = completedQuestIds(state.quests);
    const quests = state.quests.map((q) => {
      const def = questDefs.find((d) => d.id === q.questId);
      return def ? refreshQuestState(def, q, completed) : q;
    });
    set({ quests });
  },

  setContentVersion: (version) => {
    set({ contentVersion: version });
  },
}));

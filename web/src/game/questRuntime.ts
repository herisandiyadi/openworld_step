/**
 * Runtime bridge that turns the loaded content registry into quest state and
 * routes world events (talk/reach/ride/district/time/catch/dispose) into the
 * quest engine. Quest state lives in the contentProgress store; coin/item
 * rewards are applied here through the store's public actions so the
 * state/contentProgress module stays untouched.
 */
import type { ContentRegistry } from '../content/registry';
import { engineQuestDef, seedQuestStates } from './contentBridge';
import { applyQuestEvent, refreshQuestState, type QuestDef, type QuestState } from '../quest/questEngine';
import type { QuestEvent } from '../quest/questEvents';
import type { ActiveQuestSummaryItem } from '../content-runtime/npcs';
import { addOwnedItem } from '../economy/inventory';
import { useContentProgress } from '../state/contentProgress';

/** Engine quests seeded this session; empty until initQuests runs. */
let questDefs: QuestDef[] = [];

export function questDefinitions(): readonly QuestDef[] {
  return questDefs;
}

export function resetQuestRuntime(): void {
  questDefs = [];
}

/**
 * Builds engine quest defs from the registry and seeds the store's quest state.
 * Idempotent: repeated calls keep existing player progress.
 */
export function initQuests(registry: ContentRegistry): void {
  questDefs = registry.allQuests().filter((quest) => !quest.retired).map(engineQuestDef);
  const existing = useContentProgress.getState().quests;
  const completed = existing.filter((q) => q.status === 'completed' || q.completions > 0).map((q) => q.questId);
  const states = seedQuestStates(questDefs, existing, completed);
  useContentProgress.setState({ quests: states });
  refreshLocks();
}

function completedIds(quests: readonly QuestState[]): string[] {
  return quests.filter((q) => q.status === 'completed' || q.completions > 0).map((q) => q.questId);
}

/** Unlocks quests whose prerequisites have completed. */
function refreshLocks(): void {
  const store = useContentProgress.getState();
  const completed = completedIds(store.quests);
  const quests = store.quests.map((q) => {
    const def = questDefs.find((d) => d.id === q.questId);
    return def ? refreshQuestState(def, q, completed) : q;
  });
  useContentProgress.setState({ quests });
}

/**
 * Feeds one world event to every active quest, advances step progress, and grants
 * rewards. Pure step reduction comes from the quest engine; only coin/item side
 * effects touch the store.
 */
export function routeQuestEvent(event: QuestEvent): void {
  if (questDefs.length === 0) return;
  const store = useContentProgress.getState();
  let quests = store.quests;
  let mutated = false;
  for (let i = 0; i < quests.length; i++) {
    const quest = quests[i];
    if (!quest || quest.status !== 'active') continue;
    const def = questDefs.find((d) => d.id === quest.questId);
    if (!def) continue;
    const result = applyQuestEvent(def, quest, event);
    if (result.state === quest) continue;
    quests = quests.map((q, idx) => (idx === i ? result.state : q));
    mutated = true;
    for (const evt of result.events) {
      if (evt.type !== 'reward') continue;
      if (evt.coins !== undefined && evt.coins > 0) store.directCredit(evt.coins, `quest:${evt.questId}`);
      if (evt.items !== undefined && evt.items.length > 0) {
        let inventory = useContentProgress.getState().inventory;
        for (const itemId of evt.items) inventory = addOwnedItem(inventory, { id: itemId, category: 'tool', retired: false });
        useContentProgress.setState({ inventory });
      }
    }
  }
  if (mutated) {
    useContentProgress.setState({ quests });
    // A completed quest can unlock dependent quests (requires chains).
    refreshLocks();
  }
}

/** Titles + current step text for the HUD quest list and NPC AI context. */
export function activeQuestSummaries(): ActiveQuestSummaryItem[] {
  const states = useContentProgress.getState().quests;
  const items: ActiveQuestSummaryItem[] = [];
  for (const state of states) {
    const def = questDefs.find((d) => d.id === state.questId);
    if (!def) continue;
    const step = def.steps[state.step];
    items.push({
      title: def.title,
      status: state.status === 'completed' ? 'completed' : 'active',
      ...(step?.text !== undefined ? { stepText: step.text } : {}),
    });
  }
  return items;
}

/** Quest candidates for one NPC (used by quest markers and chat prompts). */
export function questCandidatesFor(npcId: string): { questId: string; status: 'locked' | 'available' | 'active' | 'completed' }[] {
  const states = useContentProgress.getState().quests;
  return questDefs
    .filter((def) => def.giver === npcId)
    .map((def) => {
      const state = states.find((s) => s.questId === def.id);
      const status = state?.status === 'completed' ? 'completed' : state?.status === 'active' ? 'active' : state?.status === 'locked' ? 'locked' : 'available';
      return { questId: def.id, status: status as 'locked' | 'available' | 'active' | 'completed' };
    });
}

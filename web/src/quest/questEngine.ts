import type { QuestEvent } from './questEvents';

export type QuestStep =
  | { type: 'talk'; npc: string; text?: string }
  | { type: 'reach'; x: number; z: number; radius: number; text?: string }
  | { type: 'ride'; vehicle: string; destination?: string | { x: number; z: number; radius: number }; maxDurationSeconds?: number; text?: string }
  | { type: 'collect'; item: string; quantity?: number; text?: string }
  | { type: 'visit_district'; district: string; text?: string }
  | { type: 'time'; from: number; to: number; text?: string }
  | { type: 'catch'; species?: string; minWeight?: number; maxWeight?: number; quantity?: number; text?: string }
  | { type: 'dispose'; item?: string; quantity?: number; text?: string };

export interface QuestRewards {
  coins?: number;
  items?: string[];
}

export interface QuestDef {
  id: string;
  title: string;
  giver?: string;
  requires?: string[];
  repeatable: boolean;
  steps: QuestStep[];
  rewards?: QuestRewards;
}

export type QuestStatus = 'locked' | 'active' | 'completed';

export interface QuestProgress {
  current: number;
  required: number;
}

export interface QuestState {
  questId: string;
  status: QuestStatus;
  step: number;
  progress: QuestProgress[];
  completions: number;
}

export type QuestOutputEvent =
  | { type: 'quest_completed'; questId: string; completion: number }
  | { type: 'reward'; questId: string; coins?: number; items?: string[] };

export interface QuestEventResult {
  state: QuestState;
  events: QuestOutputEvent[];
}

const requiredFor = (step: QuestStep): number =>
  'quantity' in step && step.quantity !== undefined ? Math.max(1, step.quantity) : 1;

const initialProgress = (quest: QuestDef): QuestProgress[] => quest.steps.map((step) => ({ current: 0, required: requiredFor(step) }));

export function createQuestState(quest: QuestDef, completedQuestIds: readonly string[] = []): QuestState {
  const requires = quest.requires ?? [];
  const prerequisitesMet = requires.every((id) => completedQuestIds.includes(id));
  const alreadyCompleted = completedQuestIds.includes(quest.id);
  return {
    questId: quest.id,
    status: alreadyCompleted && !quest.repeatable ? 'completed' : prerequisitesMet ? 'active' : 'locked',
    step: 0,
    progress: initialProgress(quest),
    completions: 0,
  };
}

const isInTimeRange = (hour: number, from: number, to: number): boolean => {
  const normalized = ((hour % 24) + 24) % 24;
  const start = ((from % 24) + 24) % 24;
  const end = ((to % 24) + 24) % 24;
  return start <= end ? normalized >= start && normalized <= end : normalized >= start || normalized <= end;
};

const matches = (step: QuestStep, event: QuestEvent): boolean => {
  if (step.type !== event.type) return false;
  switch (step.type) {
    case 'talk':
      return event.type === 'talk' && event.npc === step.npc;
    case 'reach':
      return event.type === 'reach' && Math.hypot(event.x - step.x, event.z - step.z) <= step.radius;
    case 'ride':
      if (event.type !== 'ride' || event.vehicle !== step.vehicle) return false;
      if (step.destination !== undefined) {
        if (typeof step.destination === 'string') {
          if (event.destination !== step.destination) return false;
        } else if (typeof event.destination !== 'object' || event.destination === null || Math.hypot(event.destination.x - step.destination.x, event.destination.z - step.destination.z) > step.destination.radius) {
          return false;
        }
      }
      return step.maxDurationSeconds === undefined || (event.durationSeconds !== undefined && event.durationSeconds <= step.maxDurationSeconds);
    case 'collect':
      return event.type === 'collect' && event.item === step.item;
    case 'visit_district':
      return event.type === 'visit_district' && event.district === step.district;
    case 'time':
      return event.type === 'time' && isInTimeRange(event.hour, step.from, step.to);
    case 'catch':
      return (
        event.type === 'catch' &&
        (step.species === undefined || event.species === step.species) &&
        (step.minWeight === undefined || (event.weight !== undefined && event.weight >= step.minWeight)) &&
        (step.maxWeight === undefined || (event.weight !== undefined && event.weight <= step.maxWeight))
      );
    case 'dispose':
      return event.type === 'dispose' && (step.item === undefined || event.item === step.item);
  }
};

const eventQuantity = (event: QuestEvent): number => ('quantity' in event ? Math.max(0, event.quantity) : 1);

export function applyQuestEvent(quest: QuestDef, state: QuestState, event: QuestEvent): QuestEventResult {
  if (state.questId !== quest.id || state.status !== 'active' || state.step >= quest.steps.length) {
    return { state, events: [] };
  }
  const step = quest.steps[state.step];
  if (!step || !matches(step, event)) return { state, events: [] };

  const required = requiredFor(step);
  const previous = state.progress[state.step] ?? { current: 0, required };
  const current = Math.min(required, previous.current + eventQuantity(event));
  const progress = state.progress.map((item, index) => (index === state.step ? { current, required } : item));
  if (current < required) return { state: { ...state, progress }, events: [] };

  const nextStep = state.step + 1;
  if (nextStep < quest.steps.length) {
    return { state: { ...state, step: nextStep, progress }, events: [] };
  }

  const completion = state.completions + 1;
  const completedEvent: QuestOutputEvent = { type: 'quest_completed', questId: quest.id, completion };
  const reward = quest.rewards;
  const events: QuestOutputEvent[] = [completedEvent];
  if (reward && (reward.coins !== undefined || (reward.items?.length ?? 0) > 0)) {
    events.push({ type: 'reward', questId: quest.id, ...(reward.coins === undefined ? {} : { coins: reward.coins }), ...(reward.items === undefined ? {} : { items: [...reward.items] }) });
  }

  if (quest.repeatable) {
    return { state: { ...state, status: 'active', step: 0, progress: initialProgress(quest), completions: completion }, events };
  }
  return { state: { ...state, status: 'completed', step: nextStep, progress, completions: completion }, events };
}

export const processQuestEvent = applyQuestEvent;

export function refreshQuestState(quest: QuestDef, state: QuestState, completedQuestIds: readonly string[]): QuestState {
  if (state.status !== 'locked') return state;
  const requires = quest.requires ?? [];
  return requires.every((id) => completedQuestIds.includes(id)) ? { ...state, status: 'active' } : state;
}

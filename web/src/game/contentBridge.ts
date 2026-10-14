/**
 * Bridge between content-pack quest definitions (content/schema.ts) and the
 * quest engine (quest/questEngine.ts). The two QuestDef shapes differ:
 *   • schema uses `region` for visit_district, the engine uses `district`
 *   • schema uses `count`, the engine uses `quantity`
 *   • schema uses `timeLimitSeconds`, the engine uses `maxDurationSeconds`
 * The conversion is pure so it is testable without loading the pack.
 */
import type { QuestDef as ContentQuestDef, QuestStep as ContentQuestStep } from '../content/schema';
import { type QuestDef, type QuestState, createQuestState } from '../quest/questEngine';

function convertStep(step: ContentQuestStep): QuestDef['steps'][number] {
  switch (step.type) {
    case 'talk':
      return { type: 'talk', npc: step.npc, text: step.text };
    case 'reach':
      return { type: 'reach', x: step.x, z: step.z, radius: step.radius, text: step.text };
    case 'ride':
      return {
        type: 'ride',
        vehicle: step.vehicle,
        text: step.text,
        ...(step.destination !== undefined ? { destination: step.destination } : {}),
        ...(step.timeLimitSeconds !== undefined ? { maxDurationSeconds: step.timeLimitSeconds } : {}),
      };
    case 'collect':
      return { type: 'collect', item: step.item, quantity: step.count, text: step.text };
    case 'visit_district':
      return { type: 'visit_district', district: step.region, text: step.text };
    case 'time':
      return { type: 'time', from: step.from, to: step.to, text: step.text };
    case 'catch':
      return {
        type: 'catch',
        text: step.text,
        ...(step.species !== undefined ? { species: step.species } : {}),
        ...(step.minWeight !== undefined ? { minWeight: step.minWeight } : {}),
        quantity: step.count,
      };
    case 'dispose':
      return { type: 'dispose', quantity: step.count, text: step.text };
  }
}

export function engineQuestDef(quest: ContentQuestDef): QuestDef {
  return {
    id: quest.id,
    title: quest.title,
    ...(quest.giver !== undefined ? { giver: quest.giver } : {}),
    ...(quest.requires !== undefined ? { requires: quest.requires } : {}),
    repeatable: quest.repeatable,
    steps: quest.steps.map(convertStep),
    rewards: quest.rewards,
  };
}

/**
 * Creates (or refreshes) quest state for every engine quest def.
 * `existing` keeps player progress across reloads; defs without saved state get
 * a fresh state seeded by `completedIds` (quests whose prerequisites are met become active).
 */
export function seedQuestStates(
  questDefs: readonly QuestDef[],
  existing: readonly QuestState[],
  completedIds: readonly string[] = [],
): QuestState[] {
  return questDefs.map((def) => existing.find((q) => q.questId === def.id) ?? createQuestState(def, completedIds));
}

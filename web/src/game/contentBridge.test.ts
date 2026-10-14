import { describe, it, expect } from 'vitest';
import { engineQuestDef, seedQuestStates } from './contentBridge';
import type { QuestDef as ContentQuestDef } from '../content/schema';
import { refreshQuestState } from '../quest/questEngine';

const contentQuest: ContentQuestDef = {
  id: 'q_test',
  title: 'Uji',
  giver: 'npc_budi',
  requires: ['q_prev'],
  repeatable: false,
  steps: [
    { type: 'talk', npc: 'npc_sari', text: 'Bicara' },
    { type: 'visit_district', region: 'industrial', text: 'Kunjungi' },
    { type: 'catch', species: 'nila', count: 2, minWeight: 0.4, text: 'Tangkap' },
    { type: 'collect', item: 'bait_worm', count: 1, text: 'Ambil' },
    { type: 'dispose', count: 1, text: 'Buang' },
    { type: 'time', from: 6, to: 18, text: 'Waktu' },
    { type: 'ride', vehicle: 'scooter_standard', text: 'Naik', destination: { x: 12, z: -4, radius: 8 }, timeLimitSeconds: 120 },
  ],
  rewards: { coins: 20, items: ['rack_cargo'] },
  retired: false,
};

describe('contentBridge', () => {
  it('converts a content quest into an engine quest definition', () => {
    const def = engineQuestDef(contentQuest);
    expect(def.id).toBe('q_test');
    expect(def.repeatable).toBe(false);
    expect(def.requires).toEqual(['q_prev']);
    expect(def.steps[0]).toEqual({ type: 'talk', npc: 'npc_sari', text: 'Bicara' });
    expect(def.steps[1]).toEqual({ type: 'visit_district', district: 'industrial', text: 'Kunjungi' });
    expect(def.steps[2]).toMatchObject({ type: 'catch', species: 'nila', quantity: 2, minWeight: 0.4 });
    expect(def.steps[3]).toMatchObject({ type: 'collect', item: 'bait_worm', quantity: 1 });
    expect(def.steps[4]).toMatchObject({ type: 'dispose', quantity: 1 });
    expect(def.steps[5]).toMatchObject({ type: 'time', from: 6, to: 18 });
    expect(def.steps[6]).toMatchObject({ type: 'ride', vehicle: 'scooter_standard', destination: { x: 12, z: -4, radius: 8 }, maxDurationSeconds: 120 });
    expect(def.rewards).toEqual({ coins: 20, items: ['rack_cargo'] });
  });

  it('seeds quest states, keeping prerequisites locked until completed', () => {
    const defs = [engineQuestDef(contentQuest)];
    const states = seedQuestStates(defs, []);
    expect(states).toHaveLength(1);
    expect(states[0]!.status).toBe('locked');

    const unlocked = seedQuestStates(defs, [], ['q_prev']);
    expect(unlocked[0]!.status).toBe('active');
  });

  it('preserves existing quest progress when reseeding', () => {
    const defs = [engineQuestDef(contentQuest)];
    const existing = [{ questId: 'q_test', status: 'active' as const, step: 1, progress: [{ current: 1, required: 1 }], completions: 0 }];
    const states = seedQuestStates(defs, existing, ['q_prev']);
    expect(states[0]!.step).toBe(1);
    expect(states[0]!.status).toBe('active');
  });

  it('unlocks a locked quest when its prerequisite completes via refreshQuestState', () => {
    const def = engineQuestDef(contentQuest);
    const locked = seedQuestStates([def], [])[0]!;
    expect(refreshQuestState(def, locked, ['q_prev']).status).toBe('active');
  });
});

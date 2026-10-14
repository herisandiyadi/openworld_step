import { describe, expect, it } from 'vitest';
import { applyQuestEvent, createQuestState, refreshQuestState, type QuestDef } from './questEngine';
import { caught, collected, disposed, reached, ridden, talked, timeReached, visitedDistrict } from './questEvents';

const quest: QuestDef = {
  id: 'q_delivery',
  title: 'Deliver package',
  requires: [],
  repeatable: false,
  steps: [
    { type: 'talk', npc: 'sari' },
    { type: 'reach', x: 10, z: -4, radius: 2 },
    { type: 'ride', vehicle: 'bike', destination: 'market' },
    { type: 'collect', item: 'parcel', quantity: 2 },
    { type: 'visit_district', district: 'downtown' },
    { type: 'time', from: 8, to: 10 },
  ],
  rewards: { coins: 50, items: ['blue_paint'] },
};

describe('quest engine', () => {
  it('starts only when all prerequisites are completed', () => {
    expect(createQuestState({ ...quest, requires: ['q_intro'] }, [])).toMatchObject({ status: 'locked' });
    expect(createQuestState({ ...quest, requires: ['q_intro'] }, ['q_intro'])).toMatchObject({ status: 'active', step: 0 });
  });

  it('unlocks a locked quest when prerequisite completion is refreshed', () => {
    const gated = { ...quest, requires: ['q_intro'] };
    const locked = createQuestState(gated, []);
    expect(refreshQuestState(gated, locked, ['q_intro']).status).toBe('active');
  });

  it('advances sequential steps and ignores events for later steps', () => {
    let result = applyQuestEvent(quest, createQuestState(quest), reached(10, -4));
    expect(result.state.step).toBe(0);
    result = applyQuestEvent(quest, result.state, talked('sari'));
    expect(result.state.step).toBe(1);
    result = applyQuestEvent(quest, result.state, reached(11, -3));
    expect(result.state.step).toBe(2);
    expect(result.state.progress[1]).toEqual({ current: 1, required: 1 });
  });

  it('completes all core step types and emits completion plus rewards', () => {
    let state = createQuestState(quest);
    const events = [talked('sari'), reached(10, -4), ridden('bike', 'market'), collected('parcel', 1), collected('parcel', 1), visitedDistrict('downtown'), timeReached(9)];
    let output = { state, events: [] as ReturnType<typeof applyQuestEvent>['events'] };
    for (const event of events) output = applyQuestEvent(quest, output.state, event);
    expect(output.state.status).toBe('completed');
    expect(output.events).toEqual([
      { type: 'quest_completed', questId: 'q_delivery', completion: 1 },
      { type: 'reward', questId: 'q_delivery', coins: 50, items: ['blue_paint'] },
    ]);
  });

  it('supports fishing catch and dispose extensions with quantity and constraints', () => {
    const fishQuest: QuestDef = {
      id: 'q_fishing', title: 'Fishing', requires: [], repeatable: false,
      steps: [
        { type: 'catch', species: 'nila', minWeight: 0.5, quantity: 2 },
        { type: 'dispose', item: 'can', quantity: 3 },
      ], rewards: {},
    };
    let state = createQuestState(fishQuest);
    state = applyQuestEvent(fishQuest, state, caught('nila', 0.4)).state;
    expect(state.step).toBe(0);
    state = applyQuestEvent(fishQuest, state, caught('nila', 0.8, 2)).state;
    expect(state.step).toBe(1);
    state = applyQuestEvent(fishQuest, state, disposed(2, 'can')).state;
    expect(state.step).toBe(1);
    expect(applyQuestEvent(fishQuest, state, disposed(3, 'can')).state.status).toBe('completed');
  });

  it('resets a repeatable quest after each completion and emits new rewards', () => {
    const repeatable = { ...quest, repeatable: true, rewards: { coins: 10 } };
    let state = createQuestState(repeatable);
    for (const event of [talked('sari'), reached(10, -4), ridden('bike', 'market'), collected('parcel', 2), visitedDistrict('downtown'), timeReached(9)]) {
      state = applyQuestEvent(repeatable, state, event).state;
    }
    expect(state).toMatchObject({ status: 'active', step: 0, completions: 1 });
    const output = applyQuestEvent(repeatable, state, talked('sari'));
    expect(output.state.step).toBe(1);
    expect(output.events).toEqual([]);
  });

  it('matches coordinate-based ride destinations within radius', () => {
    const coordQuest: QuestDef = {
      id: 'q_ride_coord', title: 'Ride coord', requires: [], repeatable: false,
      steps: [{ type: 'ride', vehicle: 'scooter', destination: { x: 100, z: 200, radius: 10 } }],
      rewards: {},
    };
    let state = createQuestState(coordQuest);
    state = applyQuestEvent(coordQuest, state, ridden('scooter', { x: 105, z: 202, radius: 0 })).state;
    expect(state.status).toBe('completed');
  });

  it('rejects ride destinations outside radius', () => {
    const coordQuest: QuestDef = {
      id: 'q_ride_coord', title: 'Ride coord', requires: [], repeatable: false,
      steps: [{ type: 'ride', vehicle: 'scooter', destination: { x: 100, z: 200, radius: 5 } }],
      rewards: {},
    };
    let state = createQuestState(coordQuest);
    state = applyQuestEvent(coordQuest, state, ridden('scooter', { x: 120, z: 200, radius: 0 })).state;
    expect(state.step).toBe(0);
  });
});

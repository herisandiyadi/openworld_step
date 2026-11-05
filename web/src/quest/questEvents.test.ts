import { describe, expect, it } from 'vitest';
import {
  caught,
  collected,
  disposed,
  reached,
  ridden,
  talked,
  timeReached,
  visitedDistrict,
  type QuestEvent,
} from './questEvents';

describe('quest event helpers', () => {
  it('builds typed game events without adding engine state', () => {
    const events: QuestEvent[] = [
      talked('npc_sari'),
      reached(12, -4),
      ridden('bike', 'market', 42),
      collected('parcel', 2),
      visitedDistrict('harbour'),
      timeReached(17.5),
      caught('nila', 0.8),
      disposed(3, 'can'),
    ];

    expect(events).toEqual([
      { type: 'talk', npc: 'npc_sari' },
      { type: 'reach', x: 12, z: -4 },
      { type: 'ride', vehicle: 'bike', destination: 'market', durationSeconds: 42 },
      { type: 'collect', item: 'parcel', quantity: 2 },
      { type: 'visit_district', district: 'harbour' },
      { type: 'time', hour: 17.5 },
      { type: 'catch', species: 'nila', weight: 0.8, quantity: 1 },
      { type: 'dispose', quantity: 3, item: 'can' },
    ]);
  });
});

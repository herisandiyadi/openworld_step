import { describe, expect, it, vi } from 'vitest';
import {
  activeNpcsAt,
  npcNavTarget,
  npcQuestMarker,
  npcScheduleState,
  scheduleEntryAt,
  summarizeQuestContext,
  type RuntimeNpc,
} from './npcs';

const npc: RuntimeNpc = {
  id: 'npc_night',
  name: 'Pak Malam',
  asset: 'npc_vendor',
  x: 1,
  z: 2,
  yaw: 0,
  schedule: [
    { from: 22, to: 2, x: 10, z: 20 },
    { from: 8, to: 12, x: 30, z: 40 },
  ],
  questGiver: ['q_new', 'q_active'],
};

describe('data-driven NPC schedules', () => {
  it('selects half-open daytime and overnight entries', () => {
    expect(scheduleEntryAt(npc.schedule, 23)).toMatchObject({ x: 10, z: 20 });
    expect(scheduleEntryAt(npc.schedule, 1.5)).toMatchObject({ x: 10, z: 20 });
    expect(scheduleEntryAt(npc.schedule, 8)).toMatchObject({ x: 30, z: 40 });
    expect(scheduleEntryAt(npc.schedule, 12)).toBeNull();
  });

  it('marks scheduled NPCs inactive outside entries and unscheduled NPCs active at their base position', () => {
    expect(npcScheduleState(npc, 4)).toEqual({ active: false, target: null });
    expect(npcScheduleState(npc, 9)).toEqual({ active: true, target: { x: 30, z: 40 } });
    expect(npcScheduleState({ ...npc, schedule: undefined }, 4)).toEqual({ active: true, target: { x: 1, z: 2 } });
    expect(activeNpcsAt([npc, { ...npc, id: 'always', schedule: [] }], 4).map((item) => item.id)).toEqual(['always']);
  });

  it('chooses a nav waypoint toward the scheduled position with straight-line fallback', () => {
    const findPath = vi.fn(() => [{ x: 4, z: 5 }, { x: 30, z: 40 }]);
    expect(npcNavTarget(npc, 9, { x: 0, z: 0 }, findPath)).toEqual({ x: 4, z: 5 });
    expect(findPath).toHaveBeenCalledWith({ x: 0, z: 0 }, { x: 30, z: 40 });
    expect(npcNavTarget(npc, 9, { x: 0, z: 0 }, () => null)).toEqual({ x: 30, z: 40 });
    expect(npcNavTarget(npc, 4, { x: 0, z: 0 }, findPath)).toBeNull();
  });
});

describe('NPC quest presentation helpers', () => {
  it('prioritizes ? for an active quest, otherwise shows ! for an available quest', () => {
    expect(npcQuestMarker(npc, [{ questId: 'q_new', status: 'available' }])).toBe('!');
    expect(npcQuestMarker(npc, [
      { questId: 'q_new', status: 'available' },
      { questId: 'q_active', status: 'active' },
    ])).toBe('?');
    expect(npcQuestMarker(npc, [{ questId: 'q_new', status: 'locked' }])).toBeNull();
  });

  it('summarizes only active quest context without exceeding the requested cap', () => {
    const summary = summarizeQuestContext([
      { title: 'Selesai', status: 'completed', stepText: 'abaikan' },
      { title: 'Antar Paket Bu Sari', status: 'active', stepText: 'Bawa paket yang sangat penting ke Mbak Rina di Pusat Kota secepat mungkin tanpa merusaknya.' },
      { title: 'Jelajahi Kota', status: 'active', stepText: 'Temui semua warga di setiap distrik kota.' },
    ], 120);
    expect(summary).toContain('Antar Paket Bu Sari');
    expect(summary).not.toContain('Selesai');
    expect(summary.length).toBeLessThanOrEqual(120);
    expect(summary.endsWith('…')).toBe(true);
    expect(summarizeQuestContext([], 300)).toBe('');
  });
});

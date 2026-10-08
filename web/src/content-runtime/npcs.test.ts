import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { NpcDef } from '../content/schema';
import type { NpcSpawn } from '../world/worldSpec';
import {
  activeNpcsAt,
  mergeNpcRoster,
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

describe('content roster merge', () => {
  const baked: NpcSpawn[] = [
    { id: 'npc_budi', asset: 'npc_vendor', name: 'Pak Budi', x: 5, z: 10, yaw: 1.5707963267948966 },
    { id: 'npc_sari', asset: 'npc_vendor', name: 'Bu Sari', x: -187, z: -170, yaw: 1.5707963267948966 },
    { id: 'npc_rina', asset: 'npc_vendor', name: 'Mbak Rina', x: 69, z: -54, yaw: 1.5707963267948966 },
    { id: 'npc_dewi', asset: 'npc_vendor', name: 'Bu Dewi', x: -123, z: 74, yaw: 1.5707963267948966 },
    { id: 'npc_joko', asset: 'npc_vendor', name: 'Mas Joko', x: 165, z: 138, yaw: 1.5707963267948966 },
  ];
  const bundledNpcs = JSON.parse(
    readFileSync(new URL('../../content/base/npcs.json', import.meta.url), 'utf8'),
  ) as NpcDef[];
  const bundledRegistry = { allNpcs: () => bundledNpcs };

  it('merges all 15 content NPCs into a duplicate-free runtime roster at noon', () => {
    const roster = mergeNpcRoster(bundledRegistry, baked, 12);
    expect(roster.map((item) => item.id)).toEqual(bundledNpcs.map((item) => item.id));
    expect(new Set(roster.map((item) => item.id)).size).toBe(roster.length);
    expect(roster).toHaveLength(15);
    const budi = roster.find((item) => item.id === 'npc_budi')!;
    expect(budi.x).toBe(bundledNpcs[0]!.schedule![1]!.x);
    expect(budi.z).toBe(bundledNpcs[0]!.schedule![1]!.z);
  });

  it('filters NPCs whose schedule is inactive at the given hour, including baked duplicates', () => {
    const registry = {
      allNpcs: () => [{
        ...bundledNpcs[0]!,
        schedule: [{ from: 8, to: 12, x: 1, z: 2 }],
      }],
    };
    expect(mergeNpcRoster(registry, [], 12)).toEqual([]);
    expect(mergeNpcRoster(registry, baked, 12).some((item) => item.id === 'npc_budi')).toBe(false);
    expect(mergeNpcRoster(registry, [], 9).map((item) => item.id)).toEqual(['npc_budi']);
  });

  it('does not duplicate the five baked NPCs when content overrides them', () => {
    const roster = mergeNpcRoster(bundledRegistry, baked, 12);
    expect(roster).toHaveLength(15);
    for (const bakedNpc of baked) expect(roster.filter((item) => item.id === bakedNpc.id)).toHaveLength(1);
  });
});

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

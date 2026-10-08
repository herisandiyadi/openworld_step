import { beforeEach, describe, expect, it } from 'vitest';
import { resetJobRuntime, jobDefinitions, availableJobs } from './jobRuntime';
import type { ContentRegistry } from '../content/registry';

const economy = {
  currency: 'coins',
  dailyBonus: 20,
  busFare: 5,
  jobs: [
    { id: 'job_bengkel', title: 'Antar Suku Cadang', rewardCoins: 25, dailyLimit: 10, stepTypes: ['talk', 'reach', 'talk'] },
    { id: 'job_kurir', title: 'Kurir Paket Pabrik', rewardCoins: 30, dailyLimit: 8, stepTypes: ['talk', 'reach', 'talk'] },
    { id: 'job_ojek', title: 'Ojek Antar Warga', rewardCoins: 20, dailyLimit: 12, stepTypes: ['talk', 'ride'] },
  ],
};

const registry = {
  allQuests: () => [
    {
      id: 'q_bengkel_kilat',
      title: 'Kiriman Suku Cadang',
      giver: 'npc_agus',
      requires: [],
      repeatable: true,
      steps: [
        { type: 'talk' as const, npc: 'npc_agus', text: 'a' },
        { type: 'reach' as const, x: 1, z: 2, radius: 3, text: 'b' },
        { type: 'talk' as const, npc: 'npc_wahyu', text: 'c' },
      ],
      rewards: {},
      retired: false,
    },
    {
      id: 'q_kurir_pabrik',
      title: 'Kurir Pabrik',
      giver: 'npc_wahyu',
      requires: [],
      repeatable: true,
      steps: [
        { type: 'talk' as const, npc: 'npc_wahyu', text: 'a' },
        { type: 'reach' as const, x: 4, z: 5, radius: 6, text: 'b' },
        { type: 'talk' as const, npc: 'npc_hasan', text: 'c' },
      ],
      rewards: {},
      retired: false,
    },
    {
      id: 'q_ojek_cepat',
      title: 'Ojek Cepat',
      giver: 'npc_tini',
      requires: [],
      repeatable: true,
      steps: [
        { type: 'talk' as const, npc: 'npc_tini', text: 'a' },
        { type: 'ride' as const, vehicle: 'scooter_standard', text: 'b' },
      ],
      rewards: {},
      retired: false,
    },
    {
      id: 'q_retired',
      title: 'Retired',
      giver: 'npc_x',
      requires: [],
      repeatable: true,
      steps: [{ type: 'reach' as const, x: 0, z: 0, radius: 1, text: 'x' }],
      rewards: {},
      retired: true,
    },
  ],
} as unknown as ContentRegistry;

describe('jobRuntime', () => {
  beforeEach(() => resetJobRuntime());

  it('exposes job definitions from the economy config, mapped by quest step signature', () => {
    initJobs(registry, economy);
    expect(jobDefinitions()).toHaveLength(3);
    expect(jobDefinitions().map((job) => job.id)).toEqual(['job_bengkel', 'job_kurir', 'job_ojek']);
    expect(jobDefinitions()[0]?.questId).toBe('q_bengkel_kilat');
    expect(jobDefinitions()[1]?.questId).toBe('q_kurir_pabrik');
    expect(jobDefinitions()[2]?.questId).toBe('q_ojek_cepat');
  });

  it('is empty until boot', () => {
    expect(jobDefinitions()).toEqual([]);
  });

  it('lists available jobs with daily remaining counts for a date', () => {
    initJobs(registry, economy);
    const jobs = availableJobs('2026-01-01');
    expect(jobs).toHaveLength(3);
    expect(jobs[0]).toMatchObject({ id: 'job_bengkel', remaining: 10, doneToday: 0, rewardCoins: 25 });
    expect(jobs[1]).toMatchObject({ id: 'job_kurir', remaining: 8, doneToday: 0, rewardCoins: 30 });
    expect(jobs[2]).toMatchObject({ id: 'job_ojek', remaining: 12, doneToday: 0, rewardCoins: 20 });
  });
});

import { initJobs } from './jobRuntime';

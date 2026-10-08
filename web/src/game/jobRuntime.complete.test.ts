import { beforeEach, describe, expect, it } from 'vitest';
import { useContentProgress } from '../state/contentProgress';
import { completeAvailableJob, initJobs, resetJobRuntime } from './jobRuntime';
import type { ContentRegistry } from '../content/registry';

const economy = {
  currency: 'coins', dailyBonus: 20, busFare: 5,
  jobs: [{ id: 'job_test', title: 'Pekerjaan Uji', rewardCoins: 25, dailyLimit: 2, stepTypes: ['talk'] }],
};
const registry = {
  allQuests: () => [{
    id: 'q_test', title: 'Quest Uji', giver: 'npc', requires: [], repeatable: true,
    steps: [{ type: 'talk' as const, npc: 'npc', text: 'Bicara' }], rewards: {}, retired: false,
  }],
} as unknown as ContentRegistry;

function reset() {
  resetJobRuntime();
  useContentProgress.setState({
    coins: 0,
    ledger: [],
    jobs: { date: '2026-01-01', completed: {} },
    quests: [{ questId: 'q_test', status: 'active', step: 0, progress: [{ current: 0, required: 1 }], completions: 0 }],
  });
  initJobs(registry, economy);
}

describe('completeAvailableJob', () => {
  beforeEach(reset);

  it('rejects completion until the associated quest has a new completed run', () => {
    expect(completeAvailableJob('job_test', '2026-01-01')).toBe(0);
    expect(useContentProgress.getState().coins).toBe(0);
  });

  it('awards through contentProgress after requirements are met, at most once per quest completion', () => {
    useContentProgress.setState({ quests: [{ questId: 'q_test', status: 'active', step: 0, progress: [{ current: 0, required: 1 }], completions: 1 }] });
    expect(completeAvailableJob('job_test', '2026-01-01')).toBe(25);
    expect(useContentProgress.getState().coins).toBe(25);
    expect(completeAvailableJob('job_test', '2026-01-01')).toBe(0);
  });

  it('rolls daily limits and permits a new claim only after another quest completion', () => {
    useContentProgress.setState({ quests: [{ questId: 'q_test', status: 'active', step: 0, progress: [{ current: 0, required: 1 }], completions: 1 }] });
    expect(completeAvailableJob('job_test', '2026-01-01')).toBe(25);
    useContentProgress.setState({ quests: [{ questId: 'q_test', status: 'active', step: 0, progress: [{ current: 0, required: 1 }], completions: 2 }] });
    expect(completeAvailableJob('job_test', '2026-01-01')).toBe(25);
    useContentProgress.setState({ quests: [{ questId: 'q_test', status: 'active', step: 0, progress: [{ current: 0, required: 1 }], completions: 3 }] });
    expect(completeAvailableJob('job_test', '2026-01-01')).toBe(0);

    // New date rolls daily state, but still consumes the latest unclaimed completed run only once.
    expect(completeAvailableJob('job_test', '2026-01-02')).toBe(25);
    expect(useContentProgress.getState().jobs).toMatchObject({ date: '2026-01-02', completed: { job_test: 1 } });
  });
});

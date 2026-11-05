import { describe, expect, it } from 'vitest';
import { completeJob, createDailyJobs, remainingJobs, rollDailyJobs } from './dailyJobs';

const delivery = { id: 'delivery', rewardCoins: 20, dailyLimit: 2 } as const;

describe('daily jobs', () => {
  it('increments a completed job and returns its configured reward', () => {
    const jobs = createDailyJobs('2026-10-08');
    const result = completeJob(jobs, delivery, '2026-10-08');
    expect(result).toEqual({
      ok: true,
      rewardCoins: 20,
      jobs: { date: '2026-10-08', completed: { delivery: 1 } },
    });
    expect(jobs.completed).toEqual({});
  });

  it('rejects completions after the per-job daily limit', () => {
    let jobs = createDailyJobs('2026-10-08');
    jobs = completeJob(jobs, delivery, '2026-10-08').jobs;
    jobs = completeJob(jobs, delivery, '2026-10-08').jobs;
    const blocked = completeJob(jobs, delivery, '2026-10-08');
    expect(blocked).toMatchObject({ ok: false, reason: 'daily-limit', rewardCoins: 0, jobs });
    expect(remainingJobs(jobs, delivery, '2026-10-08')).toBe(0);
  });

  it('resets all job counts when the local date changes', () => {
    const previous = { date: '2026-10-08', completed: { delivery: 2, courier: 5 } };
    const rolled = rollDailyJobs(previous, '2026-10-09');
    expect(rolled).toEqual({ date: '2026-10-09', completed: {} });
    expect(completeJob(previous, delivery, '2026-10-09')).toMatchObject({ ok: true, rewardCoins: 20 });
  });

  it('keeps the same object while still on the same date', () => {
    const jobs = createDailyJobs('2026-10-08');
    expect(rollDailyJobs(jobs, '2026-10-08')).toBe(jobs);
  });

  it('rejects malformed dates and invalid job limits or rewards', () => {
    expect(() => createDailyJobs('8 October')).toThrow();
    expect(() => completeJob(createDailyJobs('2026-10-08'), { ...delivery, dailyLimit: 0 }, '2026-10-08')).toThrow();
    expect(() => completeJob(createDailyJobs('2026-10-08'), { ...delivery, rewardCoins: -1 }, '2026-10-08')).toThrow();
  });
});

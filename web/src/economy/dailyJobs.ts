export interface JobDefinition {
  readonly id: string;
  readonly rewardCoins: number;
  readonly dailyLimit: number;
}

export interface DailyJobs {
  readonly date: string;
  readonly completed: Readonly<Record<string, number>>;
}

export type JobResult =
  | { readonly ok: true; readonly rewardCoins: number; readonly jobs: DailyJobs }
  | { readonly ok: false; readonly reason: 'daily-limit'; readonly rewardCoins: 0; readonly jobs: DailyJobs };

function validDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`));
}

function assertJob(job: JobDefinition): void {
  if (!Number.isInteger(job.dailyLimit) || job.dailyLimit <= 0) throw new RangeError('dailyLimit must be a positive integer');
  if (!Number.isInteger(job.rewardCoins) || job.rewardCoins < 0) throw new RangeError('rewardCoins must be a non-negative integer');
}

export function createDailyJobs(date: string): DailyJobs {
  if (!validDate(date)) throw new RangeError('date must be YYYY-MM-DD');
  return { date, completed: {} };
}

export function rollDailyJobs(jobs: DailyJobs, date: string): DailyJobs {
  if (!validDate(date)) throw new RangeError('date must be YYYY-MM-DD');
  return jobs.date === date ? jobs : { date, completed: {} };
}

export function remainingJobs(jobs: DailyJobs, job: JobDefinition, date: string): number {
  assertJob(job);
  const rolled = rollDailyJobs(jobs, date);
  return Math.max(0, job.dailyLimit - (rolled.completed[job.id] ?? 0));
}

export function completeJob(jobs: DailyJobs, job: JobDefinition, date: string): JobResult {
  assertJob(job);
  const rolled = rollDailyJobs(jobs, date);
  const completed = rolled.completed[job.id] ?? 0;
  if (completed >= job.dailyLimit) return { ok: false, reason: 'daily-limit', rewardCoins: 0, jobs: rolled };
  return { ok: true, rewardCoins: job.rewardCoins, jobs: { date: rolled.date, completed: { ...rolled.completed, [job.id]: completed + 1 } } };
}

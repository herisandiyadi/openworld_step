/**
 * Runtime bridge between the content pack's repeatable daily jobs
 * (economy.json) and the quest runtime. Jobs surface in the Job Board
 * overlay and award coins through contentProgress.completeJobTask, which
 * enforces the per-date daily limits. Mapping is pure so it stays testable.
 */
import type { ContentRegistry } from '../content/registry';
import type { EconomyDef } from '../content/schema';
import { useContentProgress } from '../state/contentProgress';
import { remainingJobs, type JobDefinition } from '../economy/dailyJobs';

export interface AvailableJob extends JobDefinition {
  readonly title: string;
  /** Quest id whose steps this job mirrors (reward gating comes from the quest engine). */
  readonly questId: string | null;
  /** Step-type signature from the economy config, e.g. ["talk", "reach", "talk"]. */
  readonly stepTypes: readonly string[];
  readonly remaining: number;
  readonly doneToday: number;
}

let jobs: (JobDefinition & { title: string; questId: string | null; stepTypes: readonly string[] })[] = [];
/** Tracks last-claimed quest completion count per job id to enforce one claim per quest run. */
const claimedCompletions = new Map<string, number>();

export function resetJobRuntime(): void {
  jobs = [];
  claimedCompletions.clear();
}

/** Job definitions seeded from the loaded content pack; empty until boot. */
export function jobDefinitions(): readonly (JobDefinition & { title: string; questId: string | null; stepTypes: readonly string[] })[] {
  return jobs;
}

/**
 * Seeds repeatable-job definitions from the registry + economy config.
 * Each job id is matched to the repeatable quest whose step types equal the
 * job's stepTypes signature; that quest's progress gates completion.
 */
export function initJobs(registry: ContentRegistry, economy: EconomyDef | undefined): void {
  if (!economy) {
    jobs = [];
    return;
  }
  const repeatableQuests = registry.allQuests().filter((quest) => !quest.retired && quest.repeatable);
  const unassigned = new Set(repeatableQuests.map((quest) => quest.id));
  jobs = economy.jobs.map((job) => {
    const quest = repeatableQuests.find(
      (candidate) =>
        unassigned.has(candidate.id) &&
        candidate.steps.length === job.stepTypes.length &&
        candidate.steps.every((step, index) => step.type === job.stepTypes[index]),
    );
    if (quest) unassigned.delete(quest.id);
    return {
      id: job.id,
      title: job.title,
      rewardCoins: job.rewardCoins,
      dailyLimit: job.dailyLimit,
      stepTypes: job.stepTypes,
      questId: quest?.id ?? null,
    };
  });
}

/** Available jobs with remaining daily counts for the given real date. */
export function availableJobs(date: string): AvailableJob[] {
  const store = useContentProgress.getState();
  return jobs.map((job) => ({
    ...job,
    remaining: remainingJobs(store.jobs, job, date),
    doneToday: job.dailyLimit - remainingJobs(store.jobs, job, date),
  }));
}

/**
 * Attempts to complete one job task, awards coins if the associated quest has
 * a new completion since the last claim. Returns awarded coins (0 on failure).
 * Enforces daily limits and one-claim-per-quest-run gating.
 */
export function completeAvailableJob(jobId: string, date: string): number {
  const job = jobs.find((j) => j.id === jobId);
  if (!job || !job.questId) return 0;
  
  const store = useContentProgress.getState();
  const quest = store.quests.find((q) => q.questId === job.questId);
  if (!quest) return 0;
  
  const lastClaimed = claimedCompletions.get(jobId) ?? 0;
  if (quest.completions <= lastClaimed) return 0;
  
  const awarded = store.completeJobTask(job, date);
  if (awarded > 0) {
    claimedCompletions.set(jobId, quest.completions);
  }
  return awarded;
}

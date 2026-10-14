export interface JobBoardEntry {
  readonly id: string;
  readonly title: string;
  readonly rewardCoins: number;
  readonly remaining: number;
  readonly doneToday: number;
  readonly questId: string | null;
  readonly requirementsMet?: boolean;
}

export interface JobBoardProps {
  readonly jobs: readonly JobBoardEntry[];
  readonly bonusClaimedToday: boolean;
  readonly onComplete: (jobId: string) => void;
  readonly onClose: () => void;
}

/** Accessible daily Job Board overlay. Text intentionally stays Indonesian. */
export function JobBoard({ jobs, bonusClaimedToday, onComplete, onClose }: JobBoardProps) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="job-board-title">
      <section className="job-board-panel">
        <header className="job-board-header">
          <div>
            <h2 id="job-board-title">Papan Pekerjaan</h2>
            <p className="job-board-bonus" aria-live="polite">
              {bonusClaimedToday ? 'Bonus login sudah diklaim hari ini' : 'Bonus login belum diklaim hari ini'}
            </p>
          </div>
          <button type="button" className="overlay-button secondary" onClick={onClose} aria-label="Tutup papan pekerjaan">
            Tutup
          </button>
        </header>

        {jobs.length === 0 ? (
          <p className="job-board-empty">Belum ada pekerjaan harian.</p>
        ) : (
          <ul className="job-board-list">
            {jobs.map((job) => {
              const atLimit = job.remaining <= 0;
              const requirementsMet = job.requirementsMet ?? true;
              return (
                <li key={job.id} className="job-board-card">
                  <div className="job-board-copy">
                    <h3>{job.title}</h3>
                    <p>Hadiah: {job.rewardCoins} koin</p>
                    <p>{job.remaining} tersisa hari ini · {job.doneToday} selesai</p>
                  </div>
                  {job.questId !== null && (
                    <button
                      type="button"
                      className="overlay-button"
                      disabled={atLimit || !requirementsMet}
                      onClick={() => onComplete(job.id)}
                      aria-label={`Selesaikan ${job.title}`}
                    >
                      {atLimit ? 'Batas tercapai' : requirementsMet ? 'Selesaikan' : 'Syarat belum terpenuhi'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

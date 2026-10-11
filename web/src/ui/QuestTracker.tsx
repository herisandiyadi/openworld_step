export interface QuestTrackerEntry {
  id: string;
  title: string;
  stepText?: string;
  status: 'active' | 'completed';
}

export interface QuestTrackerProps {
  readonly quests: readonly QuestTrackerEntry[];
}

/**
 * Pause-menu quest list: only active quests, with the current step text.
 * Pure presentational component so it renders in tests without a store.
 */
export function QuestTracker({ quests }: QuestTrackerProps) {
  const active = quests.filter((quest) => quest.status === 'active');
  return (
    <section className="quest-tracker" aria-label="Daftar quest">
      <h3>Quest aktif</h3>
      {active.length === 0 ? (
        <p className="quest-tracker-empty">Belum ada quest aktif</p>
      ) : (
        <ul>
          {active.map((quest) => (
            <li key={quest.id}>
              <span className="quest-tracker-title">{quest.title}</span>
              {quest.stepText && <span className="quest-tracker-step">{quest.stepText}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

import type { FishingSession } from './FishingController';
import type { FishingLoot } from './lootTable';
import { fishSpecies } from './lootTable';

interface FishingHudProps {
  session: FishingSession;
  /** Called once to hook the bite and on keyboard/pointer activation during reel. */
  onPull: () => void;
  /** Optional hold-state callback for driving reel frames (true while held). */
  onPullChange?: (pulling: boolean) => void;
  /** Called when the player explicitly cancels. */
  onCancel: () => void;
  /** Called when the player acknowledges or releases the result card. */
  onRelease?: (loot: FishingLoot | undefined) => void;
}

const PHASE_STATUS: Record<FishingSession['phase'], string> = {
  cast: 'Melempar senar…',
  wait: 'Menunggu ikan…',
  bite: 'Umpan dimakan! Tarik!',
  reel: 'Menarik…',
  result: '',
};

/** Converts reel progress and zone to screen-layout values (0..100). */
function barLayout(position: number, size: number): { top: string; height: string } {
  // Bar origin is at top; position=1 is top, position=0 is bottom.
  const topFraction = 1 - position - size / 2;
  return {
    top: `${Math.round(topFraction * 100)}%`,
    height: `${Math.round(size * 100)}%`,
  };
}

/** Thin vertical bar with accessible label. */
function VerticalBar({ percent, className, label }: { percent: number; className?: string; label: string }) {
  return (
    <div className="fishing-bar-track" role="progressbar" aria-valuenow={Math.round(percent * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={`fishing-bar-fill ${className ?? ''}`} style={{ height: `${Math.round(percent * 100)}%` }} />
    </div>
  );
}

/** Accessible label for the result loot. */
function lootLabel(loot: FishingLoot | undefined): string {
  if (!loot) return 'Tidak ada hasil';
  if (loot.kind === 'trash') {
    const labels: Record<string, string> = { can: 'Kaleng bekas', sandal: 'Sandal bekas', boot: 'Sepatu bot', underwear: 'Celana dalam bekas' };
    return labels[loot.id] ?? 'Sampah';
  }
  const species = fishSpecies(loot.id);
  const kg = loot.weight?.toFixed(2) ?? '?';
  return `${species?.name ?? loot.id} ${kg} kg`;
}

/**
 * Overlay HUD for the fishing minigame.
 *
 * Positioned with CSS class "fishing-hud" (caller's stylesheet handles layout).
 * All interactive controls have ≥ 72 px touch targets, aria roles, and
 * keyboard equivalents — playable with one thumb.
 *
 * Does NOT read from gameStore. Session state and callbacks come through props.
 */
export function FishingHud({ session, onPull, onPullChange, onCancel, onRelease }: FishingHudProps) {
  const { phase, minigame, outcome, loot } = session;

  const showBar = phase === 'reel' && minigame !== undefined;
  const isBite = phase === 'bite';
  const isResult = phase === 'result';

  /** Tension level: 0 = none, 1 = yellow, 2 = red */
  const tensionLevel =
    showBar && minigame
      ? minigame.tension > 0.9
        ? 2
        : minigame.tension > 0.5
          ? 1
          : 0
      : 0;

  return (
    <section className="fishing-hud" aria-label="Minigame memancing">
      {/* Status label */}
      {!isResult && (
        <p className="fishing-status" aria-live="polite" aria-atomic="true">
          {PHASE_STATUS[phase]}
        </p>
      )}

      {/* Reel bar + fish indicator */}
      {showBar && minigame && (
        <div className="fishing-bar-container" aria-label="Bar pancing">
          {/* Zone (green band) */}
          <div
            className={`fishing-zone${tensionLevel === 2 ? ' fishing-zone-red' : tensionLevel === 1 ? ' fishing-zone-yellow' : ''}`}
            style={barLayout(minigame.zone.position, minigame.zone.size)}
            aria-hidden="true"
          />
          {/* Fish icon */}
          <div
            className="fishing-fish-icon"
            style={{ bottom: `${Math.round(minigame.fish.position * 100)}%` }}
            aria-hidden="true"
          >
            🐟
          </div>
          {/* Reel meter beside the bar */}
          <VerticalBar
            percent={minigame.reel}
            className="fishing-reel"
            label={`Gulungan: ${Math.round(minigame.reel * 100)}%`}
          />
        </div>
      )}

      {/* Result card */}
      {isResult && (
        <div className="fishing-result" role="status" aria-live="assertive" aria-label="Hasil pancingan">
          {outcome === 'caught' && (
            <>
              <span className="fishing-result-icon">🎣</span>
              <span className="fishing-result-text">{lootLabel(loot)}</span>
            </>
          )}
          {outcome === 'missed' && <span className="fishing-result-text">Ikan lepas!</span>}
          {outcome === 'failed' && <span className="fishing-result-text">Senar putus!</span>}
          {outcome === 'cancelled' && <span className="fishing-result-text">Memancing batal.</span>}
          <button
            type="button"
            className="fishing-btn fishing-btn-result"
            aria-label="Tutup hasil pancingan"
            onClick={() => onRelease?.(loot)}
            autoFocus
          >
            {outcome === 'caught' ? 'Simpan' : 'Tutup'}
          </button>
        </div>
      )}

      {/* Pull button (bite window + reel) */}
      {(isBite || showBar) && (
        <button
          type="button"
          className={`fishing-btn fishing-btn-pull${isBite ? ' fishing-btn-pulse' : ''}`}
          aria-label="Tarik senar"
          onPointerDown={(e) => { e.preventDefault(); onPull(); onPullChange?.(true); }}
          onPointerUp={() => onPullChange?.(false)}
          onPointerLeave={() => onPullChange?.(false)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { onPull(); onPullChange?.(true); } }}
          onKeyUp={(e) => { if (e.key === 'Enter' || e.key === ' ') onPullChange?.(false); }}
        >
          🎣 Tarik
        </button>
      )}

      {/* Cancel button — always visible except result */}
      {!isResult && (
        <button
          type="button"
          className="fishing-btn fishing-btn-cancel"
          aria-label="Batal memancing"
          onClick={onCancel}
        >
          ✕
        </button>
      )}
    </section>
  );
}

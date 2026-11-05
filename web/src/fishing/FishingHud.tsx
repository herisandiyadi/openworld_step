import type { CSSProperties } from 'react';
import type { FishingSession } from './FishingController';
import type { FishingLoot } from './lootTable';
import { fishSpecies } from './lootTable';

interface FishingHudProps {
  session: FishingSession;
  /** One activation resolves the timing gauge. */
  onPull: () => void;
  /** Deprecated hold callback retained so existing parents need no migration. */
  onPullChange?: (pulling: boolean) => void;
  onCancel: () => void;
  onRelease?: (loot: FishingLoot | undefined) => void;
}

const PHASE_STATUS: Record<FishingSession['phase'], string> = {
  cast: 'Melempar senar…',
  wait: 'Menunggu ikan…',
  bite: 'Ketuk saat jarum berada di area sasaran!',
  reel: 'Ketuk saat jarum berada di area sasaran!',
  result: '',
};

function lootLabel(loot: FishingLoot | undefined): string {
  if (!loot) return 'Tidak ada hasil';
  if (loot.kind === 'trash') {
    const labels: Record<string, string> = { can: 'Kaleng bekas', sandal: 'Sandal bekas', boot: 'Sepatu bot', underwear: 'Celana dalam bekas' };
    return labels[loot.id] ?? 'Sampah';
  }
  const species = fishSpecies(loot.id);
  return `${species?.name ?? loot.id} ${loot.weight?.toFixed(2) ?? '?'} kg`;
}

/** Accessible horizontal timing gauge; CSS hooks are intentionally explicit. */
export function FishingHud({ session, onPull, onCancel, onRelease }: FishingHudProps) {
  const { phase, minigame, outcome, loot } = session;
  const showGauge = (phase === 'bite' || phase === 'reel') && minigame !== undefined;
  const isResult = phase === 'result';
  const seconds = minigame ? Math.max(0, minigame.remainingMs / 1000) : 0;
  const targetLeft = minigame ? (minigame.target.position - minigame.target.size / 2) * 100 : 0;
  const gaugeVariables = minigame ? {
    '--fishing-target-left': `${targetLeft}%`,
    '--fishing-target-width': `${minigame.target.size * 100}%`,
    '--fishing-needle-left': `${minigame.needle.position * 100}%`,
  } as CSSProperties : undefined;

  return (
    <section className="fishing-hud" aria-label="Minigame memancing">
      {!isResult && (
        <p className="fishing-status" aria-live="polite" aria-atomic="true">{PHASE_STATUS[phase]}</p>
      )}

      {showGauge && minigame && (
        <div className="fishing-gauge-panel">
          <div
            className="fishing-timing-gauge"
            role="progressbar"
            aria-label={`Posisi jarum: ${Math.round(minigame.needle.position * 100)}%. Sasaran: ${Math.round(targetLeft)} sampai ${Math.round((minigame.target.position + minigame.target.size / 2) * 100)}%.`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(minigame.needle.position * 100)}
            style={gaugeVariables}
          >
            <span className="fishing-target-band" aria-hidden="true" />
            <span className="fishing-needle" aria-hidden="true" />
          </div>
          <p
            className="fishing-countdown"
            role="timer"
            aria-live="polite"
            aria-label={`Waktu tersisa: ${seconds.toFixed(1)} detik`}
          >
            {seconds.toFixed(1)} dtk
          </p>
        </div>
      )}

      {isResult && (
        <div className="fishing-result" role="status" aria-live="assertive" aria-label="Hasil pancingan">
          {outcome === 'caught' && (
            <><span className="fishing-result-icon">🎣</span><span className="fishing-result-text">{lootLabel(loot)}</span></>
          )}
          {outcome === 'escaped' && <span className="fishing-result-text">Ikan lepas!</span>}
          {outcome === 'line-broken' && <span className="fishing-result-text">Senar putus!</span>}
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

      {showGauge && (
        <button
          type="button"
          className="fishing-btn fishing-btn-pull fishing-btn-tap fishing-btn-pulse"
          aria-label="Tap/Tarik sekarang"
          onClick={onPull}
        >
          🎣 Tap / Tarik
        </button>
      )}

      {!isResult && (
        <button type="button" className="fishing-btn fishing-btn-cancel" aria-label="Batal memancing" onClick={onCancel}>✕</button>
      )}
    </section>
  );
}

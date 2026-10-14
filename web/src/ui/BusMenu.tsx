import { useEffect, useState } from 'react';
import { rideBusTo } from '../game/actions';
import { payBusFare, configuredBusFare, buyDayPassAction } from '../game/transitActions';
import { busDestinations } from '../game/busRoutes';
import { useContentProgress } from '../state/contentProgress';
import { useGameStore } from '../state/gameStore';
import { WORLD_DISTRICT_NAMES } from '../world/worldSpec';
import { worldState } from '../world/worldState';

/** Fast-travel destinations offered at a bus stop, with paid fares from the economy pack. */
export function BusMenu() {
  const busStopId = useGameStore((state) => state.nearby.busStopId);
  const setBusMenuOpen = useGameStore((state) => state.setBusMenuOpen);
  const coins = useContentProgress((state) => state.coins);
  const passDate = useContentProgress((state) => state.transitPass.activeDate);
  const [error, setError] = useState<string | null>(null);
  const destinations = busDestinations(worldState.index?.busStops ?? [], busStopId);
  const fare = configuredBusFare();
  const today = new Date().toISOString().slice(0, 10);
  const hasPass = passDate === today;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setBusMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setBusMenuOpen]);

  const board = (stop: (typeof destinations)[number]['stop']) => {
    if (fare > 0 && !hasPass && !payBusFare(fare)) {
      setError('Koin tidak cukup untuk ongkos bus.');
      return;
    }
    setError(null);
    rideBusTo(stop);
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="bus-title">
      <div className="pause-panel bus-panel">
        <h2 id="bus-title">Naik bus ke...</h2>
        <p className="bus-note">
          {hasPass
            ? 'Tiket harian aktif — perjalanan gratis.'
            : fare > 0
              ? `Ongkos perjalanan: ${fare} koin.`
              : 'Bus kota akan datang menjemput dan mengantar kamu ke halte tujuan.'}
        </p>
        {error && (
          <p className="chat-error" role="alert">
            {error}
          </p>
        )}
        {destinations.map((destination, index) => (
          <button
            key={destination.stop.id}
            type="button"
            className="overlay-button secondary bus-option"
            autoFocus={index === 0}
            disabled={!hasPass && fare > 0 && coins < fare}
            onClick={() => board(destination.stop)}
          >
            {destination.label}
            <small>{WORLD_DISTRICT_NAMES[destination.stop.district]}</small>
          </button>
        ))}
        {fare > 0 && !hasPass && (
          <button
            type="button"
            className="overlay-button secondary"
            disabled={coins < fare}
            aria-label={`Beli tiket harian seharga ${fare} koin`}
            onClick={() => {
              if (buyDayPassAction(fare)) setError(null);
              else setError('Koin tidak cukup untuk tiket harian.');
            }}
          >
            Beli tiket harian ({fare} koin)
          </button>
        )}
        <button type="button" className="overlay-button" onClick={() => setBusMenuOpen(false)}>
          Batal
        </button>
      </div>
    </div>
  );
}

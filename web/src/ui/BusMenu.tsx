import { useEffect } from 'react';
import { travelTo } from '../game/actions';
import { busDestinations } from '../game/busRoutes';
import { useGameStore } from '../state/gameStore';
import { DISTRICT_NAMES } from '../world/worldSpec';
import { worldState } from '../world/worldState';

/** Fast-travel destinations offered at a bus stop. */
export function BusMenu() {
  const busStopId = useGameStore((state) => state.nearby.busStopId);
  const setBusMenuOpen = useGameStore((state) => state.setBusMenuOpen);
  const destinations = busDestinations(worldState.index?.busStops ?? [], busStopId);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setBusMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setBusMenuOpen]);

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="bus-title">
      <div className="pause-panel bus-panel">
        <h2 id="bus-title">Naik bus ke...</h2>
        {destinations.map((destination, index) => (
          <button
            key={destination.stop.id}
            type="button"
            className="overlay-button secondary bus-option"
            autoFocus={index === 0}
            onClick={() => travelTo(destination.stop)}
          >
            {destination.label}
            <small>{DISTRICT_NAMES[destination.stop.district]}</small>
          </button>
        ))}
        <button type="button" className="overlay-button" onClick={() => setBusMenuOpen(false)}>
          Batal
        </button>
      </div>
    </div>
  );
}
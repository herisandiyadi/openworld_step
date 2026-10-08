import { useEffect, useRef } from 'react';
import { useGameStore } from '../state/gameStore';
import { routeDistrictSignal, routeRideSignal, routeTimeSignal } from './questSignals';
import { playerState } from './runtime';

/**
 * Subscribes to existing game signals (district change, in-game clock, vehicle
 * mount/dismount) and forwards them to the quest engine. Mounted once in Game so
 * quest steps advance from real gameplay without touching world/ambient modules.
 */
export function QuestSignals() {
  const rideStartedAt = useRef<{ id: string; kind: string; at: number } | null>(null);
  useEffect(() => {
    const unsubscribe = useGameStore.subscribe((state, prev) => {
      if (state.district && state.district !== prev.district) routeDistrictSignal(state.district);
      if (state.clock !== prev.clock) {
        const hour = Number.parseInt(state.clock.slice(0, 2), 10);
        if (Number.isFinite(hour)) routeTimeSignal(hour);
      }
      if (state.riding && state.riding.id !== prev.riding?.id) {
        rideStartedAt.current = { id: state.riding.id, kind: state.riding.kind, at: Date.now() };
      } else if (!state.riding && rideStartedAt.current) {
        // Ride finished: report vehicle + elapsed duration so time-limited quest steps can match.
        const seconds = Math.max(0, Math.round((Date.now() - rideStartedAt.current.at) / 1000));
    routeRideSignal(rideStartedAt.current.kind, { x: playerState.x, z: playerState.z, radius: 0 }, seconds);
        rideStartedAt.current = null;
      }
    });
    return unsubscribe;
  }, []);
  return null;
}

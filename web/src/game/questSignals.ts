/**
 * Signal adapters: existing game events (district change, clock tick, vehicle
 * ride) are translated into quest events. Each helper is a no-op until
 * initQuests has seeded the runtime, so missing content degrades gracefully.
 */
import { visitedDistrict, timeReached, ridden, reached } from '../quest/questEvents';
import { routeQuestEvent } from './questRuntime';

export function routeDistrictSignal(district: string): void {
  routeQuestEvent(visitedDistrict(district));
}

export function routeTimeSignal(hour: number): void {
  routeQuestEvent(timeReached(hour));
}

export function routeRideSignal(vehicleKind: string, destination?: { x: number; z: number; radius: number }, durationSeconds?: number): void {
  routeQuestEvent(ridden(vehicleKind, destination, durationSeconds));
}

export function routeReachSignal(x: number, z: number): void {
  routeQuestEvent(reached(x, z));
}

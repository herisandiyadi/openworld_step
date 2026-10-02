import { describe, expect, it } from 'vitest';
import { busDestinations } from './busRoutes';
import { generateWorld } from '../world/worldGen';

const stops = generateWorld(1337).index.busStops;

describe('bus routes', () => {
  it('offers distinct stops and never the current one', () => {
    const current = stops[0]?.id ?? null;
    const destinations = busDestinations(stops, current);
    expect(destinations.length).toBe(5);
    const ids = destinations.map((destination) => destination.stop.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(current);
    expect(destinations.find((destination) => destination.label === 'Kawasan Industri')?.stop.district).toBe('industrial');
  });
});
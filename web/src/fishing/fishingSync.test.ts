import { describe, expect, it } from 'vitest';
import {
  decodeFishingSync,
  encodeFishingSync,
  remoteFishingState,
  type FishingSyncState,
} from './fishingSync';

const roundTrip = (state: FishingSyncState): FishingSyncState => {
  const result = decodeFishingSync(encodeFishingSync(state));
  if (!result.ok) throw new Error(`decode failed: ${result.error}`);
  return result.state;
};

describe('fishing sync codec', () => {
  it('round-trips idle, cast, wait, bite and reel states', () => {
    const states: FishingSyncState[] = [
      { phase: 'idle', spotIndex: 0, bobberX: 0, bobberZ: 0 },
      { phase: 'cast', spotIndex: 7, bobberX: -12.25, bobberZ: 31.5 },
      { phase: 'wait', spotIndex: 7, bobberX: -12.25, bobberZ: 31.5 },
      { phase: 'bite', spotIndex: 7, bobberX: -12.25, bobberZ: 31.5 },
      { phase: 'reel', spotIndex: 7, bobberX: -12.25, bobberZ: 31.5 },
    ];
    for (const state of states) {
      const decoded = roundTrip(state);
      expect(decoded.phase).toBe(state.phase);
      expect(decoded.spotIndex).toBe(state.spotIndex);
      expect(decoded.bobberX).toBeCloseTo(state.bobberX, 2);
      expect(decoded.bobberZ).toBeCloseTo(state.bobberZ, 2);
    }
  });

  it('uses a fixed compact payload and clamps out-of-range spot indexes', () => {
    const bytes = encodeFishingSync({ phase: 'reel', spotIndex: 99999, bobberX: 0, bobberZ: 0 });
    expect(bytes.byteLength).toBe(8);
    const decoded = decodeFishingSync(bytes);
    expect(decoded.ok && decoded.state.spotIndex).toBe(0xffff);
  });

  it('rejects malformed length, version, phase and non-finite coordinates', () => {
    expect(decodeFishingSync(new Uint8Array(2))).toEqual({ ok: false, error: 'length' });
    const version = encodeFishingSync({ phase: 'idle', spotIndex: 0, bobberX: 0, bobberZ: 0 });
    version[0] = 99;
    expect(decodeFishingSync(version)).toEqual({ ok: false, error: 'version' });
    const phase = encodeFishingSync({ phase: 'idle', spotIndex: 0, bobberX: 0, bobberZ: 0 });
    phase[1] = 99;
    expect(decodeFishingSync(phase)).toEqual({ ok: false, error: 'phase' });
    expect(() => encodeFishingSync({ phase: 'wait', spotIndex: 1, bobberX: Number.NaN, bobberZ: 0 })).toThrow();
  });

  it('merges a newer remote state and ignores stale packets', () => {
    const initial = remoteFishingState(null, {
      playerId: 4,
      sequence: 20,
      state: { phase: 'wait', spotIndex: 3, bobberX: 2, bobberZ: 5 },
    });
    const stale = remoteFishingState(initial, {
      playerId: 4,
      sequence: 19,
      state: { phase: 'reel', spotIndex: 3, bobberX: 4, bobberZ: 9 },
    });
    expect(stale).toBe(initial);
    const newer = remoteFishingState(initial, {
      playerId: 4,
      sequence: 21,
      state: { phase: 'reel', spotIndex: 3, bobberX: 4, bobberZ: 9 },
    });
    expect(newer?.sequence).toBe(21);
    expect(newer?.state.phase).toBe('reel');
  });
});

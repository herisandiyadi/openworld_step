/**
 * Fishing multiplayer bridge implementation.
 * Installs when a multiplayer session is active to replicate spot reservations
 * and publish fishing animation state over the network.
 */

import type { FishingSession } from './FishingController';
import type { FishingAnimPhase, FishingSyncState } from './fishingSync';
import { encodeFishingSync } from './fishingSync';

export interface FishingMultiplayerBridge {
  playerId: string;
  reserve: (spotId: string, now: number) => boolean;
  release: (spotId: string) => void;
  publish?: (session: FishingSession | null) => void;
}

/**
 * Creates a bridge that uses host spot registry and a custom-data channel (when available).
 *
 * External blocker (current net runtime): `src/net/protocol.ts` only defines MSG.hello through
 * MSG.pong; `NetMessage`, `encodeMessage`, `decodeMessage`, HostSession, and ClientSession have
 * no custom fishing-data message/channel. Unknown packets are rejected, so this bridge cannot
 * be attached to live multiplayer transport without a net-protocol/server change. The injectable
 * callbacks below are the tested seam for that future adapter.
 */
export function createFishingMultiplayerBridge(
  playerId: string,
  reserveOnHost: (spotId: string, playerId: string, now: number) => boolean,
  releaseOnHost: (spotId: string, playerId: string) => void,
  publishData?: (bytes: Uint8Array) => void,
): FishingMultiplayerBridge {
  return {
    playerId,
    reserve: (spotId, now) => reserveOnHost(spotId, playerId, now),
    release: (spotId) => releaseOnHost(spotId, playerId),
    publish: publishData
      ? (session) => {
          const state = sessionToSyncState(session);
          if (state) publishData(encodeFishingSync(state));
        }
      : undefined,
  };
}

function sessionToSyncState(session: FishingSession | null): FishingSyncState | null {
  if (!session) return { phase: 'idle', spotIndex: 0, bobberX: 0, bobberZ: 0 };
  const phaseMap: Record<FishingSession['phase'], FishingAnimPhase> = {
    cast: 'cast',
    wait: 'wait',
    bite: 'bite',
    reel: 'reel',
    result: 'idle',
  };
  return {
    phase: phaseMap[session.phase],
    spotIndex: 0,
    bobberX: 0,
    bobberZ: 0,
  };
}

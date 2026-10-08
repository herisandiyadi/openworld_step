import type { FishingSession } from './FishingController';
import type { FishingAnimPhase, FishingSyncState, RemoteFishingRecord } from './fishingSync';
import { decodeFishingSync, encodeFishingSync, remoteFishingState } from './fishingSync';
import * as netRuntime from '../net/netRuntime';

export interface FishingMultiplayerBridge {
  playerId: string;
  reserve: (spotId: string, now: number) => boolean;
  release: (spotId: string) => void;
  publish?: (session: FishingSession | null) => void;
  close?: () => void;
}

/** Creates a bridge over the active HostSession/ClientSession in netRuntime. */
export function createLiveFishingMultiplayerBridge(
  onRemoteState?: (record: { playerId: number; sequence: number; state: FishingSyncState }) => void,
): FishingMultiplayerBridge | null {
  const playerId = netRuntime.localPlayerId();
  if (playerId === null) return null;
  let sequence = 0;
  const records = new Map<number, RemoteFishingRecord>();
  const unsubscribe = netRuntime.onFishingState((remotePlayerId, remoteSequence, payload) => {
    const decoded = decodeFishingSync(payload);
    if (!decoded.ok) return;
    const incoming: RemoteFishingRecord = { playerId: remotePlayerId, sequence: remoteSequence, state: decoded.state };
    const next = remoteFishingState(records.get(remotePlayerId) ?? null, incoming);
    if (next === records.get(remotePlayerId)) return;
    records.set(remotePlayerId, next);
    onRemoteState?.(next);
  });
  return {
    playerId: String(playerId),
    reserve: (spotId, _now) => netRuntime.reserveFishingSpot(spotId),
    release: (spotId) => {
      netRuntime.releaseFishingSpot(spotId);
    },
    publish: (session) => {
      sequence = (sequence + 1) >>> 0;
      netRuntime.publishFishingState(encodeFishingSync(sessionToSyncState(session)), sequence);
    },
    close: unsubscribe
      ? () => {
          unsubscribe();
        }
      : undefined,
  };
}

/** Creates a bridge with explicitly supplied callbacks, useful for offline/local tests. */
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
    publish: publishData ? (session) => publishData(encodeFishingSync(sessionToSyncState(session))) : undefined,
  };
}

function sessionToSyncState(session: FishingSession | null): FishingSyncState {
  if (!session) return { phase: 'idle', spotIndex: 0, bobberX: 0, bobberZ: 0 };
  const phaseMap: Record<FishingSession['phase'], FishingAnimPhase> = {
    cast: 'cast',
    wait: 'wait',
    bite: 'bite',
    reel: 'reel',
    result: 'idle',
  };
  return { phase: phaseMap[session.phase], spotIndex: 0, bobberX: 0, bobberZ: 0 };
}

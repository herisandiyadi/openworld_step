import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { markExplored } from './exploration';
import { BUS_DISTANCE, MODE_RADIUS, TALK_DISTANCE, USE_DISTANCE, jumpState, playerState } from './runtime';
import { findNearestFreeSeat } from './seating';
import { useGameStore } from '../state/gameStore';
import { chunkAt, worldState } from '../world/worldState';

const INTERVAL = 0.15;

/**
 * Throttled (~7 Hz) scan for the NPC, parked vehicle, and bus stop the action buttons should target.
 * Also reveals the fog of war around the player. The store is only touched when a target changes.
 */
export function Proximity() {
  const timer = useRef(0);

  useFrame((_, delta) => {
    timer.current += delta;
    if (timer.current < INTERVAL) return;
    timer.current = 0;
    markExplored(playerState.x, playerState.z);
    const state = useGameStore.getState();
    const onFoot = state.mode === 'walk';

    let vehicleId: string | null = null;
    if (onFoot) {
      let best = Infinity;
      for (const vehicle of state.vehicles) {
        const distance = Math.hypot(vehicle.x - playerState.x, vehicle.z - playerState.z);
        if (distance < MODE_RADIUS[vehicle.kind] + USE_DISTANCE && distance < best) {
          best = distance;
          vehicleId = vehicle.id;
        }
      }
    }

    let npcId: string | null = null;
    let bestNpc = TALK_DISTANCE;
    for (const npc of worldState.index?.npcs ?? []) {
      if (!chunkAt(npc.x, npc.z)) continue;
      const distance = Math.hypot(npc.x - playerState.x, npc.z - playerState.z);
      if (distance < bestNpc) {
        bestNpc = distance;
        npcId = npc.id;
      }
    }

    let busStopId: string | null = null;
    if (onFoot) {
      let bestStop = BUS_DISTANCE;
      for (const stop of worldState.index?.busStops ?? []) {
        const distance = Math.hypot(stop.x - playerState.x, stop.z - playerState.z);
        if (distance < bestStop) {
          bestStop = distance;
          busStopId = stop.id;
        }
      }
    }

    // Kursi bangku: hanya saat jalan kaki, tidak di udara, dan belum duduk.
    const airborne = jumpState.y > 0 || jumpState.vy !== 0;
    const seatId =
      onFoot && !airborne && !state.seated
        ? (findNearestFreeSeat(worldState.index?.seats ?? [], playerState.x, playerState.z)?.id ?? null)
        : null;

    const current = state.nearby;
    if (vehicleId !== current.vehicleId || npcId !== current.npcId || busStopId !== current.busStopId || seatId !== current.seatId) {
      state.setNearby({ npcId, vehicleId, busStopId, seatId });
    }
  });

  return null;
}
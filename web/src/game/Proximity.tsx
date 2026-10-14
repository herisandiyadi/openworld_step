import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { pedRuntime, RESIDENTS } from '../ambient/PedestrianLayer';
import { nearestPed, PED_TALK_DISTANCE } from '../ambient/pedestrianSim';
import { markExplored } from './exploration';
import { BUS_DISTANCE, MODE_RADIUS, TALK_DISTANCE, USE_DISTANCE, jumpState, playerState } from './runtime';
import { findNearestFreeSeat } from './seating';
import { useGameStore } from '../state/gameStore';
import { chunkAt, worldState, type ChunkRecord } from '../world/worldState';
import { currentMode } from '../net/netRuntime';
import { useNetStore } from '../net/netStore';
import { isClaimable, useSharedVehicles, vehicleOwner } from './sharedVehicles';
import { routeReachSignal } from './questSignals';

const INTERVAL = 0.15;

/**
 * Throttled (~7 Hz) scan for the NPC (named NPC or ambient resident), parked vehicle, and bus stop the action buttons should target.
 * Also reveals the fog of war around the player. The store is only touched when a target changes.
 */
export function Proximity() {
  const timer = useRef(0);

  useFrame((_, delta) => {
    timer.current += delta;
    if (timer.current < INTERVAL) return;
    timer.current = 0;
    markExplored(playerState.x, playerState.z);
    routeReachSignal(playerState.x, playerState.z);
    const state = useGameStore.getState();
    const onFoot = state.mode === 'walk';
    const fishingActive = state.fishing !== null;


    let vehicleId: string | null = null;
    if (onFoot && !fishingActive) {
      let best = Infinity;
      const inSession = currentMode() !== null;
      const owners = useSharedVehicles.getState().owners;
      const localId = useNetStore.getState().playerId;
      for (const vehicle of state.vehicles) {
        // Dipakai pemain lain: tombol Naik tidak muncul; kendaraan ditandai merah + label "Dipakai ...".
        if (!isClaimable(vehicleOwner(owners, vehicle.id), localId, inSession)) continue;
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

    // Warga ambient dalam 3 m hanya kalau tidak ada NPC bernama di dekat (NPC bernama diprioritaskan).
    if (!npcId && onFoot && pedRuntime.graph) {
      const ped = nearestPed(pedRuntime.graph, pedRuntime.world, playerState.x, playerState.z, PED_TALK_DISTANCE);
      npcId = ped ? (RESIDENTS[ped.residentIndex]?.id ?? null) : null;
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

    let shopId: string | null = null;
    let fishingSpotId: string | null = null;
    let trashBinId: string | null = null;
    let fishStallId: string | null = null;
    if (onFoot && !fishingActive) {
      const index = worldState.index as (typeof worldState.index & {
        shops?: { id: string; x: number; z: number }[];
        fishingSpots?: { id: string; x: number; z: number }[];
        trashBins?: { id: string; x: number; z: number }[];
        fishStalls?: { id: string; x: number; z: number }[];
      }) | null;
      const streamed = [...worldState.chunks.values()] as (ChunkRecord & {
        shops?: { id: string; x: number; z: number }[];
        fishingSpots?: { id: string; x: number; z: number }[];
        trashBins?: { id: string; x: number; z: number }[];
        fishStalls?: { id: string; x: number; z: number }[];
      })[];
      const collect = (key: 'shops' | 'fishingSpots' | 'trashBins' | 'fishStalls'): { id: string; x: number; z: number }[] => [
        ...(index?.[key] ?? []),
        ...streamed.flatMap((chunk) => chunk[key] ?? []),
      ];
      const nearest = <T extends { id: string; x: number; z: number }>(items: readonly T[], radius: number): string | null => {
        let best = radius;
        let found: string | null = null;
        for (const item of items ?? []) {
          const distance = Math.hypot(item.x - playerState.x, item.z - playerState.z);
          if (distance < best) { best = distance; found = item.id; }
        }
        return found;
      };
      shopId = nearest(collect('shops'), 3.5);
      fishingSpotId = nearest(collect('fishingSpots'), 3.5);
      trashBinId = nearest(collect('trashBins'), 3.5);
      fishStallId = nearest(collect('fishStalls'), 3.5);
    }

    // Kursi bangku: hanya saat jalan kaki, tidak di udara, dan belum duduk.
    const airborne = jumpState.y > 0 || jumpState.vy !== 0;
    const seatId =
      onFoot && !airborne && !state.seated
        ? (findNearestFreeSeat(worldState.index?.seats ?? [], playerState.x, playerState.z)?.id ?? null)
        : null;

    const current = state.nearby;
    if (
      vehicleId !== current.vehicleId ||
      npcId !== current.npcId ||
      busStopId !== current.busStopId ||
      seatId !== current.seatId ||
      shopId !== current.shopId ||
      fishingSpotId !== current.fishingSpotId ||
      trashBinId !== current.trashBinId ||
      fishStallId !== current.fishStallId
    ) {
      state.setNearby({ npcId, vehicleId, busStopId, seatId, shopId, fishingSpotId, trashBinId, fishStallId });
    }
  });

  // Render pejalan kaki ada di AmbientLayer (B7); di sini hanya pemindaian target aksi.
  return null;
}
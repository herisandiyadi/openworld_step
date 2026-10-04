import { beforeEach, describe, expect, it } from 'vitest';
import type { VehicleInfo } from '../net/session';
import {
  CLAIMED_TINT,
  NO_OWNER,
  applyVehicleUpdate,
  claimedLabel,
  isClaimable,
  isClaimedByOther,
  onSharedVehicleUpdate,
  reduceVehicleUpdate,
  resetSharedVehicles,
  shouldEject,
  useSharedVehicles,
  vehicleOwner,
  vehicleTint,
} from './sharedVehicles';

const info = (vehicleId: string, ownerId: number, x = 1, z = 2, yaw = 0.5): VehicleInfo => ({ vehicleId, ownerId, x, z, yaw });

describe('shared vehicles ownership', () => {
  beforeEach(() => resetSharedVehicles());

  it('treats unknown vehicles as free', () => {
    expect(vehicleOwner({}, 'v_spawn_bike')).toBe(NO_OWNER);
    expect(isClaimedByOther(NO_OWNER, 7)).toBe(false);
  });

  it('marks a vehicle held by another player as claimed, but not your own', () => {
    expect(isClaimedByOther(3, 7)).toBe(true);
    expect(isClaimedByOther(7, 7)).toBe(false);
  });

  it('blocks mounting only inside a session', () => {
    // Single-player: mode null -> inSession false, tidak ada yang terkunci.
    expect(isClaimable(3, null, false)).toBe(true);
    expect(isClaimable(3, 7, true)).toBe(false);
    expect(isClaimable(7, 7, true)).toBe(true);
    expect(isClaimable(NO_OWNER, 7, true)).toBe(true);
  });

  it('tints and labels only vehicles used by other players', () => {
    expect(vehicleTint(3, 7)).toBe(CLAIMED_TINT);
    expect(vehicleTint(7, 7)).toBeNull();
    expect(vehicleTint(NO_OWNER, 7)).toBeNull();
    expect(claimedLabel('Budi')).toBe('Dipakai Budi');
    expect(claimedLabel(undefined)).toBe('Dipakai pemain lain');
  });

  it('ejects the local rider when the host hands the vehicle to someone else', () => {
    expect(shouldEject(info('v_spawn_bike', 3), 7, 'v_spawn_bike')).toBe(true);
    expect(shouldEject(info('v_spawn_bike', 7), 7, 'v_spawn_bike')).toBe(false);
    expect(shouldEject(info('v_spawn_bike', 3), 7, 'v_spawn_car')).toBe(false);
    expect(shouldEject(info('v_spawn_bike', NO_OWNER), 7, 'v_spawn_bike')).toBe(false);
  });

  it('reduces host updates into owners and poses, and frees on ownerId 0', () => {
    const claimed = reduceVehicleUpdate({ owners: {}, poses: {} }, info('v_spawn_bike', 3, 10, 20, 1));
    expect(claimed.owners).toEqual({ v_spawn_bike: 3 });
    expect(claimed.poses.v_spawn_bike).toEqual({ x: 10, z: 20, yaw: 1 });
    const freed = reduceVehicleUpdate(claimed, info('v_spawn_bike', NO_OWNER, 11, 21, 2));
    expect(freed.owners).toEqual({});
    expect(freed.poses.v_spawn_bike).toEqual({ x: 11, z: 21, yaw: 2 });
  });

  it('applyVehicleUpdate writes the store and notifies listeners', () => {
    const seen: VehicleInfo[] = [];
    const stop = onSharedVehicleUpdate((item) => seen.push(item));
    applyVehicleUpdate(info('v_spawn_moto', 4, 5, 6, 0.25));
    expect(useSharedVehicles.getState().owners).toEqual({ v_spawn_moto: 4 });
    expect(useSharedVehicles.getState().poses.v_spawn_moto).toEqual({ x: 5, z: 6, yaw: 0.25 });
    expect(seen).toHaveLength(1);
    stop();
    applyVehicleUpdate(info('v_spawn_moto', NO_OWNER));
    expect(seen).toHaveLength(1);
    expect(useSharedVehicles.getState().owners).toEqual({});
  });

  it('reset clears every claim so single-player starts free', () => {
    applyVehicleUpdate(info('v_spawn_car', 9));
    resetSharedVehicles();
    expect(useSharedVehicles.getState().owners).toEqual({});
    expect(useSharedVehicles.getState().poses).toEqual({});
  });
});

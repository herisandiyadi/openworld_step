import { describe, it, expect } from 'vitest';
import { useGameStore, NO_NEARBY } from './gameStore';

describe('gameStore economy/fishing integration', () => {
  it('extends nearby for shopId, fishingSpotId, trashBinId, fishStallId', () => {
    useGameStore.getState().setNearby({ ...NO_NEARBY, npcId: 'npc_test' });
    expect(useGameStore.getState().nearby.npcId).toBe('npc_test');

    // Extended fields should exist
    const extended = { ...NO_NEARBY, shopId: 'shop_1', fishingSpotId: 'spot_1', trashBinId: 'bin_1', fishStallId: 'stall_1' };
    useGameStore.getState().setNearby(extended);
    expect(useGameStore.getState().nearby).toMatchObject(extended);
  });
});

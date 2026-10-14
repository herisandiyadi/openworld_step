import { useEffect, useState } from 'react';
import type { ContentRegistry } from '../content/registry';
import { mergeNpcRoster } from '../content-runtime/npcs';
import { Npcs } from '../game/Npc';
import { dayClock } from '../game/runtime';
import { useGameStore } from '../state/gameStore';
import type { NpcSpawn } from './worldSpec';

const hourAt = (t: number): number => (((t % 1) + 1) % 1) * 24;

/**
 * Bridges the loaded content NPC registry into the baked world layer. The game
 * clock subscription refreshes this small roster on each displayed 10-minute
 * tick, which also removes NPCs outside their active schedule entries.
 */
export function NpcLayer({ baked, registry }: { baked: readonly NpcSpawn[]; registry: ContentRegistry | null }) {
  const [spawns, setSpawns] = useState<readonly NpcSpawn[]>(() =>
    registry ? mergeNpcRoster(registry, baked, hourAt(dayClock.t)) : baked,
  );

  useEffect(() => {
    const refresh = () => setSpawns(registry ? mergeNpcRoster(registry, baked, hourAt(dayClock.t)) : baked);
    refresh();
    return useGameStore.subscribe((state, previous) => {
      if (state.clock !== previous.clock) refresh();
    });
  }, [baked, registry]);

  return <Npcs spawns={spawns} />;
}

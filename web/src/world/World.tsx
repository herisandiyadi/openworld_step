import { use, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import type { Mesh } from 'three';
import { assetUrl } from '../app/assets';
import { AmbientLayer } from '../ambient/AmbientLayer';
import { Npcs } from '../game/Npc';
import { playerState, sceneRefs } from '../game/runtime';
import { useGameStore } from '../state/gameStore';
import { ChunkStreamer, type PropParts } from './chunkStreamer';
import { Impostors } from './Impostors';
import { loadNavigation } from './navigation';
import { PROP_IDS } from './propSpec';
import { chunkAt, loadWorldIndex, worldUrl } from './worldState';

const STATS_INTERVAL = 0.5;

/** Extracts each prop GLB's mesh parts once; chunks instance them per placement. */
function usePropParts(): PropParts {
  const gltfs = useGLTF(PROP_IDS.map((id) => assetUrl(id)));
  return useMemo(() => {
    const parts: PropParts = {};
    PROP_IDS.forEach((id, index) => {
      const scene = gltfs[index]?.scene;
      if (!scene) return;
      scene.updateMatrixWorld(true);
      const list: NonNullable<PropParts[typeof id]> = [];
      scene.traverse((object) => {
        const mesh = object as Mesh;
        if (mesh.isMesh) list.push({ geometry: mesh.geometry, material: mesh.material, matrix: mesh.matrixWorld.clone() });
      });
      parts[id] = list;
    });
    return parts;
  }, [gltfs]);
}

/** Streams the baked city around the player (chunk JSON -> worker -> instanced meshes). */
export function World() {
  const index = use(loadWorldIndex());
  const parts = usePropParts();
  const setWorldReady = useGameStore((state) => state.setWorldReady);
  const setStream = useGameStore((state) => state.setStream);
  const setDistrict = useGameStore((state) => state.setDistrict);
  const [streamer, setStreamer] = useState<ChunkStreamer | null>(null);
  const statsTimer = useRef(0);

  // Created inside the effect (not useMemo) so a StrictMode/remount cleanup can never leave a
  // disposed streamer with a terminated worker in use.
  useEffect(() => {
    const instance = new ChunkStreamer(
      parts,
      (key) => worldUrl(`chunks/${key}.json`),
      () => setWorldReady(true),
      (message) => console.error(`[world] ${message}`),
    );
    sceneRefs.pickables = instance.pickables;
    setStreamer(instance);
    return () => {
      sceneRefs.pickables = [];
      instance.dispose();
      setStreamer(null);
    };
  }, [parts, setWorldReady]);

  useEffect(() => {
    loadNavigation(index.navmesh).catch((error: unknown) => console.error('[world] navmesh', error));
  }, [index.navmesh]);

  useFrame((_, delta) => {
    if (!streamer) return;
    streamer.update(playerState.x, playerState.z);
    statsTimer.current += delta;
    if (statsTimer.current < STATS_INTERVAL) return;
    statsTimer.current = 0;
    const { stats } = streamer;
    setStream({ chunks: stats.loaded, pending: stats.pending, applyMs: stats.maxApplyMs });
    const district = chunkAt(playerState.x, playerState.z)?.district ?? null;
    if (district !== useGameStore.getState().district) setDistrict(district);
  });

  return (
    <>
      {streamer && <primitive object={streamer.root} />}
      <Impostors />
      <Npcs spawns={index.npcs} />
      <AmbientLayer busStops={index.busStops} />
    </>
  );
}
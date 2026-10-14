import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { type Group, MeshBasicMaterial, OctahedronGeometry } from 'three';
import { ClipPlayer, useCharacter } from './character';
import { TALK_DISTANCE, playerState } from './runtime';
import { questNpcMarkerState } from './questRuntime';
import { useContentProgress } from '../state/contentProgress';
import type { NpcSpawn } from '../world/worldSpec';
import { chunkAt, groundHeightAt } from '../world/worldState';

const LABEL_DISTANCE = 22;
const TURN_SMOOTHING = 6;
const MARKER_Y = 2.35;

/** Shared by every NPC marker; tiny and lives for the whole session. */
const MARKER_GEOMETRY = new OctahedronGeometry(0.22, 0);
const MARKER_MATERIAL = new MeshBasicMaterial({ color: '#ffd23f' });
/** Quest markers recolor the octahedron: ? (turn-in) wins over ! (available). */
const QUEST_MARKER_COLOR: Record<'!' | '?', string> = { '!': '#ffd23f', '?': '#7fe08a' };

type QuestMarker = '!' | '?' | null;

const glyphFor = (state: 'available' | 'turn-in' | null): QuestMarker =>
  state === 'turn-in' ? '?' : state === 'available' ? '!' : null;

/** Idles, turns to face the player up close, and shows a floating marker + name (AI chat lands in Phase 4). */
function Npc({ spawn }: { spawn: NpcSpawn }) {
  const { scene, mixer, actions } = useCharacter(spawn.asset);
  const groupRef = useRef<Group>(null);
  const markerRef = useRef<Group>(null);
  const player = useMemo(() => new ClipPlayer(), []);
  const [showLabel, setShowLabel] = useState(false);
  // Live quest glyph from the quest store; null hides the quest marker entirely.
  const [questMarker, setQuestMarker] = useState<QuestMarker>(() => glyphFor(questNpcMarkerState(spawn.id)));

  useEffect(() => {
    const sync = () => setQuestMarker(glyphFor(questNpcMarkerState(spawn.id)));
    sync();
    // Quest steps advance outside React; refresh the marker whenever the store changes.
    const unsubscribe = useContentProgress.subscribe(sync);
    return unsubscribe;
  }, [spawn.id]);

  useFrame((state, delta) => {
    const group = groupRef.current;
    // NPCs only exist while their chunk is streamed in (ground height is known there).
    const present = chunkAt(spawn.x, spawn.z) !== undefined;
    if (group) {
      group.visible = present;
      if (present) group.position.y = groundHeightAt(spawn.x, spawn.z);
    }
    if (!present) {
      if (showLabel) setShowLabel(false);
      return;
    }
    const dt = Math.min(delta, 0.05);
    const dx = playerState.x - spawn.x;
    const dz = playerState.z - spawn.z;
    const distance = Math.hypot(dx, dz);
    const near = distance < TALK_DISTANCE;
    const action = actions.get(near ? 'anim_Talk' : 'anim_Idle');
    if (action) player.play(action, 0.3);
    mixer.update(dt);

    const wantLabel = distance < LABEL_DISTANCE;
    if (wantLabel !== showLabel) setShowLabel(wantLabel);

    const marker = markerRef.current;
    if (marker) {
      const time = state.clock.elapsedTime;
      marker.position.y = MARKER_Y + Math.sin(time * 2.4) * 0.12;
      marker.rotation.y = time * 1.6;
      marker.visible = questMarker === null;
    }

    if (!group) return;
    const targetYaw = near ? Math.atan2(-dx, -dz) + Math.PI : spawn.yaw;
    const deltaYaw = Math.atan2(Math.sin(targetYaw - group.rotation.y), Math.cos(targetYaw - group.rotation.y));
    group.rotation.y += deltaYaw * (1 - Math.exp(-TURN_SMOOTHING * dt));
  });

  return (
    <group ref={groupRef} position={[spawn.x, 0, spawn.z]} visible={false} rotation-y={spawn.yaw}>
      <primitive object={scene} />
      <group ref={markerRef} position-y={MARKER_Y}>
        <mesh geometry={MARKER_GEOMETRY} material={MARKER_MATERIAL} scale={[1, 1.5, 1]} />
      </group>
      {questMarker !== null && (
        <Html position={[0, MARKER_Y + 0.85, 0]} center zIndexRange={[10, 0]} pointerEvents="none">
          <div
            className={`npc-quest-marker npc-quest-marker-${questMarker === '?' ? 'turnin' : 'available'}`}
            role="img"
            aria-label={questMarker === '?' ? `Serahkan quest pada ${spawn.name}` : `Quest tersedia dari ${spawn.name}`}
            style={{ color: QUEST_MARKER_COLOR[questMarker] }}
          >
            {questMarker}
          </div>
        </Html>
      )}
      {showLabel && (
        <Html position={[0, MARKER_Y + 0.55, 0]} center zIndexRange={[10, 0]} pointerEvents="none">
          <div className="npc-label">{spawn.name}</div>
        </Html>
      )}
    </group>
  );
}

export function Npcs({ spawns }: { spawns: readonly NpcSpawn[] }) {
  return spawns.map((spawn) => <Npc key={spawn.id} spawn={spawn} />);
}

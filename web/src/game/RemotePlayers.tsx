import { type ReactElement, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  type Group,
  LinearFilter,
  Sprite,
  SpriteMaterial,
  Texture,
} from 'three';
import { ClipPlayer, useCharacter } from './character';
import { applyAppearance, heroAssetId } from './HeroAppearance';
import {
  LABEL_VISIBLE_DISTANCE,
  MAX_VISIBLE_REMOTES,
  REMOTE_FOG_FAR,
  type RemoteCandidate,
  selectVisibleRemotes,
} from './remotePlayers';
import { useNetStore } from '../net/netStore';
import { netSession } from '../net/netRuntime';
import { ClientSession, INTERPOLATION_DELAY_MS, lerpAngle } from '../net/session';
import type { AnimId, PlayerId, PlayerSnapshot } from '../net/protocol';
import { DEFAULT_APPEARANCE, type Appearance } from '../state/profile';

/**
 * Menggambar pemain lain di dunia 3D (MULTIPLAYER.md 4): posisi dari interpolasi sesi,
 * penampilan milik masing-masing pemain, dan label nama yang mengapung.
 * Semua update posisi/animasi lewat useFrame + mutasi ref; tidak ada setState per frame.
 */

/** Tinggi label di atas pijakan pemain (m). */
const LABEL_Y = 2.3;
/** Kelembutan rotasi badan (makin besar makin cepat mengikuti heading). */
const TURN_SMOOTHING = 8;
/** Lebar sprite label di dunia (m); tingginya mengikuti rasio kanvas. */
const LABEL_WIDTH = 1.6;

/** Jarak tiap pemain yang digambar frame ini, diisi komponen induk sebelum anak-anaknya. */
const frameDistances = new Map<PlayerId, number>();

/** Kunci penampilan: mesh hanya dibangun ulang kalau string ini berubah. */
const appearanceKey = (a: Appearance): string =>
  `${a.gender}|${a.skinTone}|${a.hairStyle}|${a.hairColor}|${a.expression}|${a.shirtColor}|${a.shirtStyle}|${a.pantsColor}|${a.pantsStyle}|${a.accessory}`;

/** Klip GLB untuk tiap animasi yang dikirim lewat protokol. */
const CLIP_OF: Record<AnimId, string> = {
  idle: 'anim_Idle',
  walk: 'anim_Walk',
  run: 'anim_Run',
  ride: 'anim_Bike',
  sit: 'anim_Sit',
  jump: 'anim_Idle',
};

/**
 * Label nama sebagai tekstur kanvas: dibuat sekali per username, jadi tidak ada DOM
 * dan tidak ada biaya per frame (beda dengan `<Html>` yang dipakai NPC).
 */
function makeLabelTexture(username: string): Texture {
  const scale = 2;
  const font = 28 * scale;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return new Texture();
  context.font = `600 ${font}px sans-serif`;
  const padding = 14 * scale;
  const width = Math.min(512, Math.ceil(context.measureText(username).width + padding * 2));
  canvas.width = Math.max(32, width);
  canvas.height = Math.ceil(font + padding * 1.4);
  // Mengubah ukuran kanvas mereset state konteks, jadi font diset ulang.
  const ctx = context;
  ctx.font = `600 ${font}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(12, 16, 24, 0.6)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#f4f7fb';
  ctx.fillText(username, canvas.width / 2, canvas.height / 2);
  const texture = new Texture(canvas);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** Posisi siap gambar: interpolasi dari ClientSession, atau posisi terakhir dari store. */
function sampleRemote(playerId: PlayerId): PlayerSnapshot | { x: number; y: number; z: number; heading: number } | null {
  const session = netSession();
  if (session instanceof ClientSession) {
    const snap = session.sample(playerId, INTERPOLATION_DELAY_MS);
    if (snap) return snap;
  }
  return useNetStore.getState().remotes[playerId]?.position ?? null;
}

function RemotePlayerView({ playerId }: { playerId: PlayerId }): ReactElement | null {
  const remote = useNetStore((state) => state.remotes[playerId]);
  const appearance = remote?.appearance;
  const username = remote?.username ?? '';
  const key = appearance ? appearanceKey(appearance) : '';
  const { scene, mixer, actions } = useCharacter(heroAssetId(appearance ?? DEFAULT_APPEARANCE));
  const groupRef = useRef<Group>(null);
  const clip = useMemo(() => new ClipPlayer(), []);

  // Mesh gabungan hanya dibangun ulang saat penampilan pemain ini berubah (bukan tiap render).
  const built = useRef('');
  useEffect(() => {
    if (!appearance) return;
    const next = `${scene.uuid}|${key}`;
    if (built.current === next) return;
    built.current = next;
    applyAppearance(scene, appearance);
  }, [scene, key, appearance]);

  // Label dibuat sekali per username dan dibuang saat pemain keluar.
  const label = useMemo(() => {
    if (!username) return null;
    const texture = makeLabelTexture(username);
    const material = new SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    const sprite = new Sprite(material);
    const image = texture.image as HTMLCanvasElement | undefined;
    const ratio = image && image.width > 0 ? image.height / image.width : 0.3;
    sprite.scale.set(LABEL_WIDTH, LABEL_WIDTH * ratio, 1);
    sprite.position.y = LABEL_Y;
    return { sprite, material, texture };
  }, [username]);

  useEffect(
    () => () => {
      label?.texture.dispose();
      label?.material.dispose();
    },
    [label],
  );

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;
    const distance = frameDistances.get(playerId);
    if (distance === undefined) {
      // Di luar kabut atau kalah dari 20 pemain terdekat: tidak digambar dan tidak dianimasikan.
      group.visible = false;
      return;
    }
    const pose = sampleRemote(playerId);
    if (!pose) {
      group.visible = false;
      return;
    }
    group.visible = true;
    group.position.set(pose.x, pose.y, pose.z);
    const dt = Math.min(delta, 0.05);
    group.rotation.y = lerpAngle(group.rotation.y, pose.heading, 1 - Math.exp(-TURN_SMOOTHING * dt));

    const anim = 'anim' in pose ? pose.anim : 'idle';
    const action = actions.get(CLIP_OF[anim]) ?? actions.get('anim_Idle');
    if (action) clip.play(action);
    mixer.update(dt);

    if (label) label.sprite.visible = distance <= LABEL_VISIBLE_DISTANCE;
  });

  if (!remote) return null;
  return (
    <group ref={groupRef} visible={false}>
      <primitive object={scene} />
      {label && <primitive object={label.sprite} />}
    </group>
  );
}

export interface RemotePlayersProps {
  /** Maksimum pemain yang digambar sekaligus (default MAX_VISIBLE_REMOTES = 20). */
  maxVisible?: number;
  /** Jarak culling, default sama dengan batas kabut App.tsx. */
  fogFar?: number;
}

export function RemotePlayers({ maxVisible = MAX_VISIBLE_REMOTES, fogFar = REMOTE_FOG_FAR }: RemotePlayersProps = {}): ReactElement {
  // Hanya daftar id yang dipakai untuk render; posisi/animasi diambil per frame.
  const ids = useNetStore((state) => Object.keys(state.remotes).join(','));
  const playerIds = useMemo(() => (ids ? ids.split(',').map(Number) : []), [ids]);
  const candidates = useRef<RemoteCandidate[]>([]);

  useEffect(() => () => frameDistances.clear(), []);

  // Prioritas -1: jalan sebelum useFrame tiap pemain, jadi daftar jarak sudah siap.
  useFrame((state) => {
    frameDistances.clear();
    const list = candidates.current;
    list.length = 0;
    for (const id of playerIds) {
      const pose = sampleRemote(id);
      if (pose) list.push({ id, x: pose.x, z: pose.z });
    }
    const camera = state.camera.position;
    for (const visible of selectVisibleRemotes(list, { x: camera.x, z: camera.z }, maxVisible, fogFar)) {
      frameDistances.set(visible.id, visible.distance);
    }
  }, -1);

  return (
    <>
      {playerIds.map((id) => (
        <RemotePlayerView key={id} playerId={id} />
      ))}
    </>
  );
}

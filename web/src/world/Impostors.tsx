import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BoxGeometry, Group, InstancedMesh, Matrix4, MeshBasicMaterial } from 'three';
import { playerState } from '../game/runtime';
import { chunkCoord, chunkKey, type ChunkData, inWorld, LOAD_RADIUS } from './worldSpec';
import { worldUrl } from './worldState';

/** Cincin chunk tepat di luar radius muat; lebih jauh dari itu sudah tertutup fog penuh (140 m). */
const RING = LOAD_RADIUS + 1;

/**
 * Siluet gedung murah untuk chunk di luar radius muat: kotak polos tanpa detail, 1 InstancedMesh
 * (1 draw call) per chunk, hanya untuk cincin terluar, dan di-cull frustum oleh three.js.
 * ponytail: data diambil dari chunk JSON yang sama (fetch per chunk, disimpan sampai unmount).
 * Upgrade ke atlas siluet per kawasan di index.json kalau fetch ini terasa di HP.
 */
export function Impostors() {
  const group = useMemo(() => new Group(), []);
  const geometry = useMemo(() => new BoxGeometry(1, 1, 1), []);
  const material = useMemo(() => new MeshBasicMaterial({ color: '#8f9cab' }), []);
  const meshes = useRef(new Map<string, InstancedMesh | null>());
  const center = useRef({ cx: -1, cz: -1 });

  useEffect(
    () => () => {
      for (const mesh of meshes.current.values()) mesh?.dispose();
      meshes.current.clear();
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame(() => {
    const cx = chunkCoord(playerState.x);
    const cz = chunkCoord(playerState.z);
    if (cx === center.current.cx && cz === center.current.cz) return;
    center.current = { cx, cz };

    for (const [key, mesh] of meshes.current) {
      if (!mesh) continue;
      const [x = 0, z = 0] = key.split('_').map(Number);
      mesh.visible = Math.max(Math.abs(x - cx), Math.abs(z - cz)) === RING;
    }

    for (let dz = -RING; dz <= RING; dz++) {
      for (let dx = -RING; dx <= RING; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== RING || !inWorld(cx + dx, cz + dz)) continue;
        const key = chunkKey(cx + dx, cz + dz);
        if (meshes.current.has(key)) continue;
        meshes.current.set(key, null);
        fetch(worldUrl(`chunks/${key}.json`))
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json() as Promise<ChunkData>;
          })
          .then((data) => {
            if (!meshes.current.has(key) || data.buildings.length === 0) return;
            const mesh = new InstancedMesh(geometry, material, data.buildings.length);
            const matrix = new Matrix4();
            data.buildings.forEach((b, index) => {
              const sx = b.maxX - b.minX;
              const sy = b.topY - b.baseY;
              const sz = b.maxZ - b.minZ;
              mesh.setMatrixAt(index, matrix.makeScale(sx, sy, sz).setPosition(b.minX + sx / 2, b.baseY + sy / 2, b.minZ + sz / 2));
            });
            mesh.matrixAutoUpdate = false;
            mesh.computeBoundingSphere();
            const [x = 0, z = 0] = key.split('_').map(Number);
            mesh.visible = Math.max(Math.abs(x - center.current.cx), Math.abs(z - center.current.cz)) === RING;
            meshes.current.set(key, mesh);
            group.add(mesh);
          })
          .catch((error: unknown) => {
            // Coba lagi saat pemain pindah chunk berikutnya.
            meshes.current.delete(key);
            console.error('[impostor]', key, error);
          });
      }
    }
  });

  return <primitive object={group} />;
}

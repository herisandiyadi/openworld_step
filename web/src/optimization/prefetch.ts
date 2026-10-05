/**
 * Prefetch chunk berdasarkan arah gerak player — VISUAL_UPGRADE_TASKS §6 P0
 * ("Prefetch chunk berdasarkan arah gerak player").
 *
 * Murni dan deterministik: hanya aritmetika pada posisi + vektor kecepatan, tanpa three/worker.
 * Dipakai ChunkStreamer untuk mengurutkan antrean load supaya chunk yang akan dimasuki
 * player sampai lebih dulu (mengurangi pop-in saat berpindah chunk).
 */
import { chunkCoord, chunkKey, chunkOrigin, inWorld, CHUNK_SIZE } from '../world/worldSpec';
import type { StreamingPolicy } from './streamingPolicy';

export interface MotionSample {
  x: number;
  z: number;
  /** Kecepatan m/s pada sumbu dunia. Nol atau non-finite = dianggap diam. */
  vx: number;
  vz: number;
}

/** Nilai non-finite dibersihkan jadi 0 supaya tidak pernah menghasilkan key 'NaN_NaN'. */
const finite = (value: number): number => (Number.isFinite(value) ? value : 0);

/**
 * Urutan prioritas key chunk yang perlu tersedia di sekitar player.
 *
 * Aturan:
 * - chunk player selalu pertama;
 * - radius dasar = policy.loadRadius (Chebyshev);
 * - saat bergerak, radius diperluas policy.prefetchAhead chunk, tapi HANYA untuk chunk yang
 *   searah gerak (dot product positif terhadap arah kecepatan);
 * - pengurutan: jarak Chebyshev ke posisi prediksi (lookahead), lalu jarak euclid sebagai
 *   pemecah seri, lalu key secara leksikografis supaya hasilnya deterministik penuh.
 */
export function prefetchOrder(motion: MotionSample, policy: StreamingPolicy): string[] {
  const x = finite(motion.x);
  const z = finite(motion.z);
  const vx = finite(motion.vx);
  const vz = finite(motion.vz);
  const speed = Math.hypot(vx, vz);
  const moving = speed > 1e-4;
  // Arah normal (0,0) saat diam -> semua dot product 0 -> tidak ada perluasan radius.
  const dirX = moving ? vx / speed : 0;
  const dirZ = moving ? vz / speed : 0;

  const centerCx = chunkCoord(x);
  const centerCz = chunkCoord(z);
  const reach = policy.loadRadius + (moving ? policy.prefetchAhead : 0);

  // Posisi prediksi: tempat player beberapa detik ke depan, dalam satuan chunk.
  const aheadX = x + dirX * speed * policy.lookaheadSeconds;
  const aheadZ = z + dirZ * speed * policy.lookaheadSeconds;
  const predCx = aheadX / CHUNK_SIZE;
  const predCz = aheadZ / CHUNK_SIZE;

  const entries: { key: string; cheb: number; euclid: number }[] = [];
  for (let dz = -reach; dz <= reach; dz++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const cx = centerCx + dx;
      const cz = centerCz + dz;
      if (!inWorld(cx, cz)) continue;
      const ring = Math.max(Math.abs(dx), Math.abs(dz));
      if (ring > policy.loadRadius) {
        // Cincin perluasan: hanya chunk yang jelas searah gerak.
        if (!moving) continue;
        if (dx * dirX + dz * dirZ <= 0) continue;
      }
      // Jarak diukur dari titik tengah chunk ke posisi prediksi (dalam satuan chunk).
      const midCx = (chunkOrigin(cx) + CHUNK_SIZE / 2) / CHUNK_SIZE;
      const midCz = (chunkOrigin(cz) + CHUNK_SIZE / 2) / CHUNK_SIZE;
      const ox = midCx - predCx;
      const oz = midCz - predCz;
      entries.push({
        key: chunkKey(cx, cz),
        cheb: cx === centerCx && cz === centerCz ? -1 : Math.max(Math.abs(ox), Math.abs(oz)),
        euclid: Math.hypot(ox, oz),
      });
    }
  }

  entries.sort((a, b) => a.cheb - b.cheb || a.euclid - b.euclid || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return entries.map((entry) => entry.key);
}

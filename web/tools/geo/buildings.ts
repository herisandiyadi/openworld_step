/**
 * Bangunan OSM -> AABB (sumbu-sejajar, sesuai engine). Polygon non-persegi dibungkus
 * AABB penuhnya; footprint yang terlalu kecil (< 4 m2) dibuang supaya tidak jadi noise.
 *
 * Warna dipilih dari FUNGSI bangunan (tag OSM), bukan hash id acak -- supaya peta terbaca:
 * sekolah, masjid, bank, mall, dan gedung kantor tampil beda. Tipe yang tidak diketahui
 * tetap dapat warna netral yang bervariasi supaya kota tidak tampak seragam.
 */
import type { Building } from '../../src/world/worldSpec';

/** Kategori fungsi bangunan; menentukan palet warna. */
export type BuildingKind =
  | 'worship'     // tempat ibadah (masjid, gereja, vihara)
  | 'civic'       // kantor pemerintah, polisi, pemadam, pos
  | 'education'   // sekolah, kampus, TK, perpustakaan
  | 'health'      // klinik, rumah sakit, apotek
  | 'retail'      // mall, toko, restoran, kafe, bank
  | 'office'      // gedung kantor / komersial
  | 'industrial'  // industri, gudang, gardu listrik
  | 'residential' // rumah, apartemen
  | 'default';    // tipe tidak diketahui

/**
 * Warna per kategori. Beberapa kategori punya >1 warna, dipilih deterministik per bangunan
 * supaya satu blok kota tidak seragam (atap genteng vs beton vs kaca).
 * Nilai sengaja desaturasi & gelap: engine memakai pencahayaan baked (GTA3-era), bukan PBR.
 */
const PALETTE: Record<BuildingKind, readonly string[]> = {
  worship:     ['#c9b8a0', '#bfae95', '#d2c1a8'],
  civic:       ['#bcc3cc', '#c6ccd4', '#b2bac4'],
  education:   ['#c8c0a8', '#d0c8b0', '#c0b8a0'],
  health:      ['#dfe3e6', '#d5dade', '#e8ebee'],
  retail:      ['#c99a8a', '#d2a894', '#bd8f80'],
  office:      ['#a8b6c4', '#9cabb9', '#b4c0cc'],
  industrial:  ['#a5a29b', '#b0ada6', '#9a9891'],
  residential: ['#c4b8ab', '#c9c2b6', '#bcb0a2'],
  default:     ['#b7bcc6', '#c9c2b6', '#a9b0ba', '#d2cabf', '#9fa7b2', '#c4b8ab'],
};

export const BUILDING_COLORS = PALETTE.default;
export const HEIGHT_PER_LEVEL = 3.2;
export const MIN_FOOTPRINT_M2 = 4;

/** FNV-1a: hash stabil (deterministik antar-bake) untuk memilih warna dalam kategori. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * Klasifikasi fungsi bangunan dari tag OSM.
 * Urutan cek penting: tag paling spesifik menang (amenity=place_of_worship sebelum building=yes).
 */
export function kindFor(tags: Record<string, string>): BuildingKind {
  const amenity = tags.amenity ?? '';
  const shop = tags.shop ?? '';
  const office = tags.office ?? '';
  const building = tags.building ?? tags['building:part'] ?? '';

  if (amenity === 'place_of_worship' || building === 'mosque' || building === 'church' || building === 'chapel' || building === 'synagogue' || building === 'temple' || building === 'shrine') return 'worship';
  if (amenity === 'school' || amenity === 'college' || amenity === 'university' || amenity === 'kindergarten' || amenity === 'library' || building === 'school' || building === 'college' || building === 'university' || building === 'kindergarten') return 'education';
  if (amenity === 'clinic' || amenity === 'hospital' || amenity === 'doctors' || amenity === 'pharmacy' || building === 'hospital') return 'health';
  if (amenity === 'bank' || amenity === 'restaurant' || amenity === 'cafe' || amenity === 'fast_food' || amenity === 'marketplace' || amenity === 'fuel' || shop !== '' || building === 'retail' || building === 'commercial' || building === 'supermarket' || building === 'kiosk') return 'retail';
  if (amenity === 'townhall' || amenity === 'police' || amenity === 'fire_station' || amenity === 'post_office' || amenity === 'courthouse' || amenity === 'embassy' || office === 'government' || office === 'diplomatic' || building === 'government' || building === 'government_office' || building === 'civic' || building === 'public') return 'civic';
  if (building === 'industrial' || building === 'warehouse' || building === 'hangar' || building === 'power_substation' || building === 'transformer_tower' || building === 'service' || building === 'transportation' || office === 'energy_supplier') return 'industrial';
  if (building === 'house' || building === 'apartments' || building === 'residential' || building === 'detached' || building === 'terrace' || building === 'dormitory') return 'residential';
  if (office !== '' || building === 'office') return 'office';
  return 'default';
}

/** Warna akhir: kategori + variasi deterministik berdasarkan id. */
export function colorFor(id: string, tags: Record<string, string> = {}): string {
  const pal = PALETTE[kindFor(tags)];
  return pal[hash(id) % pal.length] as string;
}

export function heightFor(tags: Record<string, string>, fallback: number): number {
  const h = Number.parseFloat(tags.height ?? '');
  if (Number.isFinite(h) && h > 0) return h;
  const levels = Number.parseFloat(tags['building:levels'] ?? '');
  if (Number.isFinite(levels) && levels > 0) return levels * HEIGHT_PER_LEVEL;
  return fallback;
}

export interface BuildingInput {
  id: string;
  tags: Record<string, string>;
  pts: [number, number][];
  ground: (x: number, z: number) => number;
}

export function footprintToBuilding(input: BuildingInput, fallbackHeight: number): Building | null {
  const { pts } = input;
  if (pts.length < 3) return null;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of pts) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  if ((maxX - minX) * (maxZ - minZ) < MIN_FOOTPRINT_M2) return null;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const samples = [
    input.ground(minX, minZ), input.ground(maxX, minZ),
    input.ground(minX, maxZ), input.ground(maxX, maxZ), input.ground(cx, cz),
  ];
  const round2 = (v: number) => Math.round(v * 100) / 100;
  const height = heightFor(input.tags, fallbackHeight);
  return {
    minX: round2(minX), maxX: round2(maxX), minZ: round2(minZ), maxZ: round2(maxZ),
    baseY: round2(Math.min(...samples) - 0.3),
    topY: round2(Math.max(...samples) + height),
    color: colorFor(input.id, input.tags),
  };
}

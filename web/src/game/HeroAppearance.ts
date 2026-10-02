import {
  BufferAttribute,
  BufferGeometry,
  Color,
  type InterleavedBufferAttribute,
  type Material,
  type Object3D,
  SkinnedMesh,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Appearance } from '../state/profile';
import type { AssetId } from '../app/assets';

/**
 * Palet dan penerapan penampilan ke GLB char_hero_m / char_hero_f (NEXT_FEATURES 9.3).
 * Warna disimpan sebagai id opsi, jadi palet di sini bisa diubah tanpa merusak profil lama.
 * Dipakai pemain lokal, pratinjau, dan nanti RemotePlayers / ped_citizen.
 */
export interface Option {
  label: string;
  /** Swatch untuk UI; untuk kategori gaya dipakai sebagai warna netral. */
  swatch: string;
}

const STYLE_SWATCH = '#8b93a4';

export const CATEGORIES = {
  gender: { label: 'Gender', options: [{ label: 'Laki-laki', swatch: STYLE_SWATCH }, { label: 'Perempuan', swatch: STYLE_SWATCH }] },
  hairColor: { label: 'Warna rambut', options: [{ label: 'Hitam', swatch: '#2b211c' }, { label: 'Cokelat', swatch: '#6b4423' }, { label: 'Pirang', swatch: '#c9a227' }] },
  expression: { label: 'Ekspresi wajah', options: [{ label: 'Senyum', swatch: STYLE_SWATCH }, { label: 'Datar', swatch: STYLE_SWATCH }, { label: 'Ceria', swatch: STYLE_SWATCH }] },
  shirtColor: { label: 'Warna baju', options: [{ label: 'Biru', swatch: '#2f6fdb' }, { label: 'Merah', swatch: '#c43b32' }, { label: 'Hijau', swatch: '#3b8f54' }] },
  shirtStyle: { label: 'Gaya baju', options: [{ label: 'Kaos', swatch: STYLE_SWATCH }, { label: 'Hoodie', swatch: STYLE_SWATCH }, { label: 'Kemeja', swatch: STYLE_SWATCH }] },
  pantsColor: { label: 'Warna celana', options: [{ label: 'Denim biru', swatch: '#34405a' }, { label: 'Hitam', swatch: '#2a2a2e' }, { label: 'Krem', swatch: '#c9b48c' }] },
  pantsStyle: { label: 'Gaya celana', options: [{ label: 'Jeans panjang', swatch: STYLE_SWATCH }, { label: 'Celana pendek', swatch: STYLE_SWATCH }, { label: 'Jogger', swatch: STYLE_SWATCH }] },
} as const satisfies Record<string, { label: string; options: readonly Option[] }>;

export type Category = keyof typeof CATEGORIES;
export const CATEGORY_IDS = Object.keys(CATEGORIES) as Category[];

export const heroAssetId = (appearance: Appearance): AssetId => (appearance.gender === 'f' ? 'char_hero_f' : 'char_hero_m');

/** Ringkasan untuk system prompt AI, mis. "hoodie merah dan jeans panjang denim biru". */
export const appearanceSummary = (a: Appearance): string =>
  `${CATEGORIES.shirtStyle.options[a.shirtStyle]?.label.toLowerCase()} ${CATEGORIES.shirtColor.options[a.shirtColor]?.label.toLowerCase()}` +
  ` dan ${CATEGORIES.pantsStyle.options[a.pantsStyle]?.label.toLowerCase()} ${CATEGORIES.pantsColor.options[a.pantsColor]?.label.toLowerCase()}`;

const SLOT_OF: Record<string, 'hairColor' | 'shirtColor' | 'pantsColor'> = { hair: 'hairColor', shirt: 'shirtColor', pants: 'pantsColor' };
const VARIANT = /^(hair|shirt_\d|pants_\d|face_\d)$/;
const MERGED = 'hero_merged';

/** Atribut terkuantisasi (meshopt) jadi Float32 supaya bisa digabung. */
function toFloat(attribute: BufferAttribute | InterleavedBufferAttribute): BufferAttribute {
  const { count, itemSize } = attribute;
  const out = new Float32Array(count * itemSize);
  for (let i = 0; i < count; i++) for (let k = 0; k < itemSize; k++) out[i * itemSize + k] = attribute.getComponent(i, k);
  return new BufferAttribute(out, itemSize);
}

/**
 * Menggabung badan + node varian terpilih jadi satu SkinnedMesh dan memanggang warna slot ke vertex
 * colour. Hasilnya 1 draw call, sama dengan char_hero lama. Node asli disembunyikan.
 * Aman dipanggil ulang saat pilihan berubah (pratinjau): mesh gabungan lama dibuang.
 * Syarat: GLB dikuantisasi dengan satu volume (`quantizationVolume: 'scene'` di build.ts), jadi semua
 * node berbagi bind matrix yang sama.
 */
export function applyAppearance(root: Object3D, appearance: Appearance): void {
  const wanted = new Set(['hair', `shirt_${appearance.shirtStyle}`, `pants_${appearance.pantsStyle}`, `face_${appearance.expression}`]);
  const parts: SkinnedMesh[] = [];
  let body: SkinnedMesh | undefined;
  root.traverse((object) => {
    const mesh = object as SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    if (mesh.name === MERGED) return;
    if (!VARIANT.test(mesh.name)) body = mesh;
    else if (wanted.has(mesh.name)) parts.push(mesh);
  });
  if (!body) return;

  const old = root.getObjectByName(MERGED) as SkinnedMesh | undefined;
  if (old) {
    old.removeFromParent();
    old.geometry.dispose();
  }

  const geometries = [body, ...parts].map((mesh) => {
    const geometry = new BufferGeometry();
    for (const name of ['position', 'normal', 'color', 'skinIndex', 'skinWeight']) {
      const attribute = mesh.geometry.getAttribute(name);
      if (attribute) geometry.setAttribute(name, toFloat(attribute));
    }
    geometry.setIndex(mesh.geometry.index ? Array.from(mesh.geometry.index.array) : null);
    const category = SLOT_OF[(mesh.material as Material).name];
    const swatch = category ? CATEGORIES[category].options[appearance[category]]?.swatch : undefined;
    const color = geometry.getAttribute('color');
    if (swatch && color) {
      const tint = new Color(swatch);
      for (let i = 0; i < color.count; i++) color.setXYZ(i, color.getX(i) * tint.r, color.getY(i) * tint.g, color.getZ(i) * tint.b);
    }
    return geometry;
  });
  const geometry = mergeGeometries(geometries);
  for (const part of geometries) part.dispose();
  if (!geometry) return;

  const merged = new SkinnedMesh(geometry, body.material);
  merged.name = MERGED;
  merged.castShadow = true;
  merged.frustumCulled = false;
  merged.bind(body.skeleton, body.bindMatrix);
  body.parent?.add(merged);
  root.traverse((object) => {
    if ((object as SkinnedMesh).isSkinnedMesh && object !== merged) object.visible = false;
  });
}

// ponytail: kulit, sepatu, dan aksesori masih tetap. Tambah slot material baru di humanoid.ts
// kalau nanti perlu warna kulit atau barang kosmetik dari toko.

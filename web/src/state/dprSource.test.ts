import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { QUALITY_PRESETS } from './gameStore';
import { QUALITY_TIERS } from './qualityTiers';

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

/**
 * Dua nilai yang gampang tertukar dan keduanya memengaruhi performa HP:
 *
 * 1. DPR canvas. Sumber yang BENAR adalah QUALITY_PRESETS (gameStore), dibaca App.tsx.
 *    QUALITY_TIERS[tier].maxDpr hanya catatan historis dan tidak pernah dibaca renderer —
 *    nilainya bahkan berbeda (high: 1.5 vs 2). Mengubah yang salah = tidak ada efek.
 * 2. MSAA. Saat ini TIDAK diterapkan (canvas antialias:false, tidak ada render target ber-samples).
 *    Test ini gagal kalau seseorang menyalakannya lewat canvas tanpa mempertimbangkan fill rate.
 */
describe('sumber DPR dan status MSAA', () => {
  const app = read('../app/App.tsx');

  it('App.tsx mengambil DPR dari QUALITY_PRESETS, bukan QUALITY_TIERS', () => {
    expect(app).toContain('QUALITY_PRESETS[quality]');
    expect(app).toContain('preset.maxDpr');
  });

  it('QUALITY_PRESETS memberi DPR aman untuk HP kelas menengah (<= 1.5)', () => {
    // Di atas 1.5 pada layar 1080p+ membuat fill rate jadi bottleneck di Mali-G52.
    for (const preset of Object.values(QUALITY_PRESETS)) {
      expect(preset.maxDpr).toBeLessThanOrEqual(1.5);
    }
  });

  it('QUALITY_PRESETS dan QUALITY_TIERS TIDAK sepakat soal high.maxDpr — kalau ini berubah, perbarui komentarnya', () => {
    // Dokumentasi hidup: nilai yang berbeda inilah jebakannya. Kalau seseorang menyamakannya,
    // hapus test ini dan komentar "catatan historis" di qualityTiers.ts.
    expect(QUALITY_TIERS.high.maxDpr).not.toBe(QUALITY_PRESETS.high.maxDpr);
    expect(QUALITY_TIERS.high.maxDpr).toBe(2);
    expect(QUALITY_PRESETS.high.maxDpr).toBe(1.5);
  });

  it('MSAA masih belum diterapkan ke canvas (antialias:false di App.tsx)', () => {
    // Kalau baris ini hilang, MSAA mungkin sudah dinyalakan: periksa biaya fill rate dulu
    // (lihat komentar di render/antialias.ts) sebelum memperbarui test ini.
    expect(app).toContain('antialias: false');
  });
});

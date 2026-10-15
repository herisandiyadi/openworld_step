import { describe, expect, it } from 'vitest';
import { APPEARANCE_FIELDS, DEFAULT_APPEARANCE, appearanceKey, type Appearance } from './profile';

/**
 * appearanceKey dipakai sebagai guard "perlu merge ulang atau tidak" di Hero.tsx dan RemotePlayers.tsx.
 * Kalau dua penampilan yang sama menghasilkan key berbeda (atau sebaliknya), mesh akan dibangun ulang
 * sia-sia tiap render (GC churn) atau tidak diperbarui saat pilihan berubah. Keduanya bug nyata.
 */
describe('appearanceKey', () => {
  it('stabil: dua objek bernilai sama menghasilkan key sama', () => {
    const a: Appearance = { ...DEFAULT_APPEARANCE };
    const b: Appearance = { ...DEFAULT_APPEARANCE };
    expect(a).not.toBe(b); // referensi berbeda — inilah alasan key string, bukan bandingkan objek
    expect(appearanceKey(a)).toBe(appearanceKey(b));
  });

  it('berubah saat SETIAP field berubah — tidak ada field yang terlewat', () => {
    const base = appearanceKey(DEFAULT_APPEARANCE);
    for (const field of APPEARANCE_FIELDS) {
      const changed: Appearance = { ...DEFAULT_APPEARANCE, [field]: DEFAULT_APPEARANCE[field] + 1 };
      expect(appearanceKey(changed), `field '${field}' tidak memengaruhi key`).not.toBe(base);
    }
  });

  it('gender ikut masuk key — pria dan wanita memakai GLB berbeda', () => {
    const male: Appearance = { ...DEFAULT_APPEARANCE, gender: 'm' };
    const female: Appearance = { ...DEFAULT_APPEARANCE, gender: 'f' };
    expect(appearanceKey(male)).not.toBe(appearanceKey(female));
  });
});

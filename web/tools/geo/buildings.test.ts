import { describe, expect, it } from 'vitest';
import { colorFor, kindFor } from './buildings';

describe('kindFor', () => {
  it('mengenali tempat ibadah dari amenity, sebelum building=yes', () => {
    expect(kindFor({ amenity: 'place_of_worship', building: 'yes' })).toBe('worship');
    expect(kindFor({ building: 'mosque' })).toBe('worship');
    expect(kindFor({ building: 'church' })).toBe('worship');
  });

  it('mengenali sekolah dan kampus', () => {
    expect(kindFor({ amenity: 'school', building: 'yes' })).toBe('education');
    expect(kindFor({ amenity: 'kindergarten' })).toBe('education');
    expect(kindFor({ building: 'college' })).toBe('education');
  });

  it('mengenali fasilitas kesehatan', () => {
    expect(kindFor({ amenity: 'clinic', building: 'yes' })).toBe('health');
    expect(kindFor({ amenity: 'pharmacy' })).toBe('health');
  });

  it('mengenali retail dari shop/amenity kuliner/bank', () => {
    expect(kindFor({ shop: 'mall', building: 'yes' })).toBe('retail');
    expect(kindFor({ amenity: 'bank', building: 'yes' })).toBe('retail');
    expect(kindFor({ amenity: 'restaurant' })).toBe('retail');
    expect(kindFor({ building: 'commercial' })).toBe('retail');
  });

  it('mengenali kantor pemerintah', () => {
    expect(kindFor({ office: 'government', building: 'yes' })).toBe('civic');
    expect(kindFor({ amenity: 'police', building: 'yes' })).toBe('civic');
    expect(kindFor({ building: 'government_office' })).toBe('civic');
  });

  it('mengenali industri dan gardu listrik', () => {
    expect(kindFor({ building: 'industrial' })).toBe('industrial');
    expect(kindFor({ building: 'power_substation' })).toBe('industrial');
    expect(kindFor({ office: 'energy_supplier', building: 'yes' })).toBe('industrial');
  });

  it('mengenali hunian', () => {
    expect(kindFor({ building: 'house' })).toBe('residential');
    expect(kindFor({ building: 'apartments' })).toBe('residential');
  });

  it('fallback ke default untuk building=yes tanpa tag fungsi', () => {
    expect(kindFor({ building: 'yes' })).toBe('default');
    expect(kindFor({})).toBe('default');
  });

  it('tag spesifik menang atas building=yes (bukan sekadar cek keberadaan)', () => {
    // Kasus nyata Blok M: 4.475 bangunan building=yes, 25 di antaranya place_of_worship.
    expect(kindFor({ building: 'yes', amenity: 'place_of_worship', religion: 'muslim' })).toBe('worship');
    expect(kindFor({ building: 'yes', shop: 'convenience' })).toBe('retail');
  });
});

describe('colorFor', () => {
  it('memberi warna berbeda untuk fungsi berbeda', () => {
    const worship = colorFor('w1', { amenity: 'place_of_worship' });
    const health = colorFor('h1', { amenity: 'clinic' });
    expect(worship).not.toBe(health);
  });

  it('deterministik: id + tags sama -> warna sama', () => {
    const tags = { amenity: 'school', building: 'yes' };
    expect(colorFor('n123', tags)).toBe(colorFor('n123', tags));
  });

  it('selalu mengembalikan hex 6 digit', () => {
    const cases: Record<string, string>[] = [{}, { amenity: 'clinic' }, { building: 'mosque' }, { shop: 'mall' }];
    for (const tags of cases) {
      expect(colorFor('x', tags)).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('tanpa tags tetap berjalan (kompatibel pemanggil lama)', () => {
    expect(colorFor('someid')).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DISTRICT_NAMES } from '../world/worldSpec';
import { generateResidents, RESIDENT_COUNT, residentActivity, residentSystemPrompt } from './residents';

const residents = generateResidents();
const at = (hour: number) => hour / 24;

describe('pool warga', () => {
  it('deterministik dan sama dengan public/ambient/residents.json', () => {
    expect(JSON.stringify(generateResidents())).toBe(JSON.stringify(residents));
    expect(JSON.stringify(generateResidents(1))).not.toBe(JSON.stringify(residents));
    const baked: unknown = JSON.parse(readFileSync(new URL('../../public/ambient/residents.json', import.meta.url), 'utf8'));
    expect(baked).toEqual(residents);
  });

  it('isi persona valid', () => {
    expect(residents).toHaveLength(RESIDENT_COUNT);
    expect(new Set(residents.map((r) => r.id)).size).toBe(RESIDENT_COUNT);
    expect(new Set(residents.map((r) => r.name)).size).toBe(RESIDENT_COUNT);
    for (const r of residents) {
      expect(r.name).toMatch(/^(Pak|Bu|Mas|Mbak) [A-Z][a-z]+$/);
      expect(r.name.startsWith('Pak') || r.name.startsWith('Mas')).toBe(r.gender === 'm');
      expect(r.age).toBeGreaterThanOrEqual(18);
      expect(r.age).toBeLessThanOrEqual(75);
      for (const field of [r.job, r.hobby, r.mood]) expect(field.length).toBeGreaterThan(2);
      expect(['downtown', 'residential', 'industrial']).toContain(r.office.district);
      expect(['downtown', 'residential']).toContain(r.home.district);
    }
    expect(residents.some((r) => r.job === 'operator pabrik' || r.office.district === 'industrial')).toBe(true);
  });

  it('aktivitas mengikuti jam', () => {
    const worker = residents.find((r) => r.job !== 'pensiunan')!;
    expect(residentActivity(worker, at(2))).toBe('beristirahat di rumah');
    expect(residentActivity(worker, at(7))).toBe('berangkat kerja');
    expect(residentActivity(worker, at(12.5))).toBe('makan siang');
    expect(residentActivity(worker, at(17.5))).toBe('pulang kerja');
    expect(residentActivity(worker, at(20))).toContain(worker.hobby);
  });

  it('system prompt memuat persona dan nama pemain', () => {
    const r = residents[0]!;
    const prompt = residentSystemPrompt(r, at(12.5), 'Andi', 'm', 'kaos hijau dan jeans biru');
    for (const part of [r.name, `${r.age} tahun`, r.job, r.hobby, r.mood, 'makan siang', '"Andi"', 'Mas Andi', 'kaos hijau', DISTRICT_NAMES[r.home.district], DISTRICT_NAMES[r.office.district], 'bahasa Indonesia']) {
      expect(prompt).toContain(part);
    }
    expect(residentSystemPrompt(r, 0.5, 'Sari', 'f')).toContain('Mbak Sari');
    expect(residentSystemPrompt(r, 0.5)).not.toContain('Pemain yang');
  });
});

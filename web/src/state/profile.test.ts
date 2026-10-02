import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(({ key }: { key: string }) => Promise.resolve({ value: store.get(key) ?? null })),
    set: vi.fn(({ key, value }: { key: string; value: string }) => {
      store.set(key, value);
      return Promise.resolve();
    }),
  },
}));

const { DEFAULT_APPEARANCE, isValidAppearance, normalizeUsername, parseAppearance, readProfile, validateUsername, writeProfile } =
  await import('./profile');

describe('username rules', () => {
  it('accepts normal names, including non-Latin letters', () => {
    expect(validateUsername('Andi')).toBeNull();
    expect(validateUsername('  Siti   Nur ')).toBeNull();
    expect(validateUsername('budi_99')).toBeNull();
    expect(validateUsername('Ñoño')).toBeNull();
  });

  it('rejects too short, too long, and unsafe characters', () => {
    expect(validateUsername('a')).not.toBeNull();
    expect(validateUsername('x'.repeat(21))).not.toBeNull();
    expect(validateUsername('_lead')).not.toBeNull();
    expect(validateUsername('ab"; ignore')).not.toBeNull();
    expect(validateUsername('<b>hi</b>')).not.toBeNull();
  });

  it('collapses whitespace', () => {
    expect(normalizeUsername('  Siti   Nur ')).toBe('Siti Nur');
  });
});

describe('profile storage (web fallback)', () => {
  beforeEach(() => store.clear());

  it('is empty on first launch, then persists and keeps createdAt on rename', async () => {
    expect(await readProfile()).toBeNull();
    const first = await writeProfile(' Andi ', null);
    expect(first.username).toBe('Andi');
    expect(await readProfile()).toEqual(first);
    const renamed = await writeProfile('Andi Pratama', first);
    expect(renamed.createdAt).toBe(first.createdAt);
    expect((await readProfile())?.username).toBe('Andi Pratama');
  });

  it('refuses invalid names', async () => {
    await expect(writeProfile('x', null)).rejects.toThrow();
  });
});
describe('appearance', () => {
  const look = { gender: 'f', hairColor: 2, expression: 1, shirtColor: 1, shirtStyle: 0, pantsColor: 2, pantsStyle: 2 } as const;

  it('default = hero lama (laki-laki, hoodie biru, jeans)', () => {
    expect(DEFAULT_APPEARANCE).toEqual({ gender: 'm', hairColor: 0, expression: 0, shirtColor: 0, shirtStyle: 1, pantsColor: 0, pantsStyle: 0 });
    expect(isValidAppearance(DEFAULT_APPEARANCE)).toBe(true);
  });

  it('menolak nilai di luar rentang', () => {
    expect(isValidAppearance(look)).toBe(true);
    expect(isValidAppearance({ ...look, gender: 'x' })).toBe(false);
    expect(isValidAppearance({ ...look, hairColor: 3 })).toBe(false);
    expect(isValidAppearance({ ...look, pantsStyle: -1 })).toBe(false);
    expect(isValidAppearance({ ...look, expression: 1.5 })).toBe(false);
    expect(isValidAppearance({ ...look, shirtColor: '1' })).toBe(false);
    expect(isValidAppearance(null)).toBe(false);
    expect(parseAppearance({ ...look, hairColor: 9 })).toEqual({ ...look, hairColor: 0 });
  });

  beforeEach(() => store.clear());

  it('profil v1 (username saja) terbaca dengan penampilan default', async () => {
    store.set('player_profile_v1', JSON.stringify({ username: 'Andi', createdAt: 1, updatedAt: 1 }));
    expect((await readProfile())?.appearance).toEqual(DEFAULT_APPEARANCE);
    // Plugin native mengirim appearance sebagai string JSON (atau null untuk baris v1).
    store.set('player_profile_v1', JSON.stringify({ username: 'Andi', appearance: JSON.stringify(look) }));
    expect((await readProfile())?.appearance).toEqual(look);
  });

  it('menyimpan penampilan dan mempertahankannya saat ganti nama', async () => {
    const first = await writeProfile('Sari', null, look);
    expect(first.appearance).toEqual(look);
    expect((await writeProfile('Sari Dewi', first)).appearance).toEqual(look);
    await expect(writeProfile('Sari', null, { ...look, hairColor: 5 })).rejects.toThrow();
  });
});

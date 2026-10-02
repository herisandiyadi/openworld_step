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

const { normalizeUsername, readProfile, validateUsername, writeProfile } = await import('./profile');

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
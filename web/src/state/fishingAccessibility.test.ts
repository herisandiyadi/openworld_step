import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = new Map<string, string>();
const get = vi.fn(async ({ key }: { key: string }) => ({ value: storage.get(key) ?? null }));
const set = vi.fn(async ({ key, value }: { key: string; value: string }) => { storage.set(key, value); });
vi.mock('@capacitor/preferences', () => ({ Preferences: { get, set } }));

const { DEFAULT_FISHING_ACCESSIBILITY, useFishingAccessibility } = await import('./fishingAccessibility');

describe('fishing accessibility preference', () => {
  beforeEach(() => {
    storage.clear();
    get.mockClear();
    set.mockClear();
    useFishingAccessibility.setState({ settings: DEFAULT_FISHING_ACCESSIBILITY, loaded: false });
  });

  it('defaults easy mode off and persists changes', () => {
    useFishingAccessibility.getState().update({ easyMode: true });

    expect(useFishingAccessibility.getState().settings.easyMode).toBe(true);
    expect(storage.get('fishing_accessibility_v1')).toBe(JSON.stringify({ easyMode: true }));
  });

  it('loads the persisted easy-mode value', async () => {
    storage.set('fishing_accessibility_v1', JSON.stringify({ easyMode: true }));

    await useFishingAccessibility.getState().load();

    expect(useFishingAccessibility.getState()).toMatchObject({ settings: { easyMode: true }, loaded: true });
  });

  it('falls back safely for corrupt storage', async () => {
    storage.set('fishing_accessibility_v1', '{bad');

    await useFishingAccessibility.getState().load();

    expect(useFishingAccessibility.getState()).toMatchObject({ settings: DEFAULT_FISHING_ACCESSIBILITY, loaded: true });
  });
});

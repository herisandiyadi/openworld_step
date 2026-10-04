import { beforeEach, describe, expect, it, vi } from 'vitest';

// Penyimpanan Preferences palsu di memori (plugin native tidak ada di lingkungan test).
const storage = new Map<string, string>();
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(({ key }: { key: string }) => Promise.resolve({ value: storage.get(key) ?? null })),
    set: vi.fn(({ key, value }: { key: string; value: string }) => {
      storage.set(key, value);
      return Promise.resolve();
    }),
    remove: vi.fn(),
  },
}));

const { DEFAULT_NET_SETTINGS, isServerConfigured, normalizeNetSettings, normalizeStored, useNetSettings, validateNetSettings } =
  await import('./netSettings');

beforeEach(() => {
  storage.clear();
  useNetSettings.setState({ settings: DEFAULT_NET_SETTINGS, loaded: false });
});

describe('net settings', () => {
  it('default kosong berarti belum diatur', () => {
    expect(DEFAULT_NET_SETTINGS.serverUrl).toBe('');
    expect(isServerConfigured(DEFAULT_NET_SETTINGS)).toBe(false);
    expect(validateNetSettings(DEFAULT_NET_SETTINGS)).toBeNull();
  });

  it('hanya menerima ws:// dan wss://', () => {
    expect(validateNetSettings({ serverUrl: 'wss://game.example.com:8443' })).toBeNull();
    expect(validateNetSettings({ serverUrl: 'ws://192.168.1.10:8080' })).toBeNull();
    expect(validateNetSettings({ serverUrl: 'https://game.example.com' })).toContain('ws://');
    expect(validateNetSettings({ serverUrl: 'http://game.example.com' })).toContain('ws://');
    expect(validateNetSettings({ serverUrl: 'bukan url' })).toBe('Alamat server tidak valid.');
    expect(validateNetSettings({ serverUrl: 'wss://' })).toBe('Alamat server tidak valid.');
  });

  it('merapikan spasi dan garis miring di akhir', () => {
    expect(normalizeNetSettings({ serverUrl: '  wss://host:9000/// ' })).toEqual({ serverUrl: 'wss://host:9000' });
  });

  it('nilai tersimpan yang rusak kembali ke default', () => {
    expect(normalizeStored(null)).toEqual(DEFAULT_NET_SETTINGS);
    expect(normalizeStored('wss://host')).toEqual(DEFAULT_NET_SETTINGS);
    expect(normalizeStored({ serverUrl: 42 })).toEqual(DEFAULT_NET_SETTINGS);
    expect(normalizeStored({ serverUrl: 'ftp://host' })).toEqual(DEFAULT_NET_SETTINGS);
    expect(normalizeStored({ serverUrl: 'wss://host:1234/' })).toEqual({ serverUrl: 'wss://host:1234' });
  });

  it('save lalu load memakai kunci berversi net_settings_v1', async () => {
    await useNetSettings.getState().save({ serverUrl: ' wss://host:1234/ ' });
    expect(storage.get('net_settings_v1')).toBe(JSON.stringify({ serverUrl: 'wss://host:1234' }));

    useNetSettings.setState({ settings: DEFAULT_NET_SETTINGS, loaded: false });
    await useNetSettings.getState().load();
    expect(useNetSettings.getState()).toMatchObject({ settings: { serverUrl: 'wss://host:1234' }, loaded: true });
  });

  it('save menolak URL tidak valid tanpa menyimpan apa pun', async () => {
    await expect(useNetSettings.getState().save({ serverUrl: 'https://host' })).rejects.toThrow('ws://');
    expect(storage.has('net_settings_v1')).toBe(false);
    expect(useNetSettings.getState().settings).toEqual(DEFAULT_NET_SETTINGS);
  });

  it('load dengan JSON rusak memakai default', async () => {
    storage.set('net_settings_v1', '{rusak');
    await useNetSettings.getState().load();
    expect(useNetSettings.getState()).toMatchObject({ settings: DEFAULT_NET_SETTINGS, loaded: true });
  });
});

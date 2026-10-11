import { describe, expect, it } from 'vitest';
import { createDefaultContentUpdateDependencies } from './contentUpdatesRuntime';
import {
  CapacitorFilesystemContentStorage,
  CapacitorNetworkConnectivity,
  type FilesystemLike,
} from '../content/capacitorAdapters';
import { LocalStorageContentStorage } from '../content/updates';

const filesystem: FilesystemLike = {
  readFile: async () => { throw new Error('File does not exist'); },
  writeFile: async () => ({}),
  deleteFile: async () => undefined,
  mkdir: async () => undefined,
  rmdir: async () => undefined,
  stat: async () => { throw new Error('Entry does not exist'); },
  rename: async () => undefined,
};

class MemoryWebStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe('createDefaultContentUpdateDependencies platform selection', () => {
  it('selects Capacitor Filesystem and Network adapters on native platforms', async () => {
    const dependencies = createDefaultContentUpdateDependencies({
      isNativePlatform: () => true,
      filesystem,
      networkPlugin: { getStatus: async () => ({ connected: true, connectionType: 'cellular' }) },
      browserStorage: new MemoryWebStorage(),
      browserConnectionType: () => 'wifi',
    });

    expect(dependencies.storage).toBeInstanceOf(CapacitorFilesystemContentStorage);
    expect(dependencies.connectivity).toBeInstanceOf(CapacitorNetworkConnectivity);
    await expect(dependencies.connectivity.getConnectionType()).resolves.toBe('cellular');
  });

  it('selects localStorage and browser connectivity on the web', async () => {
    const dependencies = createDefaultContentUpdateDependencies({
      isNativePlatform: () => false,
      filesystem,
      networkPlugin: { getStatus: async () => ({ connected: true, connectionType: 'cellular' }) },
      browserStorage: new MemoryWebStorage(),
      browserConnectionType: () => 'wifi',
    });

    expect(dependencies.storage).toBeInstanceOf(LocalStorageContentStorage);
    expect(dependencies.connectivity).not.toBeInstanceOf(CapacitorNetworkConnectivity);
    await expect(dependencies.connectivity.getConnectionType()).resolves.toBe('wifi');
  });
});

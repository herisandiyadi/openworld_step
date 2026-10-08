/**
 * Tests for the Capacitor-backed content adapters (U5 native support):
 * - CapacitorFilesystemContentStorage: ContentStorage on top of @capacitor/filesystem
 * - CapacitorNetworkConnectivity: ContentConnectivity on top of @capacitor/network
 * Both are exercised through injected plugin-like interfaces, never the real bridge.
 */

import { describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  bytesToBase64,
  CapacitorFilesystemContentStorage,
  CapacitorNetworkConnectivity,
  type FilesystemLike,
} from './capacitorAdapters';

/** Minimal in-memory Filesystem plugin recording every call, like @capacitor/filesystem. */
class FakeFilesystem implements FilesystemLike {
  readonly files = new Map<string, string>();
  readonly calls: { method: string; path: string; options?: Record<string, unknown> }[] = [];

  private key(path: string): string { return `${this.directory}:${path}`; }
  constructor(private readonly directory = 'DATA') {}

  async readFile(options: { path: string; directory?: string }): Promise<{ data: string }> {
    this.calls.push({ method: 'readFile', path: options.path, options });
    const data = this.files.get(this.key(options.path));
    if (data === undefined) throw new Error('File does not exist');
    return { data };
  }

  async writeFile(options: { path: string; data: string; directory?: string; recursive?: boolean }): Promise<void> {
    this.calls.push({ method: 'writeFile', path: options.path, options });
    this.files.set(this.key(options.path), options.data);
  }

  async deleteFile(options: { path: string; directory?: string }): Promise<void> {
    this.calls.push({ method: 'deleteFile', path: options.path, options });
    if (!this.files.has(this.key(options.path))) throw new Error('File does not exist');
    this.files.delete(this.key(options.path));
  }

  async mkdir(): Promise<void> { /* implicit in the fake; parents always exist */ }

  async rmdir(options: { path: string; directory?: string; recursive?: boolean }): Promise<void> {
    this.calls.push({ method: 'rmdir', path: options.path, options });
    const prefix = this.key(options.path);
    const keys = [...this.files.keys()].filter((key) => key.startsWith(`${prefix}/`));
    if (keys.length === 0) throw new Error('Directory does not exist');
    for (const key of keys) this.files.delete(key);
  }

  async stat(options: { path: string; directory?: string }): Promise<{ type: 'file' | 'directory' }> {
    this.calls.push({ method: 'stat', path: options.path, options });
    const key = this.key(options.path);
    if (this.files.has(key)) return { type: 'file' };
    if ([...this.files.keys()].some((candidate) => candidate.startsWith(`${key}/`))) return { type: 'directory' };
    throw new Error('File does not exist');
  }

  async rename(options: { from: string; to: string; directory?: string }): Promise<void> {
    this.calls.push({ method: 'rename', path: options.from, options });
    const fromKey = this.key(options.from);
    const toKey = this.key(options.to);
    const data = this.files.get(fromKey);
    if (data === undefined) throw new Error('File does not exist');
    if (this.files.has(toKey)) throw new Error('Destination already exists');
    this.files.delete(fromKey);
    this.files.set(toKey, data);
  }

  renameCalls(): { from: string; to: string }[] {
    return this.calls.filter((c) => c.method === 'rename').map((c) => c.options as { from: string; to: string });
  }

  wrotePaths(): string[] { return this.calls.filter((c) => c.method === 'writeFile').map((c) => c.path); }
}

describe('CapacitorFilesystemContentStorage.writeAtomic', () => {
  it('publishes the pointer via a temp file rename, leaving no temp file behind', async () => {
    const fs = new FakeFilesystem();
    const storage = new CapacitorFilesystemContentStorage(fs);
    const pointer = new TextEncoder().encode('{"root":"pack"}');

    await storage.writeAtomic('__content/active.json', pointer);

    expect(fs.renameCalls()).toEqual([{
      from: '__content/active.json.tmp',
      to: '__content/active.json',
      directory: 'DATA',
    }]);
    expect(fs.files.has('DATA:__content/active.json.tmp')).toBe(false);
    await expect(storage.read('__content/active.json')).resolves.toEqual(pointer);
  });

  it('leaves the previous pointer untouched when the temp write fails mid-write', async () => {
    const fs = new FakeFilesystem();
    const storage = new CapacitorFilesystemContentStorage(fs);
    const original = new TextEncoder().encode('{"root":"old"}');
    await storage.writeAtomic('__content/active.json', original);
    const previous = fs.writeFile.bind(fs);
    fs.writeFile = async (options: { path: string; data: string; directory?: string; recursive?: boolean }) => {
      if (options.path === '__content/active.json.tmp') throw new Error('disk full');
      return previous(options);
    };

    await expect(storage.writeAtomic('__content/active.json', new TextEncoder().encode('{"root":"new"}')))
      .rejects.toThrow('disk full');

    await expect(storage.read('__content/active.json')).resolves.toEqual(original);
  });

  it('replaces an existing pointer after the full temp file has been written', async () => {
    const fs = new FakeFilesystem();
    const storage = new CapacitorFilesystemContentStorage(fs);
    await storage.writeAtomic('__content/active.json', new TextEncoder().encode('old'));

    await storage.writeAtomic('__content/active.json', new TextEncoder().encode('new'));

    expect(new TextDecoder().decode(await storage.read('__content/active.json') ?? undefined)).toBe('new');
    expect(fs.files.has('DATA:__content/active.json.tmp')).toBe(false);
    expect(fs.calls.some((call) => call.method === 'deleteFile' && call.path === '__content/active.json')).toBe(true);
  });
});

describe('bytesToBase64 / base64ToBytes', () => {
  it('round-trips bytes including zero bytes and long payloads', () => {
    const bytes = new Uint8Array(100_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7 + 3) % 256;
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it('encodes the same value as btoa for ASCII input', () => {
    const bytes = new TextEncoder().encode('hello world');
    expect(bytesToBase64(bytes)).toBe(btoa('hello world'));
  });
});

describe('CapacitorFilesystemContentStorage', () => {
  it('round-trips binary content through the injected Filesystem plugin as base64', async () => {
    const fs = new FakeFilesystem();
    const storage = new CapacitorFilesystemContentStorage(fs);
    const payload = new Uint8Array([0, 1, 2, 250, 251, 255]);

    await storage.write('__content/packs/main-1.1.0/a.json', payload);

    expect(fs.wrotePaths()).toEqual(['__content/packs/main-1.1.0/a.json']);
    const written = fs.files.get('DATA:__content/packs/main-1.1.0/a.json');
    expect(written).toBe(bytesToBase64(payload));
    await expect(storage.read('__content/packs/main-1.1.0/a.json')).resolves.toEqual(payload);
  });

  it('returns null instead of throwing when a file is missing', async () => {
    const fs = new FakeFilesystem();
    const storage = new CapacitorFilesystemContentStorage(fs);
    await expect(storage.read('__content/active.json')).resolves.toBeNull();
  });

  it('writes with recursive parents and the configured directory', async () => {
    const fs = new FakeFilesystem('DATA');
    const storage = new CapacitorFilesystemContentStorage(fs);
    await storage.write('nested/dir/file.bin', new Uint8Array([1]));
    const options = fs.calls.find((c) => c.method === 'writeFile')?.options;
    expect(options?.recursive).toBe(true);
    expect(options?.directory).toBe('DATA');
  });

  it('remove deletes a pointer file via deleteFile', async () => {
    const fs = new FakeFilesystem();
    const storage = new CapacitorFilesystemContentStorage(fs);
    await storage.write('__content/active.json', new TextEncoder().encode('{}'));

    await storage.remove('__content/active.json');

    expect(fs.files.has('DATA:__content/active.json')).toBe(false);
    expect(fs.calls.some((c) => c.method === 'deleteFile' && c.path === '__content/active.json')).toBe(true);
  });

  it('remove deletes a staged pack directory recursively via rmdir', async () => {
    const fs = new FakeFilesystem();
    const storage = new CapacitorFilesystemContentStorage(fs);
    await storage.write('__content/packs/main-1.1.0/a.json', new Uint8Array([1]));
    await storage.write('__content/packs/main-1.1.0/sub/b.json', new Uint8Array([2]));

    await storage.remove('__content/packs/main-1.1.0');

    expect([...fs.files.keys()].filter((key) => key.includes('packs/'))).toEqual([]);
    const rmdir = fs.calls.find((c) => c.method === 'rmdir' && c.path === '__content/packs/main-1.1.0');
    expect(rmdir?.options?.recursive).toBe(true);
  });

  it('remove tolerates a path that does not exist', async () => {
    const storage = new CapacitorFilesystemContentStorage(new FakeFilesystem());
    await expect(storage.remove('__content/packs/never-staged')).resolves.toBeUndefined();
  });
});

describe('CapacitorNetworkConnectivity', () => {
  it('maps connected wifi status to wifi', async () => {
    const connectivity = new CapacitorNetworkConnectivity({
      getStatus: async () => ({ connected: true, connectionType: 'wifi' }),
    });
    await expect(connectivity.getConnectionType()).resolves.toBe('wifi');
  });

  it('maps connected cellular status to cellular', async () => {
    const connectivity = new CapacitorNetworkConnectivity({
      getStatus: async () => ({ connected: true, connectionType: 'cellular' }),
    });
    await expect(connectivity.getConnectionType()).resolves.toBe('cellular');
  });

  it('maps unknown connection type through unchanged', async () => {
    const connectivity = new CapacitorNetworkConnectivity({
      getStatus: async () => ({ connected: true, connectionType: 'unknown' }),
    });
    await expect(connectivity.getConnectionType()).resolves.toBe('unknown');
  });

  it('reports none when the device is disconnected regardless of type', async () => {
    const connectivity = new CapacitorNetworkConnectivity({
      getStatus: async () => ({ connected: false, connectionType: 'none' }),
    });
    await expect(connectivity.getConnectionType()).resolves.toBe('none');
  });
});

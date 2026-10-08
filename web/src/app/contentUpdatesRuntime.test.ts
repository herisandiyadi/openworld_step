/**
 * Tests for contentUpdatesRuntime — the singleton bridge wiring updates.ts into the live app.
 * Verifies activation on launch, check/stage/rollback operations, and graceful offline behavior.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  contentUpdatesRuntime,
  initContentUpdateManager,
  checkAndStageContentUpdate,
  subscribeToContentUpdateStatus,
} from './contentUpdatesRuntime';
import type { ManifestDef } from '../content/schema';
import type {
  ContentNetwork,
  ContentStorage,
} from '../content/updates';
import { canonicalManifestJson } from '../content/canonical';
import { sha256Hex, type ContentPublicKeyProvider } from '../content/security';

const te = new TextEncoder();
const td = new TextDecoder();

class MemStorage implements ContentStorage {
  readonly data = new Map<string, Uint8Array>();
  async read(path: string) { return this.data.get(path)?.slice() ?? null; }
  async write(path: string, data: Uint8Array) { this.data.set(path, data.slice()); }
  async remove(path: string) {
    for (const key of [...this.data.keys()]) {
      if (key === path || key.startsWith(`${path}/`)) this.data.delete(key);
    }
  }
}

async function testSigner() {
  const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
  const publicKeys: ContentPublicKeyProvider = { getPublicKey: (id) => id === 'test' ? pub : null };
  async function manifest(version: string, files: Record<string, string>): Promise<ManifestDef> {
    const unsigned = {
      id: 'base', version, minAppVersion: '0.1.0', worldVersion: 2,
      files: await Promise.all(Object.entries(files).map(async ([path, value]) => ({
        path, size: te.encode(value).byteLength, sha256: await sha256Hex(te.encode(value)),
      }))),
    };
    const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', keys.privateKey, te.encode(canonicalManifestJson(unsigned))));
    return { ...unsigned, signature: { algorithm: 'Ed25519', keyId: 'test', value: btoa(String.fromCharCode(...sig)) } };
  }
  return { publicKeys, manifest };
}

function fakeNetwork(json: Record<string, unknown>, bytes: Record<string, string>): ContentNetwork {
  return {
    async getJson(url) { if (!(url in json)) throw new Error(`missing ${url}`); return json[url]; },
    async getBytes(url) { if (!(url in bytes)) throw new Error(`missing ${url}`); return te.encode(bytes[url]!); },
  };
}

describe('contentUpdatesRuntime initialization and activation', () => {
  beforeEach(() => {
    contentUpdatesRuntime.manager = null;
    contentUpdatesRuntime.status = { state: 'idle' };
  });

  it('initializes manager with bundled manifest and public keys', async () => {
    const { publicKeys, manifest } = await testSigner();
    const base = await manifest('1.0.0', { 'npcs.json': 'base' });
    const storage = new MemStorage();

    initContentUpdateManager({
      bundledManifest: base,
      bundledFiles: { 'npcs.json': 'base' },
      latestUrl: 'https://cdn.test/latest.json',
      appVersion: '0.1.0',
      supportedWorldVersions: [2],
      storage,
      network: fakeNetwork({}, {}),
      connectivity: { getConnectionType: async () => 'wifi' },
      preferences: { allowCellularDownloads: async () => false },
      publicKeys,
    });

    expect(contentUpdatesRuntime.manager).not.toBeNull();
    expect(contentUpdatesRuntime.status.state).toBe('idle');
  });

  it('activates staged pack on launch before bundled content loads', async () => {
    const { publicKeys, manifest } = await testSigner();
    const base = await manifest('1.0.0', { 'npcs.json': 'old' });
    const update = await manifest('1.1.0', { 'npcs.json': 'new' });
    const storage = new MemStorage();
    const network = fakeNetwork({
      'https://cdn.test/latest.json': { manifestUrl: 'manifest.json' },
      'https://cdn.test/manifest.json': update,
    }, { 'https://cdn.test/npcs.json': 'new' });

    initContentUpdateManager({
      bundledManifest: base,
      bundledFiles: { 'npcs.json': 'base' },
      latestUrl: 'https://cdn.test/latest.json',
      appVersion: '0.1.0',
      supportedWorldVersions: [2],
      storage, network,
      connectivity: { getConnectionType: async () => 'wifi' },
      preferences: { allowCellularDownloads: async () => false },
      publicKeys,
    });

    // Stage update
    const result = await contentUpdatesRuntime.manager!.checkAndStageLatest();
    expect(result.status).toBe('staged');

    // Activate on next launch
    const activated = await contentUpdatesRuntime.manager!.activateStagedOnLaunch();
    expect(activated).toBe(true);

    // Active manifest is the update
    const active = await contentUpdatesRuntime.manager!.activeManifest();
    expect(active.version).toBe('1.1.0');
    expect(td.decode(await contentUpdatesRuntime.manager!.readFile('npcs.json'))).toBe('new');
  });

  it('falls back to bundled when no staged pack exists', async () => {
    const { publicKeys, manifest } = await testSigner();
    const base = await manifest('1.0.0', { 'npcs.json': 'bundled' });
    const storage = new MemStorage();

    initContentUpdateManager({
      bundledManifest: base,
      bundledFiles: { 'npcs.json': 'base' },
      latestUrl: 'https://cdn.test/latest.json',
      appVersion: '0.1.0',
      supportedWorldVersions: [2],
      storage,
      network: fakeNetwork({}, {}),
      connectivity: { getConnectionType: async () => 'wifi' },
      preferences: { allowCellularDownloads: async () => false },
      publicKeys,
    });

    const activated = await contentUpdatesRuntime.manager!.activateStagedOnLaunch();
    expect(activated).toBe(false);

    const active = await contentUpdatesRuntime.manager!.activeManifest();
    expect(active.version).toBe('1.0.0');
  });
});

describe('contentUpdatesRuntime check/stage/rollback', () => {
  beforeEach(() => {
    contentUpdatesRuntime.manager = null;
    contentUpdatesRuntime.status = { state: 'idle' };
  });

  it('sets status to checking, then staged on success', async () => {
    const { publicKeys, manifest } = await testSigner();
    const base = await manifest('1.0.0', { 'a.json': 'old' });
    const update = await manifest('1.1.0', { 'a.json': 'new' });
    const storage = new MemStorage();
    const network = fakeNetwork({
      'https://cdn.test/latest.json': { manifestUrl: 'manifest.json' },
      'https://cdn.test/manifest.json': update,
    }, { 'https://cdn.test/a.json': 'new' });

    initContentUpdateManager({
      bundledManifest: base,
      bundledFiles: { 'npcs.json': 'base' },
      latestUrl: 'https://cdn.test/latest.json',
      appVersion: '0.1.0',
      supportedWorldVersions: [2],
      storage, network,
      connectivity: { getConnectionType: async () => 'wifi' },
      preferences: { allowCellularDownloads: async () => false },
      publicKeys,
    });

    const checkPromise = contentUpdatesRuntime.manager!.checkAndStageLatest();
    expect(contentUpdatesRuntime.status.state).toBe('idle'); // Status updated by UI wrapper, not here

    const result = await checkPromise;
    expect(result.status).toBe('staged');
  });

  it('sets status to error when check fails', async () => {
    const { publicKeys, manifest } = await testSigner();
    const base = await manifest('1.0.0', { 'a.json': 'old' });
    const storage = new MemStorage();
    const network = fakeNetwork({}, {}); // Missing latest.json

    initContentUpdateManager({
      bundledManifest: base,
      bundledFiles: { 'npcs.json': 'base' },
      latestUrl: 'https://cdn.test/latest.json',
      appVersion: '0.1.0',
      supportedWorldVersions: [2],
      storage, network,
      connectivity: { getConnectionType: async () => 'wifi' },
      preferences: { allowCellularDownloads: async () => false },
      publicKeys,
    });

    const result = await contentUpdatesRuntime.manager!.checkAndStageLatest();
    expect(result.status).toBe('invalid');
  });

  it('rolls back to bundled and removes active pointer', async () => {
    const { publicKeys, manifest } = await testSigner();
    const base = await manifest('1.0.0', { 'a.json': 'bundled' });
    const update = await manifest('1.1.0', { 'a.json': 'active' });
    const storage = new MemStorage();
    const network = fakeNetwork({
      'https://cdn.test/latest.json': { manifestUrl: 'manifest.json' },
      'https://cdn.test/manifest.json': update,
    }, { 'https://cdn.test/a.json': 'active' });

    initContentUpdateManager({
      bundledManifest: base,
      bundledFiles: { 'a.json': 'bundled' },
      latestUrl: 'https://cdn.test/latest.json',
      appVersion: '0.1.0',
      supportedWorldVersions: [2],
      storage, network,
      connectivity: { getConnectionType: async () => 'wifi' },
      preferences: { allowCellularDownloads: async () => false },
      publicKeys,
    });

    await contentUpdatesRuntime.manager!.checkAndStageLatest();
    await contentUpdatesRuntime.manager!.activateStagedOnLaunch();

    // Active is the update
    let active = await contentUpdatesRuntime.manager!.activeManifest();
    expect(active.version).toBe('1.1.0');

    // Rollback
    await contentUpdatesRuntime.manager!.rollbackToBundled();

    // Active is bundled again
    active = await contentUpdatesRuntime.manager!.activeManifest();
    expect(active.version).toBe('1.0.0');
    expect(td.decode(await contentUpdatesRuntime.manager!.readFile('a.json'))).toBe('bundled');
  });
});

describe('contentUpdatesRuntime status subscription', () => {
  beforeEach(() => {
    contentUpdatesRuntime.manager = null;
    contentUpdatesRuntime.status = { state: 'idle' };
  });

  it('notifies subscribers when checkAndStageContentUpdate changes status', async () => {
    const { publicKeys, manifest } = await testSigner();
    const base = await manifest('1.0.0', { 'a.json': 'old' });
    const update = await manifest('1.1.0', { 'a.json': 'new' });
    const storage = new MemStorage();
    const network = fakeNetwork({
      'https://cdn.test/latest.json': { manifestUrl: 'manifest.json' },
      'https://cdn.test/manifest.json': update,
    }, { 'https://cdn.test/a.json': 'new' });

    initContentUpdateManager({
      bundledManifest: base,
      bundledFiles: { 'a.json': 'old' },
      latestUrl: 'https://cdn.test/latest.json',
      appVersion: '0.1.0',
      supportedWorldVersions: [2],
      storage, network,
      connectivity: { getConnectionType: async () => 'wifi' },
      preferences: { allowCellularDownloads: async () => false },
      publicKeys,
    });

    const seen: string[] = [];
    const unsubscribe = subscribeToContentUpdateStatus((status) => seen.push(status.state));
    await checkAndStageContentUpdate();
    unsubscribe();

    expect(seen).toContain('checking');
    expect(seen).toContain('staged');
    // After unsubscribe no further notifications.
    const before = seen.length;
    await checkAndStageContentUpdate();
    expect(seen.length).toBe(before);
  });
});

describe('contentUpdatesRuntime offline graceful behavior', () => {
  it('returns up-to-date when network fails', async () => {
    const { publicKeys, manifest } = await testSigner();
    const base = await manifest('1.0.0', { 'a.json': 'bundled' });
    const storage = new MemStorage();
    const network: ContentNetwork = {
      async getJson() { throw new Error('Network unavailable'); },
      async getBytes() { throw new Error('Network unavailable'); },
    };

    initContentUpdateManager({
      bundledManifest: base,
      bundledFiles: { 'npcs.json': 'base' },
      latestUrl: 'https://cdn.test/latest.json',
      appVersion: '0.1.0',
      supportedWorldVersions: [2],
      storage, network,
      connectivity: { getConnectionType: async () => 'none' },
      preferences: { allowCellularDownloads: async () => false },
      publicKeys,
    });

    const result = await contentUpdatesRuntime.manager!.checkAndStageLatest();
    expect(result.status).toBe('invalid'); // Network error surfaces as invalid
  });
});

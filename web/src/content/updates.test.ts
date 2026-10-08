import { describe, expect, it } from 'vitest';
import type { ManifestDef } from './schema';
import {
  assertContentCompatibility,
  ContentUpdateManager,
  createDifferentialPlan,
  type ContentNetwork,
  type ContentStorage,
  type ContentUpdateOptions,
} from './updates';
import { canonicalManifestJson } from './canonical';
import { sha256Hex, type ContentPublicKeyProvider } from './security';

const te = new TextEncoder();
const td = new TextDecoder();

class MemoryStorage implements ContentStorage {
  readonly data = new Map<string, Uint8Array>();
  async read(path: string): Promise<Uint8Array | null> { return this.data.get(path)?.slice() ?? null; }
  async write(path: string, data: Uint8Array): Promise<void> { this.data.set(path, data.slice()); }
  async remove(path: string): Promise<void> {
    for (const key of [...this.data.keys()]) if (key === path || key.startsWith(`${path}/`)) this.data.delete(key);
  }
}

async function signer() {
  const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
  const publicKeys: ContentPublicKeyProvider = { getPublicKey: (id) => id === 'test' ? pub : null };
  async function manifest(version: string, files: Record<string, string>, minAppVersion = '1.0.0'): Promise<ManifestDef> {
    const unsigned = {
      id: 'main', version, minAppVersion, worldVersion: 2,
      files: await Promise.all(Object.entries(files).map(async ([path, value]) => ({
        path, size: te.encode(value).byteLength, sha256: await sha256Hex(te.encode(value)),
      }))),
    };
    const sig = new Uint8Array(await crypto.subtle.sign(
      'Ed25519', keys.privateKey, te.encode(canonicalManifestJson(unsigned)),
    ));
    return {
      ...unsigned,
      signature: { algorithm: 'Ed25519', keyId: 'test', value: btoa(String.fromCharCode(...sig)) },
    };
  }
  return { publicKeys, manifest };
}

function fakeNetwork(json: Record<string, unknown>, bytes: Record<string, string>, requested: string[]): ContentNetwork {
  return {
    async getJson(url) { requested.push(url); if (!(url in json)) throw new Error(`missing ${url}`); return json[url]; },
    async getBytes(url) { requested.push(url); if (!(url in bytes)) throw new Error(`missing ${url}`); return te.encode(bytes[url]!); },
  };
}

describe('content update compatibility and planning', () => {
  it('rejects a manifest requiring a newer app', () => {
    expect(() => assertContentCompatibility(
      { minAppVersion: '2.0.0', worldVersion: 2 },
      { appVersion: '1.9.9', supportedWorldVersions: [2] },
    )).toThrow(/requires app 2\.0\.0/i);
  });

  it('downloads only changed files and reports their size', async () => {
    const { manifest } = await signer();
    const installed = await manifest('1.0.0', { 'a.json': 'same', 'b.json': 'old' });
    const latest = await manifest('1.1.0', { 'a.json': 'same', 'b.json': 'new', 'c.json': 'added' });
    const plan = createDifferentialPlan(latest, installed);
    expect(plan.files.map((f) => f.path)).toEqual(['b.json', 'c.json']);
    expect(plan.downloadSize).toBe(te.encode('newadded').byteLength);
  });
});

describe('ContentUpdateManager lifecycle', () => {
  it('stages a signed latest.json update, activates only next launch, then rolls back to bundled', async () => {
    const { publicKeys, manifest } = await signer();
    const base = await manifest('1.0.0', { 'a.json': 'base-a', 'b.json': 'same' });
    const update = await manifest('1.1.0', { 'a.json': 'update-a', 'b.json': 'same' });
    const requested: string[] = [];
    const network = fakeNetwork(
      {
        'https://cdn.test/latest.json': { manifestUrl: 'packs/1.1.0/manifest.json', contentBaseUrl: 'packs/1.1.0/' },
        'https://cdn.test/packs/1.1.0/manifest.json': update,
      },
      { 'https://cdn.test/packs/1.1.0/a.json': 'update-a' },
      requested,
    );
    const storage = new MemoryStorage();
    const options = {
      network, storage, publicKeys,
      latestUrl: 'https://cdn.test/latest.json', appVersion: '1.0.0', supportedWorldVersions: [2],
      bundled: { manifest: base, readFile: async (path: string) => te.encode(path === 'a.json' ? 'base-a' : 'same') },
      connectivity: { getConnectionType: async () => 'wifi' as const },
      preferences: { allowCellularDownloads: async () => false },
    };

    const firstLaunch = new ContentUpdateManager(options);
    expect(td.decode(await firstLaunch.readFile('a.json'))).toBe('base-a');
    const result = await firstLaunch.checkAndStageLatest();
    expect(result.status, JSON.stringify(result)).toBe('staged');
    expect(requested).not.toContain('https://cdn.test/packs/1.1.0/b.json');
    expect(td.decode(await firstLaunch.readFile('a.json'))).toBe('base-a');

    const nextLaunch = new ContentUpdateManager(options);
    await expect(nextLaunch.activateStagedOnLaunch()).resolves.toBe(true);
    expect(td.decode(await nextLaunch.readFile('a.json'))).toBe('update-a');
    await nextLaunch.rollbackToBundled();
    expect(td.decode(await nextLaunch.readFile('a.json'))).toBe('base-a');
  });

  it('does not download pack files on cellular unless preference allows it', async () => {
    const { publicKeys, manifest } = await signer();
    const base = await manifest('1.0.0', { 'a.json': 'old' });
    const update = await manifest('1.1.0', { 'a.json': 'new' });
    const requested: string[] = [];
    const manager = new ContentUpdateManager({
      network: fakeNetwork({
        'https://cdn.test/latest.json': { manifestUrl: 'manifest.json' },
        'https://cdn.test/manifest.json': update,
      }, { 'https://cdn.test/a.json': 'new' }, requested),
      storage: new MemoryStorage(), publicKeys, latestUrl: 'https://cdn.test/latest.json',
      appVersion: '1.0.0', supportedWorldVersions: [2],
      bundled: { manifest: base, readFile: async () => te.encode('old') },
      connectivity: { getConnectionType: async () => 'cellular' as const },
      preferences: { allowCellularDownloads: async () => false },
    });
    const result = await manager.checkAndStageLatest();
    expect(result.status).toBe('waiting-for-wifi');
    expect(requested).not.toContain('https://cdn.test/a.json');
  });

  it('discards a pack whose downloaded bytes fail one-byte SHA-256 verification', async () => {
    const { publicKeys, manifest } = await signer();
    const base = await manifest('1.0.0', { 'a.json': 'old' });
    const update = await manifest('1.1.0', { 'a.json': 'new' });
    const storage = new MemoryStorage();
    const manager = new ContentUpdateManager({
      network: fakeNetwork({
        'https://cdn.test/latest.json': { manifestUrl: 'manifest.json' },
        'https://cdn.test/manifest.json': update,
      }, { 'https://cdn.test/a.json': 'tampered' }, []),
      storage, publicKeys, latestUrl: 'https://cdn.test/latest.json',
      appVersion: '1.0.0', supportedWorldVersions: [2],
      bundled: { manifest: base, readFile: async () => te.encode('old') },
      connectivity: { getConnectionType: async () => 'wifi' as const },
      preferences: { allowCellularDownloads: async () => true },
    });
    const result = await manager.checkAndStageLatest();
    expect(result.status).toBe('invalid');
    expect([...storage.data.keys()].some((key) => key.includes('packs/'))).toBe(false);
    // The dropped pack never activates on the next launch.
    expect(await manager.activateStagedOnLaunch()).toBe(false);
  });

  it('refuses a pack that requires a newer app than the one installing it', async () => {
    const { publicKeys, manifest } = await signer();
    const base = await manifest('1.0.0', { 'a.json': 'old' });
    const update = await manifest('1.1.0', { 'a.json': 'new' }, '2.0.0');
    const storage = new MemoryStorage();
    const options: ContentUpdateOptions = {
      network: fakeNetwork({
        'https://cdn.test/latest.json': { manifestUrl: 'manifest.json' },
        'https://cdn.test/manifest.json': update,
      }, { 'https://cdn.test/a.json': 'new' }, []),
      storage, publicKeys, latestUrl: 'https://cdn.test/latest.json',
      appVersion: '1.0.0', supportedWorldVersions: [2],
      bundled: { manifest: base, readFile: async () => te.encode('old') },
      connectivity: { getConnectionType: async () => 'wifi' as const },
      preferences: { allowCellularDownloads: async () => true },
    };
    const result = await new ContentUpdateManager(options).checkAndStageLatest();
    expect(result.status).toBe('invalid');
    expect([...storage.data.keys()].some((key) => key.includes('packs/'))).toBe(false);
  });

  it('drops a staged pack and falls back to bundled content when activation finds tampered bytes', async () => {
    const { publicKeys, manifest } = await signer();
    const base = await manifest('1.0.0', { 'a.json': 'old' });
    const update = await manifest('1.1.0', { 'a.json': 'new' });
    const storage = new MemoryStorage();
    const manager = new ContentUpdateManager({
      network: fakeNetwork({
        'https://cdn.test/latest.json': { manifestUrl: 'manifest.json' },
        'https://cdn.test/manifest.json': update,
      }, { 'https://cdn.test/a.json': 'new' }, []),
      storage, publicKeys, latestUrl: 'https://cdn.test/latest.json',
      appVersion: '1.0.0', supportedWorldVersions: [2],
      bundled: { manifest: base, readFile: async () => te.encode('old') },
      connectivity: { getConnectionType: async () => 'wifi' as const },
      preferences: { allowCellularDownloads: async () => true },
    });
    expect((await manager.checkAndStageLatest()).status).toBe('staged');

    // Corrupt one byte of the staged payload on disk.
    for (const [key, value] of storage.data) {
      if (key.endsWith('/a.json')) { const copy = value.slice(); copy[0] = copy[0]! ^ 1; storage.data.set(key, copy); }
    }
    await expect(new ContentUpdateManager({
      network: fakeNetwork({}, {}, []), storage, publicKeys, latestUrl: 'https://cdn.test/latest.json',
      appVersion: '1.0.0', supportedWorldVersions: [2],
      bundled: { manifest: base, readFile: async () => te.encode('old') },
      connectivity: { getConnectionType: async () => 'wifi' as const },
      preferences: { allowCellularDownloads: async () => true },
    }).activateStagedOnLaunch()).resolves.toBe(false);
    expect([...storage.data.keys()].some((key) => key.includes('packs/'))).toBe(false);
  });
});

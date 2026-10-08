import { z } from 'zod';
import { ManifestSchema, type ManifestDef } from './schema';
import {
  type ContentPublicKeyProvider,
  verifyContentFile,
  verifyManifestSignature,
} from './security';

export interface ContentNetwork {
  getJson(url: string): Promise<unknown>;
  getBytes(url: string): Promise<Uint8Array>;
}

export interface ContentStorage {
  read(path: string): Promise<Uint8Array | null>;
  write(path: string, data: Uint8Array): Promise<void>;
  /** Removes a file or a directory prefix recursively. */
  remove(path: string): Promise<void>;
}

/** Browser implementation; native Capacitor callers can inject a Filesystem-backed adapter. */
export class LocalStorageContentStorage implements ContentStorage {
  constructor(private readonly storage: Storage = localStorage) {}

  async read(path: string): Promise<Uint8Array | null> {
    const value = this.storage.getItem(path);
    return value === null ? null : Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    let value = '';
    for (let i = 0; i < data.length; i += 0x8000) {
      value += String.fromCharCode(...data.subarray(i, i + 0x8000));
    }
    this.storage.setItem(path, btoa(value));
  }

  async remove(path: string): Promise<void> {
    const keys: string[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key === path || key?.startsWith(`${path}/`)) keys.push(key);
    }
    keys.forEach((key) => this.storage.removeItem(key));
  }
}

/** Fetch implementation for HTTPS/static content servers. */
export class FetchContentNetwork implements ContentNetwork {
  async getJson(url: string): Promise<unknown> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Content request failed: HTTP ${response.status} (${url})`);
    return response.json();
  }

  async getBytes(url: string): Promise<Uint8Array> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Content request failed: HTTP ${response.status} (${url})`);
    return new Uint8Array(await response.arrayBuffer());
  }
}

export type ContentConnectionType = 'wifi' | 'cellular' | 'none' | 'unknown';

export interface ContentConnectivity {
  getConnectionType(): Promise<ContentConnectionType>;
}

export interface ContentDownloadPreferences {
  allowCellularDownloads(): Promise<boolean>;
}

export interface BundledContentSource {
  manifest: ManifestDef;
  readFile(path: string): Promise<Uint8Array>;
}

export interface ContentCompatibility {
  appVersion: string;
  supportedWorldVersions: readonly number[];
}

export interface ContentUpdateOptions extends ContentCompatibility {
  latestUrl: string;
  network: ContentNetwork;
  storage: ContentStorage;
  connectivity: ContentConnectivity;
  preferences: ContentDownloadPreferences;
  publicKeys: ContentPublicKeyProvider;
  bundled: BundledContentSource;
}

export interface DifferentialPlan {
  manifest: ManifestDef;
  files: ManifestDef['files'];
  reusedFiles: ManifestDef['files'];
  downloadSize: number;
}

export type ContentUpdateResult =
  | { status: 'up-to-date'; manifest: ManifestDef }
  | { status: 'waiting-for-wifi'; plan: DifferentialPlan }
  | { status: 'staged'; plan: DifferentialPlan }
  | { status: 'invalid'; reason: string };

const LatestSchema = z.object({
  manifestUrl: z.string().min(1),
  contentBaseUrl: z.string().min(1).optional(),
});

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const ACTIVE_POINTER = '__content/active.json';
const PENDING_POINTER = '__content/pending.json';

interface StoredPointer {
  root: string;
  manifest: ManifestDef;
}

export function assertContentCompatibility(
  manifest: Pick<ManifestDef, 'minAppVersion' | 'worldVersion'>,
  compatibility: ContentCompatibility,
): void {
  if (compareVersions(compatibility.appVersion, manifest.minAppVersion) < 0) {
    throw new Error(
      `Content requires app ${manifest.minAppVersion}, but this app is ${compatibility.appVersion}`,
    );
  }
  if (!compatibility.supportedWorldVersions.includes(manifest.worldVersion)) {
    throw new Error(`Unsupported world version ${manifest.worldVersion}`);
  }
}

/** SemVer-compatible numeric comparison; prereleases sort before their release. */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) => {
    const [main = '', prerelease] = value.trim().replace(/^v/, '').split('-', 2);
    const numeric = main.split('.').map((part) => {
      if (!/^\d+$/.test(part)) throw new Error(`Invalid version: ${value}`);
      return Number(part);
    });
    return { numeric, prerelease };
  };
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < Math.max(left.numeric.length, right.numeric.length); i++) {
    const difference = (left.numeric[i] ?? 0) - (right.numeric[i] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === undefined) return 1;
  if (right.prerelease === undefined) return -1;
  return left.prerelease.localeCompare(right.prerelease);
}

export function createDifferentialPlan(
  latest: ManifestDef,
  installed?: ManifestDef,
): DifferentialPlan {
  const installedHashes = new Map(installed?.files.map((file) => [file.path, file.sha256]) ?? []);
  const files = latest.files.filter((file) => installedHashes.get(file.path) !== file.sha256);
  const changed = new Set(files.map((file) => file.path));
  return {
    manifest: latest,
    files,
    reusedFiles: latest.files.filter((file) => !changed.has(file.path)),
    downloadSize: files.reduce((total, file) => total + file.size, 0),
  };
}

/**
 * Browser/Capacitor-neutral update coordinator. UI calls `checkAndStageLatest`
 * on the title screen and `activateStagedOnLaunch` once during the next launch.
 */
export class ContentUpdateManager {
  constructor(private readonly options: ContentUpdateOptions) {}

  async checkAndStageLatest(): Promise<ContentUpdateResult> {
    let stageRoot: string | undefined;
    try {
      const latestValue = LatestSchema.parse(await this.options.network.getJson(this.options.latestUrl));
      const manifestUrl = new URL(latestValue.manifestUrl, this.options.latestUrl).toString();
      const manifest = ManifestSchema.parse(await this.options.network.getJson(manifestUrl));
      await verifyManifestSignature(manifest, this.options.publicKeys);
      assertContentCompatibility(manifest, this.options);

      const current = await this.currentSource();
      if (manifest.id === current.manifest.id && compareVersions(manifest.version, current.manifest.version) <= 0) {
        return { status: 'up-to-date', manifest: current.manifest };
      }
      const plan = createDifferentialPlan(manifest, current.manifest);
      if (
        plan.downloadSize > 0 &&
        await this.options.connectivity.getConnectionType() === 'cellular' &&
        !await this.options.preferences.allowCellularDownloads()
      ) {
        return { status: 'waiting-for-wifi', plan };
      }

      stageRoot = packRoot(manifest);
      await this.options.storage.remove(stageRoot);
      const baseUrl = new URL(latestValue.contentBaseUrl ?? './', this.options.latestUrl);
      const downloadPaths = new Set(plan.files.map((file) => file.path));
      for (const file of manifest.files) {
        const data = downloadPaths.has(file.path)
          ? await this.options.network.getBytes(new URL(file.path, baseUrl).toString())
          : await current.readFile(file.path);
        await verifyContentFile(file, data);
        await this.options.storage.write(`${stageRoot}/${file.path}`, data);
      }
      await this.options.storage.write(
        `${stageRoot}/manifest.json`,
        textEncoder.encode(JSON.stringify(manifest)),
      );
      await writePointer(this.options.storage, PENDING_POINTER, { root: stageRoot, manifest });
      return { status: 'staged', plan };
    } catch (error) {
      if (stageRoot) await this.options.storage.remove(stageRoot);
      await this.options.storage.remove(PENDING_POINTER);
      return { status: 'invalid', reason: errorMessage(error) };
    }
  }

  /** Verify staged bytes again, then atomically make the pointer active. */
  async activateStagedOnLaunch(): Promise<boolean> {
    const pending = await readPointer(this.options.storage, PENDING_POINTER);
    if (!pending) return false;
    try {
      await verifyManifestSignature(pending.manifest, this.options.publicKeys);
      assertContentCompatibility(pending.manifest, this.options);
      for (const file of pending.manifest.files) {
        const data = await this.options.storage.read(`${pending.root}/${file.path}`);
        if (!data) throw new Error(`Staged file missing: ${file.path}`);
        await verifyContentFile(file, data);
      }
      await writePointer(this.options.storage, ACTIVE_POINTER, pending);
      await this.options.storage.remove(PENDING_POINTER);
      return true;
    } catch {
      await this.options.storage.remove(pending.root);
      await this.options.storage.remove(PENDING_POINTER);
      return false;
    }
  }

  async rollbackToBundled(): Promise<void> {
    const active = await readPointer(this.options.storage, ACTIVE_POINTER);
    const pending = await readPointer(this.options.storage, PENDING_POINTER);
    await this.options.storage.remove(ACTIVE_POINTER);
    await this.options.storage.remove(PENDING_POINTER);
    if (active) await this.options.storage.remove(active.root);
    if (pending && pending.root !== active?.root) await this.options.storage.remove(pending.root);
  }

  async activeManifest(): Promise<ManifestDef> {
    return (await this.currentSource()).manifest;
  }

  async readFile(path: string): Promise<Uint8Array> {
    if (path.startsWith('/') || path.includes('..')) throw new Error(`Unsafe content path: ${path}`);
    return (await this.currentSource()).readFile(path);
  }

  private async currentSource(): Promise<{
    manifest: ManifestDef;
    readFile(path: string): Promise<Uint8Array>;
  }> {
    const active = await readPointer(this.options.storage, ACTIVE_POINTER);
    if (!active) return this.options.bundled;
    return {
      manifest: active.manifest,
      readFile: async (path) => {
        const value = await this.options.storage.read(`${active.root}/${path}`);
        if (!value) throw new Error(`Active content file missing: ${path}`);
        return value;
      },
    };
  }
}

function packRoot(manifest: ManifestDef): string {
  return `__content/packs/${manifest.id}-${manifest.version}`;
}

async function writePointer(storage: ContentStorage, path: string, value: StoredPointer): Promise<void> {
  await storage.write(path, textEncoder.encode(JSON.stringify(value)));
}

async function readPointer(storage: ContentStorage, path: string): Promise<StoredPointer | null> {
  const bytes = await storage.read(path);
  if (!bytes) return null;
  try {
    const raw = JSON.parse(textDecoder.decode(bytes)) as { root?: unknown; manifest?: unknown };
    if (typeof raw.root !== 'string') throw new Error('pointer root missing');
    return { root: raw.root, manifest: ManifestSchema.parse(raw.manifest) };
  } catch {
    await storage.remove(path);
    return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

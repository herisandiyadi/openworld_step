/**
 * Global runtime singleton for content update management.
 * Wires updates.ts into the live app with browser/Capacitor-compatible adapters.
 */

import { Preferences } from '@capacitor/preferences';
import {
  ContentUpdateManager,
  FetchContentNetwork,
  LocalStorageContentStorage,
  type BundledContentSource,
  type ContentConnectionType,
  type ContentUpdateOptions,
} from '../content/updates';
import type { ManifestDef } from '../content/schema';
import type { ContentPublicKeyProvider } from '../content/security';

export interface ContentUpdateStatus {
  state: 'idle' | 'checking' | 'downloading' | 'staged' | 'waiting-for-wifi' | 'up-to-date' | 'error';
  message?: string;
  downloadSize?: number;
}

export const contentUpdatesRuntime: {
  manager: ContentUpdateManager | null;
  status: ContentUpdateStatus;
} = {
  manager: null,
  status: { state: 'idle' },
};

export interface InitContentUpdateManagerOptions {
  bundledManifest: ManifestDef;
  /** Preferred injection point for real bundled files. */
  bundled?: BundledContentSource;
  /** Small test-friendly adapter retained for callers that do not need glob imports. */
  bundledFiles?: Record<string, string>;
  latestUrl: string;
  appVersion: string;
  supportedWorldVersions: readonly number[];
  storage: ContentUpdateOptions['storage'];
  network: ContentUpdateOptions['network'];
  connectivity: ContentUpdateOptions['connectivity'];
  preferences: ContentUpdateOptions['preferences'];
  publicKeys: ContentPublicKeyProvider;
}

const statusListeners = new Set<(status: ContentUpdateStatus) => void>();
const te = new TextEncoder();
const CELLULAR_KEY = 'content_updates_allow_cellular_v1';

function setStatus(status: ContentUpdateStatus): void {
  contentUpdatesRuntime.status = status;
  for (const listener of statusListeners) listener(status);
}

export function subscribeToContentUpdateStatus(listener: (status: ContentUpdateStatus) => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}


export function initContentUpdateManager(options: InitContentUpdateManagerOptions): void {
  const bundled: BundledContentSource = options.bundled ?? {
    manifest: options.bundledManifest,
    readFile: async (path: string) => {
      const content = options.bundledFiles?.[path];
      if (content === undefined) throw new Error(`Bundled file missing: ${path}`);
      return te.encode(content);
    },
  };

  contentUpdatesRuntime.manager = new ContentUpdateManager({
    latestUrl: options.latestUrl,
    appVersion: options.appVersion,
    supportedWorldVersions: options.supportedWorldVersions,
    network: options.network,
    storage: options.storage,
    connectivity: options.connectivity,
    preferences: options.preferences,
    publicKeys: options.publicKeys,
    bundled,
  });
  setStatus({ state: 'idle' });
}

export async function activateStagedContentOnLaunch(): Promise<boolean> {
  const manager = requireManager();
  return manager.activateStagedOnLaunch();
}

export async function checkAndStageContentUpdate(): Promise<Awaited<ReturnType<ContentUpdateManager['checkAndStageLatest']>>> {
  const manager = requireManager();
  setStatus({ state: 'checking' });
  const result = await manager.checkAndStageLatest();
  if (result.status === 'staged') {
    setStatus({ state: 'staged', downloadSize: result.plan.downloadSize, message: 'Paket siap dipakai pada peluncuran berikutnya.' });
  } else if (result.status === 'waiting-for-wifi') {
    setStatus({ state: 'waiting-for-wifi', downloadSize: result.plan.downloadSize, message: 'Menunggu Wi-Fi sesuai preferensi seluler.' });
  } else if (result.status === 'up-to-date') {
    setStatus({ state: 'up-to-date', message: `Paket ${result.manifest.version} sudah terbaru.` });
  } else {
    setStatus({ state: 'error', message: result.reason });
  }
  return result;
}

export async function rollbackContentToBundled(): Promise<void> {
  await requireManager().rollbackToBundled();
  setStatus({ state: 'idle', message: 'Paket bawaan akan dipakai pada peluncuran berikutnya.' });
}

export async function activeContentManifest(): Promise<ManifestDef> {
  return requireManager().activeManifest();
}

function requireManager(): ContentUpdateManager {
  if (!contentUpdatesRuntime.manager) throw new Error('Content update manager is not initialized');
  return contentUpdatesRuntime.manager;
}

export function createDefaultContentUpdateDependencies(): Pick<InitContentUpdateManagerOptions, 'storage' | 'network' | 'connectivity' | 'preferences' | 'publicKeys'> {
  const connection = (): ContentConnectionType => {
    if (typeof navigator === 'undefined') return 'unknown';
    if (!navigator.onLine) return 'none';
    const effectiveType = (navigator as Navigator & { connection?: { type?: string; effectiveType?: string } }).connection;
    if (effectiveType?.type === 'cellular' || effectiveType?.effectiveType === '2g' || effectiveType?.effectiveType === '3g' || effectiveType?.effectiveType === '4g') return 'cellular';
    return effectiveType?.type === 'wifi' ? 'wifi' : 'unknown';
  };
  return {
    storage: new LocalStorageContentStorage(window.localStorage),
    network: new FetchContentNetwork(),
    connectivity: { getConnectionType: async () => connection() },
    preferences: {
      allowCellularDownloads: async () => {
        const { value } = await Preferences.get({ key: CELLULAR_KEY });
        return value === 'true';
      },
    },
    publicKeys: createPublicKeyProvider(import.meta.env.VITE_CONTENT_PUBLIC_KEYS),
  };
}

export async function setAllowCellularDownloads(allowed: boolean): Promise<void> {
  await Preferences.set({ key: CELLULAR_KEY, value: String(allowed) });
}

export async function getAllowCellularDownloads(): Promise<boolean> {
  const { value } = await Preferences.get({ key: CELLULAR_KEY });
  return value === 'true';
}

function createPublicKeyProvider(raw: string | undefined): ContentPublicKeyProvider {
  let keys: Record<string, string> = {};
  if (raw) {
    try { keys = JSON.parse(raw) as Record<string, string>; } catch { console.warn('[content] Invalid VITE_CONTENT_PUBLIC_KEYS'); }
  }
  return {
    getPublicKey: (keyId) => {
      const encoded = keys[keyId];
      if (!encoded) return null;
      try { return Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)); } catch { return null; }
    },
  };
}

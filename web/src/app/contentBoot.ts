/**
 * App boot helper for the content update system.
 * Synchronously seeds bundled content (so the game always has a valid registry),
 * then asynchronously activates any previously staged valid pack and reloads
 * content from the active pack (bundled fallback keeps the app usable offline).
 */

import { loadContentPack } from '../content/loader';
import { bootstrapContentRuntime, setContentRuntime } from './contentRuntime';
import {
  activateStagedContentOnLaunch,
  contentUpdatesRuntime,
  initContentUpdateManager,
  createDefaultContentUpdateDependencies,
} from './contentUpdatesRuntime';
import { contentRuntime } from './contentRuntime';
import { setActiveWorldLoader } from '../world/worldState';
import type { ContentUpdateManager } from '../content/updates';
import baseManifest from '../../content/base/manifest.json';
import baseNpcs from '../../content/base/npcs.json';
import baseQuests from '../../content/base/quests.json';
import baseRegions from '../../content/base/regions.json';
import baseShops from '../../content/base/shops.json';
import baseItems from '../../content/base/items.json';
import baseEconomy from '../../content/base/economy.json';
import baseFishing from '../../content/base/fishing.json';

export type BootedPack = ReturnType<typeof loadContentPack>;

/**
 * Versi world yang didukung runtime. 2 = world prosedural legacy, 3 = peta hasil
 * geo-generator (Blok M/Little Tokyo). Tanpa 3, manifest peta selalu ditolak sebagai
 * "Unsupported world version".
 */
const SUPPORTED_WORLD_VERSIONS = [2, 3];

/** Absolute URL default manifest peta yang di-serve bareng app. */
const DEFAULT_LATEST_URL = '/maps-manifest/latest.json';

/**
 * URL manifest content/map.
 * Selalu URL absolut (fetch relatif tanpa base bikin "Invalid base URL"), dan tidak pernah
 * menunjuk host contoh -- dulu default-nya https://example.com/... sehingga tiap unduh peta
 * gagal "Failed to fetch" dan menutupi penyebab sebenarnya.
 */
function resolveLatestUrl(): string {
  const configured = import.meta.env.VITE_CONTENT_LATEST_URL as string | undefined;
  const raw = configured && configured.trim() !== '' ? configured : DEFAULT_LATEST_URL;
  const base = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/';
  try {
    return new URL(raw, base).toString();
  } catch {
    return new URL(DEFAULT_LATEST_URL, base).toString();
  }
}

const bundledPack = loadContentPack({
  manifest: baseManifest,
  npcs: baseNpcs,
  quests: baseQuests,
  regions: baseRegions,
  shops: baseShops,
  items: baseItems,
  economy: baseEconomy,
  fishing: baseFishing,
});

const te = new TextEncoder();

function bundledSource() {
  const map: Record<string, unknown> = {
    'npcs.json': baseNpcs,
    'quests.json': baseQuests,
    'regions.json': baseRegions,
    'shops.json': baseShops,
    'items.json': baseItems,
    'economy.json': baseEconomy,
    'fishing.json': baseFishing,
  };
  return {
    manifest: baseManifest,
    async readFile(path: string) {
      const data = map[path];
      if (data === undefined) throw new Error(`Bundled file ${path} not found`);
      return te.encode(JSON.stringify(data));
    },
  };
}

/** Synchronously seed bundled content so consumers see a valid registry immediately. */
export function seedBundledContent(): BootedPack {
  setContentRuntime(bundledPack);
  return bundledPack;
}

/** Async part: activate staged pack (if any), then prefer active over bundled. */
export async function bootContentRuntime(): Promise<BootedPack> {
  // Bundled is already live; never leave the registry empty.
  seedBundledContent();

  try {
    initContentUpdateManager({
      bundledManifest: baseManifest,
      bundled: bundledSource(),
      // Endpoint manifest peta dari geo-generator (bukan placeholder). Kalau kosong, JANGAN
      // pakai host contoh: fetch akan selalu gagal dan menutupi error peta yang sebenarnya.
      // Urutan: env -> latest.json yang di-serve bareng app -> baru menyerah (tanpa manager).
      latestUrl: resolveLatestUrl(),
      appVersion: '0.1.0',
      supportedWorldVersions: SUPPORTED_WORLD_VERSIONS,
      ...createDefaultContentUpdateDependencies(),
    });
  } catch (error) {
    console.warn('[content] Update manager unavailable; bundled content stays active:', error);
    return bundledPack;
  }

  try {
    const activated = await activateStagedContentOnLaunch();
    if (activated) console.log('[content] Staged pack activated for this launch');
  } catch (error) {
    console.warn('[content] Activation skipped:', error);
  }

  const manager = contentUpdatesRuntime.manager;
  if (!manager) return bundledPack;

  // Sambungkan world ke paket unduhan: file world (index, chunks, navmesh, lanes, map.png)
  // dibaca dari storage paket bila aktif, dengan fallback ke server. Tanpa ini, "Unduh peta"
  // tidak berpengaruh sama sekali -- game selalu memuat public/world/ dari server.
  installWorldLoader(manager);

  // Prefer the active (downloaded) pack; fall back to bundled on any failure.
  return bootstrapContentRuntime(
    {
      activeManifest: () => manager.activeManifest(),
      readFile: (path) => manager.readFile(path),
    },
    bundledPack,
  );
}

/**
 * Baca file world dari paket unduhan. Paket memuat isi direktori dataset (index.json,
 * chunks/*.json, navmesh/*.bin, lanes.json, map.png) tanpa prefix "world/", jadi satu kali
 * fallback dicoba dengan dan tanpa prefix tersebut.
 */
function installWorldLoader(manager: ContentUpdateManager): void {
  const read = (path: string): Promise<Uint8Array> =>
    manager
      .readFile(path)
      .catch(() => manager.readFile(`world/${path}`));

  setActiveWorldLoader(() => {
    // Loader dipakai lewat fetchWorldFile; isi Response dirakit dari bytes paket.
    return null;
  });

  // Ambil alih fetch untuk URL world (dipakai worker chunk/streamer yang tidak lewat helper).
  const originalFetch = globalThis.fetch.bind(globalThis);
  const worldPrefix = new URL(`${import.meta.env.BASE_URL}world/`, document.baseURI).href;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (href.startsWith(worldPrefix)) {
      const path = decodeURIComponent(href.slice(worldPrefix.length).split('?')[0] ?? '');
      if (path && !path.includes('..')) {
        try {
          const bytes = await read(path);
          const type = path.endsWith('.json')
            ? 'application/json'
            : path.endsWith('.png')
              ? 'image/png'
              : 'application/octet-stream';
          return new Response(bytes.slice().buffer as ArrayBuffer, { status: 200, headers: { 'content-type': type } });
        } catch {
          // Tidak ada di paket: biarkan fetch server di bawah.
        }
      }
    }
    return originalFetch(input, init);
  };
}

let bootPromise: Promise<BootedPack> | null = null;

export function ensureContentBooted(): Promise<BootedPack> {
  if (!bootPromise) bootPromise = bootContentRuntime();
  return bootPromise;
}

// Immediate synchronous seed so contentRuntime is never null while boot resolves.
seedBundledContent();

// Expose for tests / debugging without importing internals elsewhere.
export const runtimePeek = (): typeof contentRuntime => contentRuntime;

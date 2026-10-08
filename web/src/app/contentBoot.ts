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
import baseManifest from '../../content/base/manifest.json';
import baseNpcs from '../../content/base/npcs.json';
import baseQuests from '../../content/base/quests.json';
import baseRegions from '../../content/base/regions.json';
import baseShops from '../../content/base/shops.json';
import baseItems from '../../content/base/items.json';
import baseEconomy from '../../content/base/economy.json';
import baseFishing from '../../content/base/fishing.json';

export type BootedPack = ReturnType<typeof loadContentPack>;

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
      latestUrl: import.meta.env.VITE_CONTENT_LATEST_URL ?? 'https://example.com/content/latest.json',
      appVersion: '0.1.0',
      supportedWorldVersions: [2],
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

  // Prefer the active (downloaded) pack; fall back to bundled on any failure.
  return bootstrapContentRuntime(
    {
      activeManifest: () => manager.activeManifest(),
      readFile: (path) => manager.readFile(path),
    },
    bundledPack,
  );
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

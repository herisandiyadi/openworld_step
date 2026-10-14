import type { ContentRegistry } from '../content/registry';
import type { ManifestDef, EconomyDef, FishingDef, LoadedContentPack } from '../content/loader';
import { loadContentFromSource, loadContentPack } from '../content/loader';

export { loadContentPack };

/**
 * Global runtime singleton holding loaded content registry and settings.
 * Initialized once at app mount from bundled or active downloaded content.
 */
export const contentRuntime: {
  registry: ContentRegistry | null;
  manifest: ManifestDef | null;
  economy: EconomyDef | null;
  fishing: FishingDef | null;
} = {
  registry: null,
  manifest: null,
  economy: null,
  fishing: null,
};

export function setContentRuntime(pack: LoadedContentPack): void {
  contentRuntime.registry = pack.registry;
  contentRuntime.manifest = pack.manifest;
  contentRuntime.economy = pack.economy ?? null;
  contentRuntime.fishing = pack.fishing ?? null;
}

export async function bootstrapContentRuntime(
  source: {
    activeManifest(): Promise<ManifestDef>;
    readFile(path: string): Promise<Uint8Array>;
  },
  bundled: LoadedContentPack,
): Promise<LoadedContentPack> {
  try {
    const pack = await loadContentFromSource(source);
    setContentRuntime(pack);
    return pack;
  } catch (error) {
    console.warn('[content] Active pack unavailable; using bundled content:', error);
    setContentRuntime(bundled);
    return bundled;
  }
}


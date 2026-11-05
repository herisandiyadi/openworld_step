/**
 * Capacitor-backed adapters for the content pack update system (U5 native support).
 *
 * - CapacitorFilesystemContentStorage: ContentStorage on top of @capacitor/filesystem,
 *   selected automatically on native platforms (browser falls back to LocalStorageContentStorage).
 * - CapacitorNetworkConnectivity: ContentConnectivity on top of @capacitor/network,
 *   so the Wi-Fi-only download preference reflects the real radio state instead of
 *   the browser-only navigator.connection heuristic.
 *
 * Both take their plugin as an injected interface so tests never touch the bridge.
 */

import type { ContentConnectivity, ContentConnectionType, ContentStorage } from './updates';

/** Shape of @capacitor/filesystem's Filesystem plugin used by the storage adapter. */
export interface FilesystemLike {
  readFile(options: { path: string; directory?: string }): Promise<{ data: string | Blob }>;
  writeFile(options: {
    path: string;
    data: string | Blob;
    directory?: string;
    encoding?: string;
    recursive?: boolean;
  }): Promise<unknown>;
  deleteFile(options: { path: string; directory?: string }): Promise<void>;
  mkdir(options: { path: string; directory?: string; recursive?: boolean }): Promise<void>;
  rmdir(options: { path: string; directory?: string; recursive?: boolean }): Promise<void>;
  stat(options: { path: string; directory?: string }): Promise<{ type: 'file' | 'directory' }>;
  rename(options: { from: string; to: string; directory?: string; toDirectory?: string }): Promise<void>;
}

/** Shape of @capacitor/network's Network plugin used by the connectivity adapter. */
export interface NetworkPluginLike {
  getStatus(): Promise<{ connected: boolean; connectionType: 'wifi' | 'cellular' | 'none' | 'unknown' }>;
}

const CHUNK = 0x8000;

export function bytesToBase64(data: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < data.length; i += CHUNK) {
    binary += String.fromCharCode(...data.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

/** ContentStorage implemented over the Capacitor Filesystem plugin (binary via base64). */
export class CapacitorFilesystemContentStorage implements ContentStorage {
  constructor(
    private readonly filesystem: FilesystemLike,
    private readonly directory = 'DATA',
  ) {}

  async read(path: string): Promise<Uint8Array | null> {
    try {
      const { data } = await this.filesystem.readFile({ path, directory: this.directory });
      if (typeof data !== 'string') throw new Error(`Unexpected blob result reading ${path}`);
      return base64ToBytes(data);
    } catch (error) {
      if (isMissingFileError(error)) return null;
      throw error;
    }
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    await this.filesystem.writeFile({
      path,
      data: bytesToBase64(data),
      directory: this.directory,
      recursive: true,
    });
  }

  async remove(path: string): Promise<void> {
    let type: 'file' | 'directory';
    try {
      type = (await this.filesystem.stat({ path, directory: this.directory })).type;
    } catch (error) {
      if (isMissingFileError(error)) return;
      throw error;
    }
    if (type === 'directory') {
      await this.filesystem.rmdir({ path, directory: this.directory, recursive: true });
    } else {
      await this.filesystem.deleteFile({ path, directory: this.directory });
    }
  }

  /** Publish via temp file + rename, so readers never see a half-written file. */
  async writeAtomic(path: string, data: Uint8Array): Promise<void> {
    const tempPath = `${path}.tmp`;
    await this.write(tempPath, data);
    try {
      await this.filesystem.rename({ from: tempPath, to: path, directory: this.directory });
    } catch (error) {
      // The native rename implementation does not replace an existing file.
      // Keep the old pointer until the full temp write has succeeded, then make
      // the smallest possible replacement window (delete + same-directory move).
      if (!await this.exists(path)) throw error;
      await this.filesystem.deleteFile({ path, directory: this.directory });
      await this.filesystem.rename({ from: tempPath, to: path, directory: this.directory });
    }
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await this.filesystem.stat({ path, directory: this.directory });
      return true;
    } catch (error) {
      if (isMissingFileError(error)) return false;
      throw error;
    }
  }
}

function isMissingFileError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /does not exist|not found|no such file/i.test(message);
}

/** ContentConnectivity implemented over the Capacitor Network plugin (wifi/cellular/none). */
export class CapacitorNetworkConnectivity implements ContentConnectivity {
  constructor(private readonly network: NetworkPluginLike) {}

  async getConnectionType(): Promise<ContentConnectionType> {
    const status = await this.network.getStatus();
    return status.connected ? status.connectionType : 'none';
  }
}

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface PublicWorldMetadata {
  worldVersion: string;
  chunkSize: number;
  worldChunks: number;
  worldSize: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

/** Same file the web app fetches as public/world/index.json (works from src/ and dist/). */
const DEFAULT_WORLD_INDEX = fileURLToPath(new URL('../../web/public/world/index.json', import.meta.url));

/** Read and cross-check multiplayer dimensions from the public world index shipped by the web app. */
export function loadWorldMetadata(indexPath = process.env.WORLD_INDEX_PATH ?? DEFAULT_WORLD_INDEX): PublicWorldMetadata {
  let raw: Partial<PublicWorldMetadata>;
  try {
    raw = JSON.parse(readFileSync(resolve(indexPath), 'utf8')) as Partial<PublicWorldMetadata>;
  } catch (error) {
    throw new Error(`Unable to read world index ${indexPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const { worldVersion, chunkSize, worldChunks, worldSize, bounds } = raw;
  const expectedSize = (chunkSize ?? 0) * (worldChunks ?? 0);
  const half = expectedSize / 2;
  if (
    typeof worldVersion !== 'string' || worldVersion.trim() === '' || worldVersion.length > 128 ||
    !Number.isFinite(chunkSize) || (chunkSize ?? 0) <= 0 ||
    !Number.isInteger(worldChunks) || (worldChunks ?? 0) <= 0 || (worldChunks ?? 0) > 256 ||
    worldSize !== expectedSize || !bounds ||
    bounds.minX !== -half || bounds.maxX !== half || bounds.minZ !== -half || bounds.maxZ !== half
  ) {
    throw new Error(`Invalid world metadata in world index ${indexPath}`);
  }
  return { worldVersion, chunkSize: chunkSize!, worldChunks: worldChunks!, worldSize, bounds };
}

export const WORLD_METADATA = loadWorldMetadata();
export const WORLD_VERSION = WORLD_METADATA.worldVersion;

/** HTTP rejection for a world-version mismatch: 400 for a bad create request, 409 for a join mismatch. */
export interface WorldVersionRejection {
  status: 400 | 409;
  error: 'world-version-required' | 'world-version';
  message: string;
}

/** Validate a create (`roomVersion === null`) or join request against the room's immutable world version. */
export function checkWorldVersion(
  requested: string | null,
  roomVersion: string | null,
  supported: string = WORLD_VERSION,
): WorldVersionRejection | null {
  if (requested === null) {
    return { status: 400, error: 'world-version-required', message: 'Perbarui konten dulu: worldVersion wajib dikirim.' };
  }
  if (roomVersion !== null && requested !== roomVersion) {
    return { status: 409, error: 'world-version', message: `Perbarui konten dulu: room memakai worldVersion ${roomVersion}.` };
  }
  if (requested !== supported) {
    return { status: 400, error: 'world-version-required', message: `Perbarui konten dulu: worldVersion ${requested} tidak didukung server ini.` };
  }
  return null;
}

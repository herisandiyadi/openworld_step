/**
 * Map pack: dataset peta geo (world-<name>/) jadi content pack yang bisa di-stage
 * lewat sistem content update yang ada (ContentUpdateManager).
 *
 * Manifest peta:
 *   id: map-<name>, version = worldVersion string dari index.json
 *   files: semua file world-<name>/ (chunks, navmesh, map.png, index.json, lanes)
 *   worldVersion: angka=3 (game cek supportedWorldVersions: [2]; hash map 32-chunk di worldVersion=3 supaya game lama menolak)
 *
 * Latest pointer:
 *   { manifestUrl, contentBaseUrl } -> sesuai LatestSchema di content/updates.ts
 */
import { createHash, createPrivateKey, sign as cryptoSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const WEB_ROOT = resolve(import.meta.dirname, '..', '..');
const PUBLIC_ROOT = join(WEB_ROOT, 'public');

function existsDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch { return false; }
}

/** File/size/sha256 semua file di bawah root, rekursif. */
async function listFiles(dir, base = dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await listFiles(full, base, out);
    else out.push({ abs: full, rel: relative(base, full).split('\\').join('/') });
  }
  return out;
}

/** Canonical manifest JSON (keys sorted, no signature) - match src/content/canonical.ts */
function canonicalManifestJson(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(item => canonicalManifestJson(item)).join(',')}]`;
  const entries = Object.keys(obj)
    .filter(key => !(key === 'signature'))
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalManifestJson(obj[key])}`);
  return `{${entries.join(',')}}`;
}

export async function buildMapPack(worldName, { keyId, privateKey, appVersion = '0.1.0' }) {
  const worldDir = join(PUBLIC_ROOT, `world-${worldName}`);
  if (!existsDir(worldDir)) throw new Error(`world dir not found: ${worldDir}`);

  const index = JSON.parse(await readFile(join(worldDir, 'index.json'), 'utf8'));
  const files = [];
  for (const { abs, rel } of await listFiles(worldDir)) {
    const data = await readFile(abs);
    files.push({
      path: `world-${worldName}/${rel}`,
      size: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
    });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));

  const packId = `map-${worldName}`;
  const version = `map-${index.worldVersion}`;
  const unsigned = {
    id: packId,
    version,
    minAppVersion: appVersion,
    worldVersion: 3,
    files: files.map(({ path, size, sha256 }) => ({ path, size, sha256 })),
  };

  // Sign manifest
  const canonical = Buffer.from(canonicalManifestJson(unsigned));
  const privateKeyObj = createPrivateKey(privateKey);
  const signature = cryptoSign(null, canonical, privateKeyObj);

  const manifest = {
    ...unsigned,
    signature: {
      algorithm: 'Ed25519',
      keyId,
      value: signature.toString('base64'),
    },
  };

  const packDir = join(PUBLIC_ROOT, 'maps-manifest', worldName);
  await mkdir(packDir, { recursive: true });
  await writeFile(join(packDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // Also write latest.json pointer for this pack
  // contentBaseUrl serves files from same directory (pack files are already in world-<name>/ via public)
  // But content system expects all files under a pack root. We'll use PUBLIC_ROOT as base and full paths.
  await writeFile(
    join(PUBLIC_ROOT, 'maps-manifest', `${worldName}.json`),
    JSON.stringify({
      manifestUrl: `maps-manifest/${worldName}/manifest.json`,
      contentBaseUrl: `../`, // resolve dari maps-manifest/<name>/manifest.json -> public/
    }, null, 2),
  );
  await writeFile(
    join(PUBLIC_ROOT, 'maps-manifest', 'latest.json'),
    JSON.stringify({
      manifestUrl: `maps-manifest/${worldName}/manifest.json`,
      contentBaseUrl: `../`,
    }, null, 2),
  );

  return { manifest, packDir };
}

export async function buildAllMapsManifest({ keyId, privateKey }) {
  const maps = [];
  for (const entry of await readdir(PUBLIC_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('world-')) continue;
    const name = entry.name.slice(6);
    maps.push(await buildMapPack(name, { keyId, privateKey }));
  }
  return maps;
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const keyId = process.env.CONTENT_SIGNING_KEY_ID;
  const privateKey = process.env.CONTENT_SIGNING_PRIVATE_KEY || (process.env.CONTENT_SIGNING_PRIVATE_KEY_FILE && readFileSync(process.env.CONTENT_SIGNING_PRIVATE_KEY_FILE, 'utf8'));
  if (!keyId || !privateKey) {
    console.error('Usage: CONTENT_SIGNING_KEY_ID=... CONTENT_SIGNING_PRIVATE_KEY=... node tools/geo/map-pack.mjs');
    process.exit(1);
  }
  await buildAllMapsManifest({ keyId, privateKey });
  console.log('All map packs built.');
}
/**
 * `npm run content:pack` – compute SHA-256 hashes for all listed files,
 * update manifest.json, validate the pack, optionally sign it with Ed25519,
 * and report the result.
 *
 * Usage:  vite-node tools/content/pack.ts [pack-dir]
 *         pack-dir defaults to web/content/base
 *
 * Signing: set CONTENT_SIGNING_KEY_ID and one of:
 *   CONTENT_SIGNING_PRIVATE_KEY (inline PEM)
 *   CONTENT_SIGNING_PRIVATE_KEY_FILE (path to private key)
 */

import { createHash, createPrivateKey, sign as cryptoSign } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { canonicalManifestJson } from '../../src/content/canonical';
import { validatePack } from './validate';
import type { ManifestDef } from '../../src/content/schema';

const packDir = resolve(process.argv[2] ?? join(import.meta.dirname, '../../content/base'));
console.log(`\n📦  Packing content at: ${packDir}\n`);

function readJson(filePath: string): unknown {
  const text = readFileSync(filePath, 'utf8');
  try { return JSON.parse(text); }
  catch { throw new Error(`Cannot parse JSON: ${filePath}`); }
}

function sha256file(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

export interface SigningConfig {
  keyId: string;
  privateKey: string;
}

export function resolveSigningConfig(env: Record<string, string | undefined>): SigningConfig | null {
  const keyId = env.CONTENT_SIGNING_KEY_ID;
  const inlineKey = env.CONTENT_SIGNING_PRIVATE_KEY;
  const keyFile = env.CONTENT_SIGNING_PRIVATE_KEY_FILE;

  if (!keyId && !inlineKey && !keyFile) return null;
  if (!keyId) throw new Error('key id required: set CONTENT_SIGNING_KEY_ID when signing is configured');
  if (inlineKey && keyFile) throw new Error('Specify only one of CONTENT_SIGNING_PRIVATE_KEY or CONTENT_SIGNING_PRIVATE_KEY_FILE');

  return {
    keyId,
    privateKey: inlineKey ?? readFileSync(keyFile!, 'utf8'),
  };
}

export function signManifest(manifest: Record<string, unknown>, config: SigningConfig): ManifestDef {
  const canonical = Buffer.from(canonicalManifestJson(manifest));
  const privateKey = createPrivateKey(config.privateKey);
  const signature = cryptoSign(null, canonical, privateKey);
  return {
    ...manifest,
    signature: {
      algorithm: 'Ed25519',
      keyId: config.keyId,
      value: signature.toString('base64'),
    },
  } as ManifestDef;
}

const manifestPath = join(packDir, 'manifest.json');
let manifest = readJson(manifestPath) as Record<string, unknown>;
const manifestData = manifest as { files?: { path: string; sha256: string; size: number }[] };
if (!Array.isArray(manifestData.files)) {
  console.error('❌  manifest.json must have a "files" array.');
  process.exit(1);
}

let changed = 0;
for (const entry of manifestData.files) {
  const absPath = join(packDir, entry.path);
  try {
    const hash = sha256file(absPath);
    const size = statSync(absPath).size;
    if (entry.sha256 !== hash || entry.size !== size) {
      entry.sha256 = hash;
      entry.size = size;
      changed++;
    }
  } catch {
    console.error(`❌  File missing: ${entry.path}`);
    process.exit(1);
  }
}

const signingConfig = resolveSigningConfig(process.env as Record<string, string | undefined>);
if (signingConfig) {
  console.log(`🔑  Signing with key ID: ${signingConfig.keyId}`);
  manifest = signManifest(manifest, signingConfig);
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

const raw: Record<string, unknown> = {
  manifest,
  npcs: readJson(join(packDir, 'npcs.json')),
  quests: readJson(join(packDir, 'quests.json')),
  regions: readJson(join(packDir, 'regions.json')),
  shops: readJson(join(packDir, 'shops.json')),
  items: readJson(join(packDir, 'items.json')),
};
try { raw.economy = readJson(join(packDir, 'economy.json')); } catch { /* optional */ }
try { raw.fishing = readJson(join(packDir, 'fishing.json')); } catch { /* optional */ }

const result = validatePack(raw);
if (!result.ok) {
  console.error('❌  Validation failed:\n');
  result.violations.forEach((v) => console.error('  •', v));
  console.error('');
  process.exit(1);
}
console.log('✅  Validation passed.');
console.log(`📝  manifest.json updated (${changed} file${changed === 1 ? '' : 's'} changed).\n`);


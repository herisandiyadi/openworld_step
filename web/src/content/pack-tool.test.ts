import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalManifestJson } from './canonical';
import { resolveSigningConfig, signManifest } from '../../tools/content/pack';

function keys() {
  const pair = generateKeyPairSync('ed25519');
  return {
    privatePem: pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    publicKey: pair.publicKey,
  };
}

const manifest = {
  id: 'update', version: '1.0.0', minAppVersion: '0.1.0', worldVersion: 2,
  files: [{ path: 'a.json', sha256: 'a'.repeat(64), size: 1 }],
};

describe('content pack signing', () => {
  it('signs the canonical manifest with Ed25519 and does not expose private material', () => {
    const { privatePem, publicKey } = keys();
    const signed = signManifest(manifest, { keyId: 'release-key', privateKey: privatePem });
    expect(signed.signature?.keyId).toBe('release-key');
    expect(JSON.stringify(signed)).not.toContain(privatePem);
    expect(verify(
      null,
      Buffer.from(canonicalManifestJson(signed)),
      publicKey,
      Buffer.from(signed.signature!.value, 'base64'),
    )).toBe(true);
  });

  it('reads private key from an environment value', () => {
    const { privatePem } = keys();
    expect(resolveSigningConfig({
      CONTENT_SIGNING_KEY_ID: 'release-key',
      CONTENT_SIGNING_PRIVATE_KEY: privatePem,
    })).toEqual({ keyId: 'release-key', privateKey: privatePem });
  });

  it('reads private key from a file without copying it into the pack', () => {
    const { privatePem } = keys();
    const dir = mkdtempSync(join(tmpdir(), 'content-signing-'));
    const file = join(dir, 'private.pem');
    writeFileSync(file, privatePem, { mode: 0o600 });
    const config = resolveSigningConfig({
      CONTENT_SIGNING_KEY_ID: 'release-key',
      CONTENT_SIGNING_PRIVATE_KEY_FILE: file,
    });
    expect(config?.privateKey).toBe(readFileSync(file, 'utf8'));
  });

  it('refuses ambiguous or incomplete signing configuration', () => {
    expect(() => resolveSigningConfig({ CONTENT_SIGNING_PRIVATE_KEY: 'secret' })).toThrow(/key id/i);
    expect(() => resolveSigningConfig({
      CONTENT_SIGNING_KEY_ID: 'key', CONTENT_SIGNING_PRIVATE_KEY: 'one', CONTENT_SIGNING_PRIVATE_KEY_FILE: 'two',
    })).toThrow(/only one/i);
  });
});

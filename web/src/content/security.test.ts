import { describe, expect, it } from 'vitest';
import type { ManifestDef } from './schema';
import {
  canonicalizeManifest,
} from './canonical';
import {
  sha256Hex,
  verifyContentFile,
  verifyManifestSignature,
  type ContentPublicKeyProvider,
} from './security';

const encoder = new TextEncoder();

async function signedManifest(): Promise<{
  manifest: ManifestDef;
  publicKeys: ContentPublicKeyProvider;
}> {
  const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
  const unsigned = {
    id: 'update-october',
    version: '1.1.0',
    minAppVersion: '0.1.0',
    worldVersion: 2,
    files: [{ path: 'npcs.json', sha256: await sha256Hex(encoder.encode('{"ok":true}')), size: 11 }],
  };
  const signature = new Uint8Array(
    await crypto.subtle.sign('Ed25519', keys.privateKey, canonicalizeManifest(unsigned) as unknown as BufferSource),
  );
  const manifest = {
    ...unsigned,
    signature: {
      algorithm: 'Ed25519' as const,
      keyId: 'release-2026',
      value: btoa(String.fromCharCode(...signature)),
    },
  } as ManifestDef;
  return {
    manifest,
    publicKeys: {
      getPublicKey: async (keyId: string) => keyId === 'release-2026' ? publicKey : null,
    },
  };
}

describe('downloaded content security', () => {
  it('canonicalizes manifest keys and ignores the signature field', () => {
    const first = canonicalizeManifest({ b: 2, a: { d: 4, c: 3 }, signature: { value: 'ignored' } });
    const second = canonicalizeManifest({ a: { c: 3, d: 4 }, b: 2 });
    expect(new TextDecoder().decode(first)).toBe('{"a":{"c":3,"d":4},"b":2}');
    expect(first).toEqual(second);
  });

  it('verifies an Ed25519 manifest through the public-key provider', async () => {
    const { manifest, publicKeys } = await signedManifest();
    await expect(verifyManifestSignature(manifest, publicKeys)).resolves.toBeUndefined();
  });

  it('rejects a content file changed by one byte', async () => {
    const { manifest } = await signedManifest();
    const original = encoder.encode('{"ok":true}');
    const tampered = original.slice();
    tampered[5] = tampered[5]! ^ 1;

    await expect(verifyContentFile(manifest.files[0]!, original)).resolves.toBeUndefined();
    await expect(verifyContentFile(manifest.files[0]!, tampered)).rejects.toThrow(/sha-256/i);
  });
});

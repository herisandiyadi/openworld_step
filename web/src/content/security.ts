import type { ManifestDef } from './schema';
import { canonicalizeManifest } from './canonical';

export interface ContentPublicKeyProvider {
  getPublicKey(keyId: string): Promise<Uint8Array | null> | Uint8Array | null;
}

/** DOM lib types want ArrayBuffer-backed views; Uint8Array is structurally fine. */
const asBufferSource = (data: Uint8Array): BufferSource => data as unknown as BufferSource;

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', asBufferSource(data));
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

export async function verifyContentFile(
  expected: { path: string; sha256: string; size: number },
  data: Uint8Array,
): Promise<void> {
  if (data.byteLength !== expected.size) {
    throw new Error(
      `File size mismatch for ${expected.path}: expected ${expected.size} bytes, got ${data.byteLength}`,
    );
  }
  const actualHash = await sha256Hex(data);
  if (actualHash !== expected.sha256) {
    throw new Error(
      `SHA-256 mismatch for ${expected.path}: expected ${expected.sha256}, got ${actualHash}`,
    );
  }
}

export async function verifyManifestSignature(
  manifest: ManifestDef,
  publicKeys: ContentPublicKeyProvider,
): Promise<void> {
  if (!manifest.signature) {
    throw new Error(`Manifest ${manifest.id}@${manifest.version} is not signed`);
  }
  if (manifest.signature.algorithm !== 'Ed25519') {
    throw new Error(`Unsupported signature algorithm: ${manifest.signature.algorithm}`);
  }
  const keyBytes = await publicKeys.getPublicKey(manifest.signature.keyId);
  if (!keyBytes) {
    throw new Error(`Unknown public key ID: ${manifest.signature.keyId}`);
  }

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    asBufferSource(keyBytes),
    { name: 'Ed25519' },
    false,
    ['verify'],
  );

  const sigBytes = Uint8Array.from(atob(manifest.signature.value), (c) => c.charCodeAt(0));
  const payload = canonicalizeManifest(manifest);

  const ok = await crypto.subtle.verify('Ed25519', cryptoKey, asBufferSource(sigBytes), asBufferSource(payload));
  if (!ok) {
    throw new Error(`Signature verification failed for manifest ${manifest.id}@${manifest.version}`);
  }
}

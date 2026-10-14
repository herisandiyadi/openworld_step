/**
 * Deterministic (RFC 8785-style) canonical JSON used by both the runtime
 * verifier and the CLI signing tool.  Keys are sorted, arrays keep order, and
 * the top-level `signature` field is excluded because it covers the rest.
 */

const encoder = new TextEncoder();

export function canonicalManifestJson(value: unknown): string {
  return stringifyCanonical(value, true);
}

export function canonicalizeManifest(value: unknown): Uint8Array {
  return encoder.encode(canonicalManifestJson(value));
}

function stringifyCanonical(value: unknown, isRoot: boolean): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stringifyCanonical(item, false)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .filter((key) => !(isRoot && key === 'signature'))
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stringifyCanonical(record[key], false)}`);
  return `{${entries.join(',')}}`;
}

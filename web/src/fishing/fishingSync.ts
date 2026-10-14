/**
 * Compact wire codec for per-player fishing state.
 *
 * Layout (8 bytes, big-endian):
 *   [0]    version  u8   = FISHING_SYNC_VERSION
 *   [1]    phase    u8   idle=0 cast=1 wait=2 bite=3 reel=4
 *   [2..3] spotIdx  u16
 *   [4..5] bobberX  i16  metres × 100 (±327.67 m, ±0.01 m precision)
 *   [6..7] bobberZ  i16  metres × 100
 */

export const FISHING_SYNC_VERSION = 1;

const PHASE_NAMES = ['idle', 'cast', 'wait', 'bite', 'reel'] as const;
export type FishingAnimPhase = (typeof PHASE_NAMES)[number];

export interface FishingSyncState {
  readonly phase: FishingAnimPhase;
  readonly spotIndex: number;
  readonly bobberX: number;
  readonly bobberZ: number;
}

export interface RemoteFishingRecord {
  readonly playerId: number;
  readonly sequence: number;
  readonly state: FishingSyncState;
}

export type FishingSyncDecodeError = 'length' | 'version' | 'phase' | 'bounds';
export type FishingSyncDecodeResult =
  | { readonly ok: true; readonly state: FishingSyncState }
  | { readonly ok: false; readonly error: FishingSyncDecodeError };

const PAYLOAD_BYTES = 8;
const COORD_SCALE = 100;

export function encodeFishingSync(state: FishingSyncState): Uint8Array {
  if (!Number.isFinite(state.bobberX) || !Number.isFinite(state.bobberZ)) {
    throw new RangeError('Bobber coordinates must be finite numbers');
  }
  const phaseId = PHASE_NAMES.indexOf(state.phase);
  if (phaseId < 0) throw new RangeError(`Unknown fishing phase: ${state.phase}`);
  const coordinate = (value: number): number =>
    Math.max(-0x8000, Math.min(0x7fff, Math.round(value * COORD_SCALE)));
  const buf = new ArrayBuffer(PAYLOAD_BYTES);
  const view = new DataView(buf);
  view.setUint8(0, FISHING_SYNC_VERSION);
  view.setUint8(1, phaseId);
  view.setUint16(2, Math.max(0, Math.min(0xffff, state.spotIndex)));
  view.setInt16(4, coordinate(state.bobberX));
  view.setInt16(6, coordinate(state.bobberZ));
  return new Uint8Array(buf);
}

export function decodeFishingSync(bytes: Uint8Array): FishingSyncDecodeResult {
  if (bytes.byteLength !== PAYLOAD_BYTES) return { ok: false, error: 'length' };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(0) !== FISHING_SYNC_VERSION) return { ok: false, error: 'version' };
  const phaseId = view.getUint8(1);
  const phaseName = PHASE_NAMES[phaseId];
  if (!phaseName) return { ok: false, error: 'phase' };
  const spotIndex = view.getUint16(2);
  const bobberX = view.getInt16(4) / COORD_SCALE;
  const bobberZ = view.getInt16(6) / COORD_SCALE;
  return { ok: true, state: { phase: phaseName, spotIndex, bobberX, bobberZ } };
}

/**
 * Returns a merged record when `incoming.sequence` is strictly newer, or null/the
 * existing record when it is stale. Safe to call with null `current` on first reception.
 */
export function remoteFishingState(
  current: RemoteFishingRecord | null,
  incoming: RemoteFishingRecord,
): RemoteFishingRecord {
  if (current !== null && isNewerSequence(current.sequence, incoming.sequence) <= 0) {
    return current;
  }
  return incoming;
}

/** Sequence number comparison with 16-bit wrap-around tolerance (±32767). */
function isNewerSequence(a: number, b: number): number {
  const diff = (b - a + 65536) % 65536;
  if (diff === 0) return 0;
  return diff < 32768 ? 1 : -1;
}

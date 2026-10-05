import { lampPositionsFromMatrices, type LampPosition } from './streetLights';

const byChunk = new Map<string, LampPosition[]>();

/** Replace a chunk's registered streetlamp instance positions after it streams in. */
export function replaceChunkStreetLamps(chunkKey: string, matrices: ArrayLike<number>): void {
  byChunk.set(chunkKey, lampPositionsFromMatrices(matrices));
}

/** Remove lamp metadata along with an unloaded chunk. */
export function removeChunkStreetLamps(chunkKey: string): void {
  byChunk.delete(chunkKey);
}

/** Return a flat snapshot; callers cannot mutate the registry's per-chunk arrays. */
export function allStreetLampPositions(): LampPosition[] {
  return [...byChunk.values()].flatMap((positions) => positions.map((position) => ({ ...position })));
}

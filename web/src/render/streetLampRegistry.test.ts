import { afterEach, describe, expect, it } from 'vitest';
import { allStreetLampPositions, removeChunkStreetLamps, replaceChunkStreetLamps } from './streetLampRegistry';

afterEach(() => {
  removeChunkStreetLamps('0_0');
  removeChunkStreetLamps('1_0');
});

describe('streetLampRegistry', () => {
  it('registers world positions from each instanced chunk and returns a stable snapshot', () => {
    replaceChunkStreetLamps('0_0', new Float32Array([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 4, -8, 1,
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -12, 4, 6, 1,
    ]));
    const positions = allStreetLampPositions();
    expect(positions).toHaveLength(2);
    expect(positions.map(({ x, y, z }) => [x, y, z])).toEqual([[3, 4, -8], [-12, 4, 6]]);
    positions.pop();
    expect(allStreetLampPositions()).toHaveLength(2);
  });

  it('replaces a streamed chunk snapshot and removes it when the chunk unloads', () => {
    replaceChunkStreetLamps('1_0', new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 8, 4, 2, 1]));
    replaceChunkStreetLamps('1_0', new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 9, 4, 2, 1]));
    expect(allStreetLampPositions().map(({ x }) => x)).toContain(9);
    expect(allStreetLampPositions().map(({ x }) => x)).not.toContain(8);
    removeChunkStreetLamps('1_0');
    expect(allStreetLampPositions()).toHaveLength(0);
  });
});

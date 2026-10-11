import { describe, expect, it } from 'vitest';
import { createPoiMarkerAssets, createPoiMarkerGroup } from './poiMarkers';

describe('POI marker meshes', () => {
  it('creates lightweight instanced markers for each streamed POI kind', () => {
    const assets = createPoiMarkerAssets();
    const result = createPoiMarkerGroup({
      fishingSpots: [{ id: 'fish_0', x: 1, y: 0, z: 2, yaw: 0, water: 'lake' }],
      trashBins: [{ id: 'bin_0', x: 3, y: 0, z: 4 }],
      fishStalls: [{ id: 'stall_0', x: 5, y: 0, z: 6, water: 'lake' }],
    }, assets);

    expect(result.group.getObjectByName('fishing_spots')).toBeDefined();
    expect(result.group.getObjectByName('trash_bins')).toBeDefined();
    expect(result.group.getObjectByName('fish_stalls')).toBeDefined();
    expect(result.group.children.length).toBeLessThanOrEqual(6);
    expect(result.group.getObjectByName('trash_bin_mesh')).toMatchObject({ count: 1 });
    result.dispose();
    assets.dispose();
  });
});

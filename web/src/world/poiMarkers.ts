import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  MeshBasicMaterial,
  SphereGeometry,
  Matrix4,
  type Material,
} from 'three';
import type { FishingSpot, FishStallPoint, TrashBinPoint } from './worldSpec';

export interface PoiMarkerPoint {
  x: number;
  y: number;
  z: number;
}

export interface PoiMarkerData {
  fishingSpots: (FishingSpot & PoiMarkerPoint)[];
  trashBins: (TrashBinPoint & PoiMarkerPoint)[];
  fishStalls: (FishStallPoint & PoiMarkerPoint)[];
}

export interface PoiMarkerAssets {
  rodGeometry: BoxGeometry;
  bobberGeometry: SphereGeometry;
  binGeometry: CylinderGeometry;
  stallGeometry: BoxGeometry;
  roofGeometry: BoxGeometry;
  fishingMaterial: MeshBasicMaterial;
  binMaterial: MeshBasicMaterial;
  stallMaterial: MeshBasicMaterial;
  roofMaterial: MeshBasicMaterial;
  dispose: () => void;
}

export interface PoiMarkerGroup {
  group: Group;
  dispose: () => void;
}

/** Shared primitive assets; each chunk only creates bounded instanced draw calls. */
export function createPoiMarkerAssets(): PoiMarkerAssets {
  const rodGeometry = new BoxGeometry(0.07, 1.6, 0.07);
  const bobberGeometry = new SphereGeometry(0.12, 8, 6);
  const binGeometry = new CylinderGeometry(0.28, 0.32, 0.7, 8);
  const stallGeometry = new BoxGeometry(1.4, 0.8, 0.7);
  const roofGeometry = new BoxGeometry(1.7, 0.12, 0.9);
  const fishingMaterial = new MeshBasicMaterial({ color: '#a16207' });
  const binMaterial = new MeshBasicMaterial({ color: '#64748b' });
  const stallMaterial = new MeshBasicMaterial({ color: '#b45309' });
  const roofMaterial = new MeshBasicMaterial({ color: '#2563eb' });

  return {
    rodGeometry,
    bobberGeometry,
    binGeometry,
    stallGeometry,
    roofGeometry,
    fishingMaterial,
    binMaterial,
    stallMaterial,
    roofMaterial,
    dispose: () => {
      for (const resource of [rodGeometry, bobberGeometry, binGeometry, stallGeometry, roofGeometry]) resource.dispose();
      for (const material of [fishingMaterial, binMaterial, stallMaterial, roofMaterial]) material.dispose();
    },
  };
}

function addInstances<T extends Material>(
  parent: Group,
  name: string,
  geometry: BoxGeometry | CylinderGeometry | SphereGeometry,
  material: T,
  points: readonly PoiMarkerPoint[],
  yOffset: number,
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, points.length);
  mesh.name = name;
  mesh.matrixAutoUpdate = false;
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (!point) continue;
    mesh.setMatrixAt(i, new Matrix4().makeTranslation(point.x, point.y + yOffset, point.z));
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  parent.add(mesh);
  return mesh;
}

/** Build a marker group from one streamed chunk's POIs. */
export function createPoiMarkerGroup(data: PoiMarkerData, assets: PoiMarkerAssets): PoiMarkerGroup {
  const group = new Group();
  group.name = 'poi_markers';

  if (data.fishingSpots.length > 0) {
    const fishing = new Group();
    fishing.name = 'fishing_spots';
    addInstances(fishing, 'fishing_rods', assets.rodGeometry, assets.fishingMaterial, data.fishingSpots, 0.8);
    addInstances(fishing, 'fishing_bobbers', assets.bobberGeometry, assets.fishingMaterial, data.fishingSpots, 0.04);
    group.add(fishing);
  }

  if (data.trashBins.length > 0) {
    const bins = new Group();
    bins.name = 'trash_bins';
    addInstances(bins, 'trash_bin_mesh', assets.binGeometry, assets.binMaterial, data.trashBins, 0.35);
    group.add(bins);
  }

  if (data.fishStalls.length > 0) {
    const stalls = new Group();
    stalls.name = 'fish_stalls';
    addInstances(stalls, 'fish_stall_counter', assets.stallGeometry, assets.stallMaterial, data.fishStalls, 0.4);
    addInstances(stalls, 'fish_stall_roof', assets.roofGeometry, assets.roofMaterial, data.fishStalls, 0.88);
    group.add(stalls);
  }

  return {
    group,
    dispose: () => {
      // Geometry and materials are shared by every streamed chunk and are disposed by the streamer.
    },
  };
}

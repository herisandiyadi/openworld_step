import type { BuiltChunk, ChunkLoadRequest, ChunkWorkerResponse } from './chunkProtocol';
import { PROP_IDS, type PropId } from './propSpec';
import { buildTerrainBuffers } from './terrainMesh';
import { type ChunkData, WORLD_DATA_VERSION } from './worldSpec';

/**
 * Chunk streaming worker: fetch JSON, validate, build terrain buffers and instance matrices.
 * The main thread only wraps the transferred arrays in BufferAttributes.
 */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ChunkLoadRequest>) => void) | null;
  postMessage(message: ChunkWorkerResponse, transfer?: Transferable[]): void;
};

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function build(key: string, data: ChunkData, started: number): BuiltChunk {
  if (data.version !== WORLD_DATA_VERSION) throw new Error(`chunk ${key}: version ${data.version} != ${WORLD_DATA_VERSION}`);
  const terrain = buildTerrainBuffers(data);

  const buildingMatrices = new Float32Array(data.buildings.length * 16);
  const buildingColors = new Float32Array(data.buildings.length * 3);
  data.buildings.forEach((building, index) => {
    const sx = building.maxX - building.minX;
    const sy = building.topY - building.baseY;
    const sz = building.maxZ - building.minZ;
    buildingMatrices.set(
      [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, building.minX + sx / 2, building.baseY + sy / 2, building.minZ + sz / 2, 1],
      index * 16,
    );
    const n = Number.parseInt(building.color.slice(1), 16);
    buildingColors.set([toLinear(((n >> 16) & 255) / 255), toLinear(((n >> 8) & 255) / 255), toLinear((n & 255) / 255)], index * 3);
  });

  const props: BuiltChunk['props'] = [];
  for (const id of PROP_IDS) {
    const placements = data.props.filter((prop) => prop.id === id);
    if (placements.length === 0) continue;
    const matrices = new Float32Array(placements.length * 16);
    placements.forEach((prop, index) => {
      const cos = Math.cos(prop.yaw);
      const sin = Math.sin(prop.yaw);
      matrices.set([cos, 0, -sin, 0, 0, 1, 0, 0, sin, 0, cos, 0, prop.x, prop.y, prop.z, 1], index * 16);
    });
    props.push({ id: id as PropId, matrices });
  }

  return {
    key,
    cx: data.cx,
    cz: data.cz,
    district: data.district,
    heights: Int32Array.from(data.heights),
    surface: Uint8Array.from(data.surface),
    terrain,
    buildingMatrices,
    buildingColors,
    props,
    fishingSpots: data.fishingSpots,
    trashBins: data.trashBins,
    fishStalls: data.fishStalls,
    colliders: data.colliders,
    workerMs: performance.now() - started,
  };
}

scope.onmessage = (event) => {
  const request = event.data;
  if (request.type !== 'load') return;
  const started = performance.now();
  fetch(request.url)
    .then((response) => {
      if (!response.ok) throw new Error(`${response.status} ${request.url}`);
      return response.json() as Promise<ChunkData>;
    })
    .then((data) => {
      const chunk = build(request.key, data, started);
      const transfer: Transferable[] = [
        chunk.heights.buffer,
        chunk.surface.buffer,
        chunk.terrain.positions.buffer,
        chunk.terrain.normals.buffer,
        chunk.terrain.colors.buffer,
        chunk.buildingMatrices.buffer,
        chunk.buildingColors.buffer,
        ...chunk.props.map((prop) => prop.matrices.buffer),
      ];
      scope.postMessage({ type: 'loaded', chunk }, transfer);
    })
    .catch((error: unknown) => {
      scope.postMessage({ type: 'error', key: request.key, message: error instanceof Error ? error.message : String(error) });
    });
};
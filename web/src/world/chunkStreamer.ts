import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
} from 'three';
import { installWindowShader } from '../render/windowShader';
import { replaceChunkStreetLamps, removeChunkStreetLamps } from '../render/streetLampRegistry';
import type { BuiltChunk, ChunkLoadRequest, ChunkWorkerResponse } from './chunkProtocol';
import type { PropId } from './propSpec';
import { type ChunkCoord, chunkDistance, planStreaming, withinRadius } from './streaming';
import { chunkCoord, chunkKey, inWorld, LOAD_RADIUS, sampleChunkHeight, UNLOAD_RADIUS } from './worldSpec';
import { loadNavigationTile, unloadNavigationTile } from './navigation';
import { streamingPolicyFor } from '../optimization/streamingPolicy';
import { rebuildCollision, worldState } from './worldState';
import { createPoiMarkerAssets, createPoiMarkerGroup, type PoiMarkerAssets } from './poiMarkers';

export interface PropPart {
  geometry: BufferGeometry;
  material: Material | Material[];
  /** Mesh transform relative to the GLB root (includes the dequantisation transform). */
  matrix: Matrix4;
}

export type PropParts = Partial<Record<PropId, PropPart[]>>;

export interface StreamStats {
  loaded: number;
  pending: number;
  loads: number;
  unloads: number;
  /** Main-thread time spent turning a worker result into scene objects. */
  lastApplyMs: number;
  maxApplyMs: number;
  maxWorkerMs: number;
}

interface ChunkView {
  key: string;
  coord: ChunkCoord;
  group: Group;
  props: Group;
  poiMarkers: Group | null;
  /** Objects tap-to-move may raycast (terrain + buildings). */
  pickables: Object3D[];
  dispose: () => void;
}

/** Props are drawn only near the player (cheap distance LOD); terrain + buildings out to LOAD_RADIUS. */
const PROP_RADIUS = 1;

/**
 * Streams chunk JSON through a worker, applies at most one built chunk per frame, and disposes
 * GPU resources of chunks that leave UNLOAD_RADIUS. Shared materials/geometries live as long as the streamer.
 */
export class ChunkStreamer {
  readonly root = new Group();
  readonly stats: StreamStats = { loaded: 0, pending: 0, loads: 0, unloads: 0, lastApplyMs: 0, maxApplyMs: 0, maxWorkerMs: 0 };
  readonly pickables: Object3D[] = [];

  private readonly worker: Worker;
  private readonly views = new Map<string, ChunkView>();
  private readonly pending = new Set<string>();
  private queue: { key: string }[] = [];
  private readonly ready: BuiltChunk[] = [];
  private center: ChunkCoord = { cx: Number.NaN, cz: Number.NaN };
  private readyFired = false;
  private readonly streamingPolicy = streamingPolicyFor('medium');
  private readonly terrainMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  private readonly buildingMaterial = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.78, metalness: 0.04 });
  private readonly unitBox = new BoxGeometry(1, 1, 1);
  private readonly scratch = new Matrix4();
  private readonly placement = new Matrix4();
  private readonly poiMarkerAssets: PoiMarkerAssets = createPoiMarkerAssets();

  constructor(
    private readonly parts: PropParts,
    private readonly chunkUrl: (key: string) => string,
    private readonly onInitialReady: () => void,
    private readonly onError: (message: string) => void,
  ) {
    this.root.name = 'world_chunks';
    installWindowShader(this.buildingMaterial);
    this.worker = new Worker(new URL('./chunkWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<ChunkWorkerResponse>) => {
      const message = event.data;
      if (message.type === 'error') {
        this.pending.delete(message.key);
        this.onError(message.message);
        return;
      }
      this.ready.push(message.chunk);
      this.stats.maxWorkerMs = Math.max(this.stats.maxWorkerMs, message.chunk.workerMs);
    };
  }

  update(x: number, z: number): void {
    const cx = chunkCoord(x);
    const cz = chunkCoord(z);
    let changed = false;
    if (cx !== this.center.cx || cz !== this.center.cz) {
      this.center = { cx, cz };
      const plan = planStreaming(this.center, this.views.keys(), this.pending, this.streamingPolicy);
      for (const key of plan.unload) this.unload(key);
      this.queue = plan.load;
      changed = true;
      for (const view of this.views.values()) {
        const nearby = chunkDistance(view.coord, this.center) <= PROP_RADIUS;
        view.props.visible = nearby;
        if (view.poiMarkers) view.poiMarkers.visible = nearby;
      }
    }

    while (this.pending.size < this.streamingPolicy.maxInFlight && this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next || this.views.has(next.key) || this.pending.has(next.key)) continue;
      this.pending.add(next.key);
      const request: ChunkLoadRequest = { type: 'load', key: next.key, url: this.chunkUrl(next.key) };
      this.worker.postMessage(request);
    }

    const built = this.ready.shift();
    if (built) {
      this.pending.delete(built.key);
      if (withinRadius(built.key, this.center, UNLOAD_RADIUS) && !this.views.has(built.key)) {
        const started = performance.now();
        this.apply(built);
        const ms = performance.now() - started;
        this.stats.lastApplyMs = ms;
        this.stats.maxApplyMs = Math.max(this.stats.maxApplyMs, ms);
        changed = true;
      }
    }

    if (changed) {
      rebuildCollision(cx, cz);
      this.rebuildPickables();
      if (!this.readyFired && this.initialAreaLoaded()) {
        this.readyFired = true;
        this.onInitialReady();
      }
    }
    this.stats.loaded = this.views.size;
    this.stats.pending = this.pending.size + this.queue.length + this.ready.length;
  }

  /** True once nothing is queued, in flight, or waiting to be applied. */
  get idle(): boolean {
    return this.pending.size === 0 && this.queue.length === 0 && this.ready.length === 0;
  }

  dispose(): void {
    this.worker.terminate();
    for (const key of [...this.views.keys()]) this.unload(key);
    this.terrainMaterial.dispose();
    this.buildingMaterial.dispose();
    this.unitBox.dispose();
    this.poiMarkerAssets.dispose();
  }

  private initialAreaLoaded(): boolean {
    for (let dz = -LOAD_RADIUS; dz <= LOAD_RADIUS; dz++) {
      for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
        const cx = this.center.cx + dx;
        const cz = this.center.cz + dz;
        if (inWorld(cx, cz) && !this.views.has(chunkKey(cx, cz))) return false;
      }
    }
    return true;
  }

  private rebuildPickables(): void {
    this.pickables.length = 0;
    for (const view of this.views.values()) this.pickables.push(...view.pickables);
  }

  private apply(chunk: BuiltChunk): void {
    const lampEntry = chunk.props.find((entry) => entry.id === 'prop_streetlamp_01');
    replaceChunkStreetLamps(chunk.key, lampEntry?.matrices ?? []);
    const group = new Group();
    group.name = `chunk_${chunk.key}`;
    const props = new Group();
    const disposables: { dispose: () => void }[] = [];
    const pickables: Object3D[] = [];

    const terrainGeometry = new BufferGeometry();
    terrainGeometry.setAttribute('position', new BufferAttribute(chunk.terrain.positions, 3));
    terrainGeometry.setAttribute('normal', new BufferAttribute(chunk.terrain.normals, 3));
    terrainGeometry.setAttribute('color', new BufferAttribute(chunk.terrain.colors, 3));
    terrainGeometry.computeBoundingSphere();
    terrainGeometry.computeBoundingBox();
    const terrain = new Mesh(terrainGeometry, this.terrainMaterial);
    terrain.receiveShadow = true;
    terrain.matrixAutoUpdate = false;
    group.add(terrain);
    pickables.push(terrain);
    disposables.push(terrainGeometry);

    const buildingCount = chunk.buildingColors.length / 3;
    if (buildingCount > 0) {
      const buildings = new InstancedMesh(this.unitBox, this.buildingMaterial, buildingCount);
      buildings.instanceMatrix = new InstancedBufferAttribute(chunk.buildingMatrices, 16);
      buildings.instanceColor = new InstancedBufferAttribute(chunk.buildingColors, 3);
      buildings.castShadow = true;
      buildings.receiveShadow = true;
      buildings.matrixAutoUpdate = false;
      buildings.computeBoundingSphere();
      group.add(buildings);
      pickables.push(buildings);
      disposables.push(buildings);
    }

    for (const entry of chunk.props) {
      const parts = this.parts[entry.id];
      if (!parts) continue;
      const count = entry.matrices.length / 16;
      for (const part of parts) {
        const mesh = new InstancedMesh(part.geometry, part.material, count);
        const target = mesh.instanceMatrix.array as Float32Array;
        for (let i = 0; i < count; i++) {
          this.placement.fromArray(entry.matrices, i * 16);
          this.scratch.multiplyMatrices(this.placement, part.matrix).toArray(target, i * 16);
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.computeBoundingSphere();
        props.add(mesh);
        disposables.push(mesh);
      }
    }
    const coord = { cx: chunk.cx, cz: chunk.cz };
    props.visible = chunkDistance(coord, this.center) <= PROP_RADIUS;
    group.add(props);

    const poiWithY = {
      fishingSpots: chunk.fishingSpots.map((p) => ({ ...p, y: sampleChunkHeight(chunk, p.x, p.z) })),
      trashBins: chunk.trashBins.map((p) => ({ ...p, y: sampleChunkHeight(chunk, p.x, p.z) })),
      fishStalls: chunk.fishStalls.map((p) => ({ ...p, y: sampleChunkHeight(chunk, p.x, p.z) })),
    };
    const poiMarkerResult = createPoiMarkerGroup(poiWithY, this.poiMarkerAssets);
    poiMarkerResult.group.visible = chunkDistance(coord, this.center) <= PROP_RADIUS;
    group.add(poiMarkerResult.group);

    this.root.add(group);
    group.updateMatrixWorld(true);

    worldState.chunks.set(chunk.key, {
      key: chunk.key,
      cx: chunk.cx,
      cz: chunk.cz,
      district: chunk.district,
      heights: chunk.heights,
      surface: chunk.surface,
      fishingSpots: chunk.fishingSpots,
      trashBins: chunk.trashBins,
      fishStalls: chunk.fishStalls,
      colliders: chunk.colliders,
    });
    // Kick off the per-tile navmesh fetch in the background (non-blocking).
    loadNavigationTile(chunk.cx, chunk.cz).catch(() => {/* tile not available, fallback to straight-line */});
    this.views.set(chunk.key, {
      key: chunk.key,
      coord,
      group,
      props,
      poiMarkers: poiMarkerResult.group,
      pickables,
      dispose: () => {
        poiMarkerResult.dispose();
        for (const item of disposables) item.dispose();
      },
    });
    this.stats.loads += 1;
  }

  private unload(key: string): void {
    const view = this.views.get(key);
    if (!view) return;
    this.root.remove(view.group);
    view.dispose();
    removeChunkStreetLamps(key);
    this.views.delete(key);
    worldState.chunks.delete(key);
    unloadNavigationTile(...(key.split('_').map(Number) as [number, number]));
    this.stats.unloads += 1;
  }
}
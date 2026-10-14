/**
 * Per-tier vehicle batch capacity and overflow guards for AmbientLayer.
 *
 * The InstancedMesh buffer is allocated once at construction (no re-allocation per frame).
 * Each frame, addVehicle writes up to `batch.parts[i].mesh.count` entries.
 * hasInstanceRoom ensures count never reaches the mesh capacity, preventing a runtime throw
 * when the render quality is higher than the runtime vehicle pool (batch capacity is always
 * >= the strictest runtime pool, so normal operation never hits the guard; the guard only
 * protects against code mistakes or quality increases without a streamer restart).
 */
import type { QualityTier } from '../state/qualityTiers';
import { VEHICLE_POOL } from './spawner';

/**
 * Buffer capacity for one vehicle-type batch (one per sedan/hatch/moto/bus).
 * Bus: always 1 (single vehicle).
 * Others: the render-quality pool size.
 */
export const vehicleBatchCapacity = (isBus: boolean, quality: QualityTier): number =>
  isBus ? 1 : VEHICLE_POOL[quality];

/**
 * True if the write index is safely below capacity. Returns false for NaN / Infinity.
 * Calling code must increment `count` only when this returns true.
 */
export const hasInstanceRoom = (count: number, capacity: number): boolean =>
  Number.isFinite(count) && Number.isFinite(capacity) && count < capacity;

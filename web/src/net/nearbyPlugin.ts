import { registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

/**
 * Deklarasi plugin native Nearby (android/.../NearbyPlugin.java, Nearby Connections P2P_STAR).
 * Hanya tipe + registerPlugin; penyambungan ke interface Transport ada di nearbyTransport.ts.
 * Detail method, event, dan izin: docs/NEARBY_PLUGIN.md.
 */

export type NearbyPermissionState = 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale';

/** `nearby` = ringkasan semua izin yang dibutuhkan versi Android ini; alias lain hanya muncul kalau relevan. */
export interface NearbyPermissionStatus {
  nearby: NearbyPermissionState;
  bluetoothScan?: NearbyPermissionState;
  bluetoothAdvertise?: NearbyPermissionState;
  bluetoothConnect?: NearbyPermissionState;
  nearbyWifiDevices?: NearbyPermissionState;
  location?: NearbyPermissionState;
}

export interface NearbyEndpoint {
  endpointId: string;
  name: string;
}

export interface NearbySendOptions {
  /** Kosong/absen = broadcast ke semua endpoint yang tersambung. */
  endpointId?: string;
  /** Base64 dari Uint8Array (pakai bytesToBase64). */
  data: string;
  /** Hanya informatif: Payload BYTES Nearby selalu reliable. */
  reliable: boolean;
}

export interface NearbyEndpointFoundEvent { endpointId: string; name: string }
export interface NearbyEndpointLostEvent { endpointId: string }
export interface NearbyConnectionInitiatedEvent {
  endpointId: string;
  name: string;
  /** Kode konfirmasi 4 digit, sama di kedua HP. */
  authDigits: string;
}
export interface NearbyConnectedEvent { endpointId: string; name: string }
export interface NearbyConnectionFailedEvent { endpointId: string; status: number; message: string }
export interface NearbyDisconnectedEvent { endpointId: string }
export interface NearbyPayloadEvent { endpointId: string; data: string }

export interface NearbyEventMap {
  endpointFound: NearbyEndpointFoundEvent;
  endpointLost: NearbyEndpointLostEvent;
  connectionInitiated: NearbyConnectionInitiatedEvent;
  connected: NearbyConnectedEvent;
  connectionFailed: NearbyConnectionFailedEvent;
  disconnected: NearbyDisconnectedEvent;
  payload: NearbyPayloadEvent;
}

export type NearbyEventName = keyof NearbyEventMap;

export interface NearbyPluginApi {
  checkPermissions(): Promise<NearbyPermissionStatus>;
  requestPermissions(): Promise<NearbyPermissionStatus>;
  /** Host: advertise dengan Strategy.P2P_STAR. */
  startAdvertising(options: { localName: string }): Promise<void>;
  /** Klien: cari host terdekat (event endpointFound/endpointLost). */
  startDiscovery(): Promise<void>;
  /** stopAdvertising + stopDiscovery + putus dari semua endpoint. */
  stopAll(): Promise<void>;
  /** endpointId harus dari endpointFound. localName opsional (default model HP). */
  requestConnection(options: { endpointId: string; localName?: string }): Promise<void>;
  acceptConnection(options: { endpointId: string }): Promise<void>;
  rejectConnection(options: { endpointId: string }): Promise<void>;
  send(options: NearbySendOptions): Promise<{ sentTo: number; reliable: true }>;
  connectedEndpoints(): Promise<{ endpoints: NearbyEndpoint[]; advertising: boolean; discovering: boolean }>;
  addListener<E extends NearbyEventName>(
    eventName: E,
    listener: (event: NearbyEventMap[E]) => void,
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

export const Nearby = registerPlugin<NearbyPluginApi>('Nearby');

/** Uint8Array -> base64 (tanpa newline), cocok dengan Base64.NO_WRAP di Java. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** base64 -> Uint8Array. Melempar Error kalau input bukan base64 yang valid. */
export function base64ToBytes(base64: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    throw new Error('Data base64 tidak valid');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

import type { PluginListenerHandle } from '@capacitor/core';
import { Nearby, base64ToBytes, bytesToBase64, type NearbyEventMap, type NearbyEventName, type NearbyPluginApi } from './nearbyPlugin';
import {
  HOST_PEER,
  type HostTransport,
  type MessageHandler,
  type PeerEvent,
  type PeerHandler,
  type PeerId,
  type Unsubscribe,
} from './transport';

/**
 * Transport mode LOKAL di atas plugin Nearby Connections (MULTIPLAYER.md bagian 4,
 * docs/NEARBY_PLUGIN.md). Modul ini hanya "kabel": mendaftar listener event plugin,
 * konversi base64 <-> Uint8Array, dan memetakan event koneksi ke `onPeer`.
 *
 * Alur penemuan (startAdvertising/startDiscovery/requestConnection/acceptConnection dengan
 * kode 4 digit) diurus pemanggil (UI) langsung lewat plugin; transport ini tidak memulainya.
 *
 * Catatan: Payload BYTES Nearby selalu reliable dan berurutan, jadi flag `reliable` di
 * `send`/`sendTo` tidak berpengaruh di mode lokal (hanya diteruskan sebagai info ke plugin).
 */
export type NearbyRole = 'host' | 'client';

/**
 * Bagian plugin yang dipakai transport. Tipe sempit ini yang disuntikkan, jadi unit test
 * bisa memakai plugin palsu tanpa mengimplementasikan seluruh NearbyPluginApi.
 */
export type NearbyPluginPart = Pick<NearbyPluginApi, 'addListener' | 'send' | 'stopAll'>;

export interface NearbyTransportOptions {
  role: NearbyRole;
  /** Objek plugin; default `Nearby` asli. Disuntikkan dengan plugin palsu di unit test. */
  plugin?: NearbyPluginPart;
}

/** Batas antrean klien sebelum host tersambung (hello + beberapa state). */
const MAX_PENDING = 32;

const errorReason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export class NearbyTransport implements HostTransport {
  /** Selesai saat semua listener event plugin sudah terdaftar. */
  readonly ready: Promise<void>;
  private readonly plugin: NearbyPluginPart;
  private readonly role: NearbyRole;
  private readonly messageHandlers = new Set<MessageHandler>();
  private readonly peerHandlers = new Set<PeerHandler>();
  /** Endpoint yang tersambung. Di klien isinya paling banyak satu: host. */
  private readonly connected = new Set<string>();
  /**
   * Klien: pesan yang dikirim sebelum host tersambung (mis. `hello` dari ClientSession.join,
   * yang dipanggil sebelum handshake Nearby selesai). Dikirim berurutan saat host tersambung.
   * Dibatasi supaya tidak tumbuh tanpa batas kalau sambungan tidak pernah jadi.
   */
  private readonly pending: { data: Uint8Array; reliable: boolean }[] = [];
  private handles: PluginListenerHandle[] = [];
  private closed = false;

  constructor(options: NearbyTransportOptions) {
    this.role = options.role;
    this.plugin = options.plugin ?? Nearby;
    this.ready = this.register();
  }

  send(data: Uint8Array, reliable: boolean): void {
    if (this.closed) return;
    if (this.role === 'host') {
      if (this.connected.size === 0) return;
      // Tanpa endpointId = broadcast ke semua endpoint yang tersambung.
      this.dispatch(undefined, data, reliable);
      return;
    }
    const host = this.hostEndpoint();
    if (host === null) {
      // Belum tersambung ke host: antrekan, dikirim di handleConnected. Saat penuh, pesan
      // BARU yang dibuang supaya `hello` (pesan pertama) tetap terkirim.
      if (this.pending.length < MAX_PENDING) this.pending.push({ data, reliable });
      return;
    }
    this.dispatch(host, data, reliable);
  }

  sendTo(peer: PeerId, data: Uint8Array, reliable: boolean): void {
    if (this.closed) return;
    if (this.role === 'client') {
      // Klien hanya punya satu tujuan: host.
      if (peer === HOST_PEER) this.send(data, reliable);
      return;
    }
    if (!this.connected.has(peer)) return;
    this.dispatch(peer, data, reliable);
  }

  peers(): PeerId[] {
    return this.role === 'host' ? [...this.connected] : this.connected.size > 0 ? [HOST_PEER] : [];
  }

  onMessage(cb: MessageHandler): Unsubscribe {
    this.messageHandlers.add(cb);
    return () => this.messageHandlers.delete(cb);
  }

  onPeer(cb: PeerHandler): Unsubscribe {
    this.peerHandlers.add(cb);
    return () => this.peerHandlers.delete(cb);
  }

  /** Lepas semua listener dan `stopAll()` (berhenti advertise/discovery + putus semua endpoint). */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.connected.clear();
    this.pending.length = 0;
    this.messageHandlers.clear();
    this.peerHandlers.clear();
    this.removeHandles();
    this.plugin.stopAll().catch(() => undefined);
  }

  private async register(): Promise<void> {
    const listen = async <E extends NearbyEventName>(name: E, fn: (event: NearbyEventMap[E]) => void): Promise<void> => {
      const handle = await this.plugin.addListener(name, (event: NearbyEventMap[E]) => {
        if (!this.closed) fn(event);
      });
      this.handles.push(handle);
      // close() terjadi sebelum pendaftaran selesai: lepas langsung.
      if (this.closed) this.removeHandles();
    };
    await Promise.all([
      listen('connected', (event) => this.handleConnected(event.endpointId)),
      listen('disconnected', (event) => this.handleDisconnected(event.endpointId)),
      listen('connectionFailed', (event) =>
        this.emitPeer({ kind: 'error', peer: this.peerFor(event.endpointId), reason: event.message || `Nearby status ${event.status}` }),
      ),
      listen('payload', (event) => this.handlePayload(event.endpointId, event.data)),
    ]);
  }

  private handleConnected(endpointId: string): void {
    if (this.connected.has(endpointId)) return;
    // P2P_STAR: klien hanya tersambung ke satu host; sambungan kedua diabaikan.
    if (this.role === 'client' && this.connected.size > 0) return;
    this.connected.add(endpointId);
    if (this.role === 'client') {
      const queued = this.pending.splice(0, this.pending.length);
      for (const item of queued) this.dispatch(endpointId, item.data, item.reliable);
    }
    this.emitPeer({ kind: 'open', peer: this.peerFor(endpointId) });
  }

  private handleDisconnected(endpointId: string): void {
    if (!this.connected.delete(endpointId)) return;
    this.emitPeer({ kind: 'close', peer: this.peerFor(endpointId) });
  }

  private handlePayload(endpointId: string, base64: string): void {
    // Payload dari endpoint yang tidak tersambung (atau sudah putus) dibuang.
    if (!this.connected.has(endpointId)) return;
    let data: Uint8Array;
    try {
      data = base64ToBytes(base64);
    } catch {
      return;
    }
    const from = this.peerFor(endpointId);
    for (const handler of [...this.messageHandlers]) handler({ from, data });
  }

  private dispatch(endpointId: string | undefined, data: Uint8Array, reliable: boolean): void {
    const options = endpointId === undefined ? { data: bytesToBase64(data), reliable } : { endpointId, data: bytesToBase64(data), reliable };
    this.plugin.send(options).catch((error: unknown) => {
      if (this.closed) return;
      this.emitPeer({ kind: 'error', peer: endpointId === undefined ? HOST_PEER : this.peerFor(endpointId), reason: errorReason(error) });
    });
  }

  /** Di klien semua endpoint dilaporkan sebagai `HOST_PEER`; di host endpointId dipakai sebagai PeerId. */
  private peerFor(endpointId: string): PeerId {
    return this.role === 'client' ? HOST_PEER : endpointId;
  }

  private hostEndpoint(): string | null {
    for (const id of this.connected) return id;
    return null;
  }

  private emitPeer(event: PeerEvent): void {
    for (const handler of [...this.peerHandlers]) handler(event);
  }

  private removeHandles(): void {
    const handles = this.handles;
    this.handles = [];
    for (const handle of handles) handle.remove().catch(() => undefined);
  }
}

/** Transport host: broadcast ke semua endpoint, `sendTo` per endpoint. */
export const createNearbyHostTransport = (plugin?: NearbyPluginPart): NearbyTransport => new NearbyTransport({ role: 'host', plugin });

/** Transport klien: semua pesan dikirim ke host (satu-satunya endpoint tersambung). */
export const createNearbyClientTransport = (plugin?: NearbyPluginPart): NearbyTransport => new NearbyTransport({ role: 'client', plugin });

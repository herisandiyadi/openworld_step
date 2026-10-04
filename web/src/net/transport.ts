/**
 * Lapisan "kabel" jaringan (MULTIPLAYER.md bagian 4). Logika game hanya memakai interface ini,
 * jadi mode lokal (Nearby Connections) dan internet (WebSocket) bisa dipertukarkan tanpa
 * mengubah `session.ts`.
 */

/** Id koneksi, unik selama sesi. Host memakai `HOST_PEER` untuk dirinya sendiri. */
export type PeerId = string;
export const HOST_PEER: PeerId = 'host';

export type PeerEvent =
  | { kind: 'open'; peer: PeerId }
  | { kind: 'close'; peer: PeerId }
  | { kind: 'error'; peer: PeerId; reason: string };

/** Pesan masuk beserta pengirimnya; di klien `from` selalu host. */
export interface IncomingMessage {
  from: PeerId;
  data: Uint8Array;
}

export type MessageHandler = (message: IncomingMessage) => void;
export type PeerHandler = (event: PeerEvent) => void;
export type Unsubscribe = () => void;

export interface Transport {
  /**
   * `reliable: false` dipakai untuk snapshot posisi: boleh hilang atau datang tidak berurutan.
   * `reliable: true` untuk hello/chat/kendaraan/jam.
   */
  send(data: Uint8Array, reliable: boolean): void;
  onMessage(cb: MessageHandler): Unsubscribe;
  onPeer(cb: PeerHandler): Unsubscribe;
  close(): void;
}

/** Transport di sisi host: bisa mengirim ke satu peer atau semua peer. */
export interface HostTransport extends Transport {
  sendTo(peer: PeerId, data: Uint8Array, reliable: boolean): void;
  peers(): PeerId[];
}

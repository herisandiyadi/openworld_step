import { useNetStore, type NetStatus } from './netStore';
import { decodeMessage, encodeMessage } from './protocol';
import { HOST_PEER, type MessageHandler, type PeerEvent, type PeerHandler, type Transport, type Unsubscribe } from './transport';

/**
 * Transport mode INTERNET di atas WebSocket (MULTIPLAYER.md bagian 4 dan 6). Server relay
 * berperan sebagai host, jadi semua pesan masuk dilaporkan dari `HOST_PEER`.
 *
 * - `binaryType = 'arraybuffer'`, pesan biner apa adanya (protocol.ts).
 * - Putus tak terduga: sambung ulang otomatis dengan exponential backoff + jitter, batas atas
 *   `maxDelayMs`. Setelah `maxAttempts` kali gagal berturut-turut, berhenti dan status 'error'.
 * - Selama terputus, pesan reliable diantre dan dikirim ulang berurutan setelah tersambung lagi;
 *   pesan unreliable (snapshot posisi) dibuang karena sudah basi saat koneksi pulih.
 * - Ping diukur lewat pesan ping/pong protokol dengan nonce di rentang atas (bit 31 menyala)
 *   supaya tidak bentrok dengan ping milik ClientSession; pong untuk nonce ini tidak diteruskan.
 *
 * Event peer: 'open' setiap kali (kembali) tersambung — server melihat koneksi baru, jadi
 * pemanggil harus mengirim hello lagi; 'error' saat putus sementara; 'close' hanya saat
 * menyerah atau `close()` dipanggil.
 */

/** Bagian WebSocket yang dipakai; WebSocket asli memenuhinya, test memakai versi palsu. */
export interface WebSocketLike {
  binaryType: BinaryType;
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  /** Selalu Uint8Array berbuffer ArrayBuffer biasa (cocok dengan tipe WebSocket.send di lib.dom). */
  send(data: Uint8Array<ArrayBuffer>): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

const WS_OPEN = 1;

export interface WsTransportOptions {
  /** Default `new WebSocket(url)`. */
  createSocket?: WebSocketFactory;
  /** Jeda awal sebelum sambung ulang (ms). */
  baseDelayMs?: number;
  /** Batas atas jeda backoff (ms). */
  maxDelayMs?: number;
  /** Jumlah percobaan sambung ulang gagal berturut-turut sebelum menyerah. */
  maxAttempts?: number;
  /** Batas antrean pesan reliable selama terputus; yang tertua dibuang kalau penuh. */
  maxQueue?: number;
  /** Interval ping (ms); 0 = tanpa ping otomatis. */
  pingIntervalMs?: number;
  /** Sumber acak untuk jitter (bisa dibuat deterministik di test). */
  random?: () => number;
  now?: () => number;
  /** Penerima status koneksi; default menulis ke netStore. */
  onStatus?: (status: NetStatus, error: string | null) => void;
  /** Penerima hasil ping (ms); default `netStore.setPing`. */
  onPing?: (rttMs: number) => void;
}

const PING_NONCE_FLAG = 0x80000000;

/** WebSocket.send tidak menerima view di atas SharedArrayBuffer; salin kalau perlu. */
const toSendable = (data: Uint8Array): Uint8Array<ArrayBuffer> =>
  data.buffer instanceof ArrayBuffer ? (data as Uint8Array<ArrayBuffer>) : new Uint8Array(data);

export class WsTransport implements Transport {
  private readonly options: Required<WsTransportOptions>;
  private readonly messageHandlers = new Set<MessageHandler>();
  private readonly peerHandlers = new Set<PeerHandler>();
  private readonly queue: Uint8Array<ArrayBuffer>[] = [];
  private readonly pendingPings = new Map<number, number>();
  private socket: WebSocketLike | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  /** Jumlah kegagalan berturut-turut sejak koneksi terakhir berhasil. */
  private failures = 0;
  private nextPingNonce = 0;
  private closed = false;
  /** Jeda sambung ulang terakhir yang dijadwalkan (ms), untuk diagnosa/test. */
  lastDelayMs: number | null = null;

  constructor(private readonly url: string, options: WsTransportOptions = {}) {
    this.options = {
      createSocket: options.createSocket ?? ((target) => new WebSocket(target)),
      baseDelayMs: options.baseDelayMs ?? 500,
      maxDelayMs: options.maxDelayMs ?? 15_000,
      maxAttempts: options.maxAttempts ?? 8,
      maxQueue: options.maxQueue ?? 256,
      pingIntervalMs: options.pingIntervalMs ?? 5_000,
      random: options.random ?? Math.random,
      now: options.now ?? Date.now,
      onStatus: options.onStatus ?? ((status, error) => useNetStore.getState().setStatus(status, error)),
      onPing: options.onPing ?? ((rtt) => useNetStore.getState().setPing(rtt)),
    };
    this.connect();
  }

  get connected(): boolean {
    return this.socket !== null && this.socket.readyState === WS_OPEN;
  }

  /** Jumlah pesan reliable yang menunggu koneksi pulih. */
  get queued(): number {
    return this.queue.length;
  }

  send(data: Uint8Array, reliable: boolean): void {
    if (this.closed) return;
    if (this.connected && this.socket) {
      this.socket.send(toSendable(data));
      return;
    }
    // Unreliable dibuang saat tidak tersambung; reliable diantre (salinan, buffer pemanggil bisa dipakai ulang).
    if (!reliable) return;
    if (this.queue.length >= this.options.maxQueue) this.queue.shift();
    this.queue.push(new Uint8Array(data));
  }

  onMessage(cb: MessageHandler): Unsubscribe {
    this.messageHandlers.add(cb);
    return () => this.messageHandlers.delete(cb);
  }

  onPeer(cb: PeerHandler): Unsubscribe {
    this.peerHandlers.add(cb);
    return () => this.peerHandlers.delete(cb);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearTimers();
    this.queue.length = 0;
    this.pendingPings.clear();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      this.detach(socket);
      socket.close(1000, 'client-close');
    }
    this.emitPeer({ kind: 'close', peer: HOST_PEER });
    this.options.onStatus('idle', null);
    this.messageHandlers.clear();
    this.peerHandlers.clear();
  }

  /** Kirim ping protokol sekarang; hasilnya lewat `onPing` saat pong datang. */
  ping(): void {
    if (!this.connected || !this.socket) return;
    const nonce = (PING_NONCE_FLAG | (this.nextPingNonce++ & 0x7fffffff)) >>> 0;
    this.pendingPings.set(nonce, this.options.now());
    this.socket.send(toSendable(encodeMessage({ type: 'ping', nonce })));
  }

  private connect(): void {
    this.options.onStatus('connecting', null);
    let socket: WebSocketLike;
    try {
      socket = this.options.createSocket(this.url);
    } catch (error) {
      this.handleFailure(error instanceof Error ? error.message : String(error));
      return;
    }
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    socket.onopen = () => this.handleOpen(socket);
    socket.onmessage = (event) => this.handleMessage(socket, event.data);
    // onerror selalu diikuti onclose di WebSocket, jadi penanganan putus cukup di onclose.
    socket.onerror = () => undefined;
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.detach(socket);
      this.stopPing();
      this.pendingPings.clear();
      this.handleFailure(event.reason || `Koneksi terputus (kode ${event.code}).`);
    };
  }

  private handleOpen(socket: WebSocketLike): void {
    if (this.socket !== socket || this.closed) return;
    this.failures = 0;
    this.options.onStatus('connected', null);
    this.emitPeer({ kind: 'open', peer: HOST_PEER });
    // Kirim ulang antrean reliable sesuai urutan aslinya.
    const pending = this.queue.splice(0, this.queue.length);
    for (const data of pending) socket.send(data);
    this.startPing();
  }

  private handleMessage(socket: WebSocketLike, raw: unknown): void {
    if (this.socket !== socket || this.closed) return;
    let data: Uint8Array;
    if (raw instanceof ArrayBuffer) data = new Uint8Array(raw);
    else if (ArrayBuffer.isView(raw)) data = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    else return; // Pesan teks tidak dipakai protokol ini.
    if (this.consumePong(data)) return;
    for (const handler of [...this.messageHandlers]) handler({ from: HOST_PEER, data });
  }

  /** True kalau `data` adalah pong untuk ping milik transport ini (tidak diteruskan ke session). */
  private consumePong(data: Uint8Array): boolean {
    if (this.pendingPings.size === 0) return false;
    const decoded = decodeMessage(data);
    if (!decoded.ok || decoded.message.type !== 'pong') return false;
    const sentAt = this.pendingPings.get(decoded.message.nonce);
    if (sentAt === undefined) return false;
    this.pendingPings.delete(decoded.message.nonce);
    this.options.onPing(Math.max(0, this.options.now() - sentAt));
    return true;
  }

  private handleFailure(reason: string): void {
    if (this.closed) return;
    this.failures += 1;
    if (this.failures > this.options.maxAttempts) {
      this.closed = true;
      this.clearTimers();
      this.queue.length = 0;
      const message = `Gagal tersambung ke server setelah ${this.options.maxAttempts} kali mencoba: ${reason}`;
      this.options.onStatus('error', message);
      this.emitPeer({ kind: 'error', peer: HOST_PEER, reason: message });
      this.emitPeer({ kind: 'close', peer: HOST_PEER });
      return;
    }
    this.emitPeer({ kind: 'error', peer: HOST_PEER, reason });
    const delay = this.backoffDelay(this.failures);
    this.lastDelayMs = delay;
    this.options.onStatus('connecting', null);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closed) this.connect();
    }, delay);
  }

  /** Equal jitter: setengah jeda tetap + setengah acak, supaya klien tidak menyerbu bersamaan. */
  private backoffDelay(attempt: number): number {
    const capped = Math.min(this.options.maxDelayMs, this.options.baseDelayMs * 2 ** (attempt - 1));
    return Math.round(capped / 2 + this.options.random() * (capped / 2));
  }

  private startPing(): void {
    this.stopPing();
    if (this.options.pingIntervalMs <= 0) return;
    this.ping();
    this.pingTimer = setInterval(() => this.ping(), this.options.pingIntervalMs);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private clearTimers(): void {
    this.stopPing();
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private detach(socket: WebSocketLike): void {
    socket.onopen = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.onmessage = null;
  }

  private emitPeer(event: PeerEvent): void {
    for (const handler of [...this.peerHandlers]) handler(event);
  }
}

import { HOST_PEER, type HostTransport, type IncomingMessage, type MessageHandler, type PeerEvent, type PeerHandler, type PeerId, type Transport, type Unsubscribe } from './transport';

/**
 * Transport in-memory untuk unit test (MULTIPLAYER.md bagian 4): satu host + N klien,
 * tanpa Bluetooth dan tanpa WebSocket. Mendukung simulasi latensi dan kehilangan paket
 * unreliable supaya interpolasi dan validasi bisa diuji.
 */
export interface LoopbackOptions {
  /** Latensi satu arah (ms). 0 = pengiriman langsung (sinkron). */
  latencyMs?: number;
  /** Peluang 0..1 sebuah paket unreliable dibuang. Paket reliable selalu sampai. */
  unreliableDropRate?: number;
  /** Sumber angka acak (bisa diganti agar test deterministik). */
  random?: () => number;
  /** Penjadwal pengiriman tertunda; default setTimeout. */
  schedule?: (fn: () => void, delayMs: number) => void;
}

interface Emitter {
  messageHandlers: Set<MessageHandler>;
  peerHandlers: Set<PeerHandler>;
}

const makeEmitter = (): Emitter => ({ messageHandlers: new Set(), peerHandlers: new Set() });

const copy = (data: Uint8Array): Uint8Array => new Uint8Array(data);

export class LoopbackNetwork {
  private readonly hostEmitter = makeEmitter();
  private readonly clients = new Map<PeerId, Emitter>();
  private readonly options: Required<LoopbackOptions>;
  /** Paket tertunda yang belum dikirim saat `latencyMs > 0` dan penjadwal manual dipakai. */
  private readonly pending: { at: number; deliver: () => void }[] = [];
  private now = 0;
  private closed = false;
  private counter = 0;

  constructor(options: LoopbackOptions = {}) {
    const manual = options.schedule === undefined && (options.latencyMs ?? 0) > 0;
    this.options = {
      latencyMs: options.latencyMs ?? 0,
      unreliableDropRate: options.unreliableDropRate ?? 0,
      random: options.random ?? Math.random,
      // Tanpa penjadwal eksplisit, paket tertunda disimpan dan dikirim lewat `advance()`.
      schedule: options.schedule ?? (manual ? (fn, delay) => this.pending.push({ at: this.now + delay, deliver: fn }) : (fn) => fn()),
    };
  }

  /** Transport untuk sisi host. */
  host(): HostTransport {
    const network = this;
    return {
      send(data, reliable) {
        for (const peer of network.clients.keys()) network.deliver(HOST_PEER, peer, data, reliable);
      },
      sendTo(peer, data, reliable) {
        network.deliver(HOST_PEER, peer, data, reliable);
      },
      peers() {
        return [...network.clients.keys()];
      },
      onMessage(cb) {
        return network.subscribeMessage(network.hostEmitter, cb);
      },
      onPeer(cb) {
        return network.subscribePeer(network.hostEmitter, cb);
      },
      close() {
        network.close();
      },
    };
  }

  /** Menyambungkan satu klien baru; host langsung menerima event `open`. */
  connect(peer?: PeerId): { transport: Transport; peer: PeerId } {
    const id = peer ?? `p${++this.counter}`;
    const emitter = makeEmitter();
    this.clients.set(id, emitter);
    this.emitPeer(this.hostEmitter, { kind: 'open', peer: id });
    const network = this;
    const transport: Transport = {
      send(data, reliable) {
        network.deliver(id, HOST_PEER, data, reliable);
      },
      onMessage(cb) {
        return network.subscribeMessage(emitter, cb);
      },
      onPeer(cb) {
        return network.subscribePeer(emitter, cb);
      },
      close() {
        network.disconnect(id);
      },
    };
    return { transport, peer: id };
  }

  /** Memutus satu klien; host menerima event `close`. */
  disconnect(peer: PeerId): void {
    const emitter = this.clients.get(peer);
    if (!emitter) return;
    this.clients.delete(peer);
    this.emitPeer(emitter, { kind: 'close', peer: HOST_PEER });
    this.emitPeer(this.hostEmitter, { kind: 'close', peer });
  }

  close(): void {
    this.closed = true;
    for (const peer of [...this.clients.keys()]) this.disconnect(peer);
    this.pending.length = 0;
  }

  /** Menjalankan waktu maju `ms` dan mengirim paket tertunda (dipakai saat latencyMs > 0). */
  advance(ms: number): void {
    this.now += ms;
    const due = this.pending.filter((item) => item.at <= this.now);
    for (const item of due) this.pending.splice(this.pending.indexOf(item), 1);
    for (const item of due) item.deliver();
  }

  /** Jumlah paket yang masih dalam perjalanan. */
  get inFlight(): number {
    return this.pending.length;
  }

  private deliver(from: PeerId, to: PeerId, data: Uint8Array, reliable: boolean): void {
    if (this.closed) return;
    if (!reliable && this.options.unreliableDropRate > 0 && this.options.random() < this.options.unreliableDropRate) return;
    const target = to === HOST_PEER ? this.hostEmitter : this.clients.get(to);
    if (!target) return;
    const message: IncomingMessage = { from, data: copy(data) };
    const fire = () => {
      if (this.closed) return;
      if (to !== HOST_PEER && !this.clients.has(to)) return;
      for (const handler of [...target.messageHandlers]) handler(message);
    };
    if (this.options.latencyMs > 0) this.options.schedule(fire, this.options.latencyMs);
    else fire();
  }

  private subscribeMessage(emitter: Emitter, cb: MessageHandler): Unsubscribe {
    emitter.messageHandlers.add(cb);
    return () => emitter.messageHandlers.delete(cb);
  }

  private subscribePeer(emitter: Emitter, cb: PeerHandler): Unsubscribe {
    emitter.peerHandlers.add(cb);
    return () => emitter.peerHandlers.delete(cb);
  }

  private emitPeer(emitter: Emitter, event: PeerEvent): void {
    for (const handler of [...emitter.peerHandlers]) handler(event);
  }
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeMessage, encodeMessage } from './protocol';
import { HOST_PEER, type PeerEvent } from './transport';
import { WsTransport, type WebSocketLike } from './wsTransport';
import type { NetStatus } from './netStore';

/** WebSocket palsu: tanpa jaringan, status dan event dikendalikan test. */
class FakeSocket implements WebSocketLike {
  static readonly instances: FakeSocket[] = [];
  binaryType: BinaryType = 'blob';
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  readonly sent: Uint8Array[] = [];
  closedWith: number | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: Uint8Array<ArrayBuffer>): void {
    this.sent.push(new Uint8Array(data));
  }

  close(code?: number): void {
    this.closedWith = code ?? 1000;
    this.readyState = 3;
  }

  /** Server menerima koneksi. */
  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  /** Koneksi putus (mis. server mati). */
  fail(code = 1006, reason = ''): void {
    this.readyState = 3;
    this.onclose?.({ code, reason } as CloseEvent);
  }

  /** Pesan biner dari server. */
  receive(data: Uint8Array): void {
    this.onmessage?.({ data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) } as MessageEvent);
  }
}

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);

interface Harness {
  transport: WsTransport;
  statuses: { status: NetStatus; error: string | null }[];
  events: PeerEvent[];
  pings: number[];
  received: Uint8Array[];
  nowMs: { value: number };
}

const make = (overrides: Partial<ConstructorParameters<typeof WsTransport>[1]> = {}): Harness => {
  const statuses: { status: NetStatus; error: string | null }[] = [];
  const events: PeerEvent[] = [];
  const pings: number[] = [];
  const received: Uint8Array[] = [];
  const nowMs = { value: 1000 };
  const transport = new WsTransport('wss://server.test:8080', {
    createSocket: (url) => new FakeSocket(url),
    baseDelayMs: 1000,
    maxDelayMs: 15_000,
    maxAttempts: 3,
    pingIntervalMs: 0,
    // Jitter deterministik: tanpa komponen acak, jeda = setengah nilai backoff.
    random: () => 0,
    now: () => nowMs.value,
    onStatus: (status, error) => statuses.push({ status, error }),
    onPing: (rtt) => pings.push(rtt),
    ...overrides,
  });
  transport.onPeer((event) => events.push(event));
  transport.onMessage(({ data }) => received.push(data));
  return { transport, statuses, events, pings, received, nowMs };
};

const last = (): FakeSocket => {
  const socket = FakeSocket.instances.at(-1);
  if (!socket) throw new Error('Belum ada socket yang dibuat.');
  return socket;
};

beforeEach(() => {
  FakeSocket.instances.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('WsTransport', () => {
  it('memakai arraybuffer, memakai URL yang diberikan, dan melaporkan status', () => {
    const h = make();
    expect(last().url).toBe('wss://server.test:8080');
    expect(last().binaryType).toBe('arraybuffer');
    expect(h.statuses).toEqual([{ status: 'connecting', error: null }]);

    last().open();
    expect(h.statuses.at(-1)).toEqual({ status: 'connected', error: null });
    expect(h.events).toEqual([{ kind: 'open', peer: HOST_PEER }]);
    expect(h.transport.connected).toBe(true);
  });

  it('meneruskan pesan masuk dari host dan mengirim pesan keluar apa adanya', () => {
    const h = make();
    last().open();
    h.transport.send(bytes(1, 2, 3), true);
    last().receive(bytes(9, 8));

    expect(last().sent.map((item) => [...item])).toEqual([[1, 2, 3]]);
    expect(h.received.map((item) => [...item])).toEqual([[9, 8]]);
  });

  it('mengantre pesan reliable saat terputus dan membuang yang unreliable', () => {
    const h = make();
    last().open();
    last().fail();

    h.transport.send(bytes(1), true);
    h.transport.send(bytes(2), false);
    h.transport.send(bytes(3), true);
    expect(h.transport.queued).toBe(2);

    vi.advanceTimersByTime(600);
    const next = last();
    expect(next).not.toBe(FakeSocket.instances[0]);
    next.open();

    // Hanya pesan reliable yang terkirim ulang, urutannya tetap.
    expect(next.sent.map((item) => [...item])).toEqual([[1], [3]]);
    expect(h.transport.queued).toBe(0);
  });

  it('sambung ulang setelah putus tak terduga dengan jeda yang bertambah', () => {
    const h = make();
    last().open();

    last().fail();
    const first = h.transport.lastDelayMs;
    vi.advanceTimersByTime(first ?? 0);
    last().fail();
    const second = h.transport.lastDelayMs;
    vi.advanceTimersByTime(second ?? 0);
    last().fail();
    const third = h.transport.lastDelayMs;

    expect(first).toBe(500); // base 1000, equal jitter dengan random()=0
    expect(second).toBe(1000);
    expect(third).toBe(2000);
    expect(FakeSocket.instances).toHaveLength(3);
    expect(h.events.filter((event) => event.kind === 'error')).toHaveLength(3);
  });

  it('membatasi jeda pada maxDelayMs', () => {
    const h = make({ baseDelayMs: 8000, maxAttempts: 10, random: () => 1 });
    last().open();
    for (let attempt = 0; attempt < 5; attempt++) {
      last().fail();
      vi.advanceTimersByTime(h.transport.lastDelayMs ?? 0);
    }
    expect(h.transport.lastDelayMs).toBe(15_000);
  });

  it('menyerah setelah maxAttempts dan melaporkan status error', () => {
    const h = make();
    last().open();
    for (let attempt = 0; attempt <= 3; attempt++) {
      last().fail(1006, 'server mati');
      vi.advanceTimersByTime(h.transport.lastDelayMs ?? 0);
    }

    // 3 percobaan sambung ulang + kegagalan ke-4 = menyerah.
    expect(FakeSocket.instances).toHaveLength(4);
    const status = h.statuses.at(-1);
    expect(status?.status).toBe('error');
    expect(status?.error).toContain('3 kali');
    expect(h.events.at(-1)).toEqual({ kind: 'close', peer: HOST_PEER });

    // Tidak ada percobaan lagi setelah menyerah.
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(4);
    h.transport.send(bytes(1), true);
    expect(h.transport.queued).toBe(0);
  });

  it('mengukur ping lewat pesan ping/pong protokol tanpa meneruskan pong ke pemanggil', () => {
    const h = make({ pingIntervalMs: 5000 });
    last().open();

    const sentPing = last().sent.at(-1);
    expect(sentPing).toBeDefined();
    const decoded = decodeMessage(sentPing ?? new Uint8Array());
    expect(decoded.ok && decoded.message.type).toBe('ping');
    const nonce = decoded.ok && decoded.message.type === 'ping' ? decoded.message.nonce : 0;

    h.nowMs.value += 42;
    last().receive(encodeMessage({ type: 'pong', nonce }));
    expect(h.pings).toEqual([42]);
    expect(h.received).toHaveLength(0);

    // Pong dengan nonce milik ClientSession diteruskan seperti pesan biasa.
    last().receive(encodeMessage({ type: 'pong', nonce: 7 }));
    expect(h.pings).toEqual([42]);
    expect(h.received).toHaveLength(1);

    // Ping berkala dikirim ulang oleh timer.
    const before = last().sent.length;
    vi.advanceTimersByTime(5000);
    expect(last().sent.length).toBe(before + 1);
  });

  it('close() menutup socket, mengosongkan antrean, dan tidak sambung ulang', () => {
    const h = make();
    last().open();
    h.transport.close();

    expect(last().closedWith).toBe(1000);
    expect(h.events.at(-1)).toEqual({ kind: 'close', peer: HOST_PEER });
    expect(h.statuses.at(-1)).toEqual({ status: 'idle', error: null });

    h.transport.send(bytes(1), true);
    vi.advanceTimersByTime(60_000);
    expect(h.transport.queued).toBe(0);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('kegagalan membuat socket ditangani seperti koneksi gagal', () => {
    let attempts = 0;
    const h = make({
      createSocket: (url) => {
        attempts += 1;
        if (attempts === 1) throw new Error('URL ditolak');
        return new FakeSocket(url);
      },
    });
    // Kegagalan sinkron di konstruktor terjadi sebelum onPeer dipasang; yang terlihat: sambung ulang terjadwal.
    expect(h.transport.lastDelayMs).toBe(500);
    expect(FakeSocket.instances).toHaveLength(0);
    vi.advanceTimersByTime(h.transport.lastDelayMs ?? 0);
    last().open();
    expect(h.transport.connected).toBe(true);
  });
});

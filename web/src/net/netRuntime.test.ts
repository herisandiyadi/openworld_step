import { afterEach, describe, expect, it } from 'vitest';
import type { PluginListenerHandle } from '@capacitor/core';
import { DEFAULT_APPEARANCE } from '../state/profile';
import { bytesToBase64, type NearbyEventMap, type NearbyEventName, type NearbySendOptions } from './nearbyPlugin';
import { useNetStore } from './netStore';
import {
  ERR_ROOM,
  ERR_SERVER,
  ERR_WORLD_VERSION,
  connectLocalHost,
  connectLocalClient,
  connectOnline,
  currentMode,
  disconnect,
  httpBase,
  localPlayerId,
  netSession,
  onFishingState,
  publishFishingState,
  releaseFishingSpot,
  reserveFishingSpot,
  roomCode,
  sendChat,
  tick,
  type FetchLike,
  type FetchResponseLike,
  type NetDeps,
} from './netRuntime';
import { encodeMessage, type PlayerInfo } from './protocol';
import { ClientSession, HostSession } from './session';
import { encodeFishingSync } from '../fishing/fishingSync';
import type { WebSocketLike } from './wsTransport';

/**
 * Semua uji memakai dependensi palsu yang disuntikkan (fetch, WebSocket, plugin Nearby):
 * tidak ada jaringan nyata dan tidak ada mock global.
 */

/** WebSocket palsu, mengikuti gaya wsTransport.test.ts. */
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

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  /** Pesan biner dari server. */
  receive(data: Uint8Array): void {
    this.onmessage?.({ data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) } as MessageEvent);
  }
}

/** Plugin Nearby palsu (hanya bagian yang dipakai transport). */
class FakeNearby {
  readonly sent: NearbySendOptions[] = [];
  stopAllCalls = 0;
  private readonly listeners = new Map<NearbyEventName, ((event: never) => void)[]>();

  addListener<E extends NearbyEventName>(eventName: E, listener: (event: NearbyEventMap[E]) => void): Promise<PluginListenerHandle> {
    const list = this.listeners.get(eventName) ?? [];
    list.push(listener as (event: never) => void);
    this.listeners.set(eventName, list);
    return Promise.resolve({ remove: () => Promise.resolve() });
  }

  send(options: NearbySendOptions): Promise<{ sentTo: number; reliable: true }> {
    this.sent.push(options);
    return Promise.resolve({ sentTo: 1, reliable: true });
  }

  stopAll(): Promise<void> {
    this.stopAllCalls += 1;
    return Promise.resolve();
  }

  emit<E extends NearbyEventName>(eventName: E, event: NearbyEventMap[E]): void {
    for (const listener of [...(this.listeners.get(eventName) ?? [])]) (listener as (value: NearbyEventMap[E]) => void)(event);
  }
}

interface FetchCall {
  url: string;
  method: string | undefined;
  headers: Record<string, string> | undefined;
}

/** `fetch` palsu: jawaban per urutan panggilan, atau Error untuk mensimulasikan jaringan mati. */
const fakeFetch = (
  calls: FetchCall[],
  replies: (FetchResponseLike | Error)[],
): FetchLike => {
  let index = 0;
  return (url, init) => {
    calls.push({ url, method: init?.method, headers: init?.headers });
    const reply = replies[Math.min(index++, replies.length - 1)];
    if (reply instanceof Error) return Promise.reject(reply);
    if (!reply) return Promise.reject(new Error('Tidak ada jawaban palsu tersisa.'));
    return Promise.resolve(reply);
  };
};

const reply = (status: number, body: unknown): FetchResponseLike => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
});

const onlineDeps = (fetchFn: FetchLike): NetDeps => ({
  fetch: fetchFn,
  createSocket: (url) => new FakeSocket(url),
  getWorldVersion: () => Promise.resolve('3.0.0-u4-fishing'),
  ws: { pingIntervalMs: 0, maxAttempts: 1, baseDelayMs: 10 },
  now: () => 1000,
});

const lastSocket = (): FakeSocket => {
  const socket = FakeSocket.instances.at(-1);
  if (!socket) throw new Error('Belum ada socket yang dibuat.');
  return socket;
};

const player = (id: number, username: string): PlayerInfo => ({ id, username, appearance: DEFAULT_APPEARANCE });

describe('live fishing runtime API', () => {
  it('exposes the local player id in every connected mode', async () => {
    const hostDeps: NetDeps = { plugin: new FakeNearby(), now: () => 1000 };
    await connectLocalHost({ username: 'Host', appearance: DEFAULT_APPEARANCE, deps: hostDeps });
    expect(localPlayerId()).toBe(1);
    disconnect();
    expect(localPlayerId()).toBeNull();

    const clientDeps: NetDeps = { plugin: new FakeNearby(), now: () => 1000 };
    await connectLocalClient({ username: 'Klien', appearance: DEFAULT_APPEARANCE, deps: clientDeps });
    expect(localPlayerId()).toBeNull(); // belum welcome dari host
    disconnect();
  });

  it('reserves and releases a fishing spot in local-host and local-client modes', async () => {
    const hostDeps: NetDeps = { plugin: new FakeNearby(), now: () => 1000 };
    await connectLocalHost({ username: 'Host', appearance: DEFAULT_APPEARANCE, deps: hostDeps });
    expect(reserveFishingSpot('lake-east', 1000)).toBe(true);
    const host = netSession();
    expect(host instanceof HostSession && host.fishingSpotOwner('lake-east')).toBe(1);
    // Reserving again by the same owner refreshes the heartbeat.
    expect(reserveFishingSpot('lake-east', 2000)).toBe(true);
    releaseFishingSpot('lake-east');
    expect(netSession() instanceof HostSession ? (netSession() as HostSession).fishingSpotOwner('lake-east') : null).toBeNull();
    disconnect();

    const clientDeps: NetDeps = { plugin: new FakeNearby(), now: () => 1000 };
    await connectLocalClient({ username: 'Klien', appearance: DEFAULT_APPEARANCE, deps: clientDeps });
    expect(reserveFishingSpot('lake-east', 1000)).toBe(true);
    releaseFishingSpot('lake-east');
    disconnect();
  });

  it('publishes and receives fishing state over HostSession/ClientSession in local-host mode', async () => {
    const plugin = new FakeNearby();
    await connectLocalHost({ username: 'Host', appearance: DEFAULT_APPEARANCE, deps: { plugin, now: () => 1000 } });
    const received: { playerId: number; sequence: number; payload: Uint8Array }[] = [];
    const off = onFishingState((playerId, sequence, payload) => received.push({ playerId, sequence, payload }));
    const payload = encodeFishingSync({ phase: 'wait', spotIndex: 1, bobberX: 1, bobberZ: -1 });
    expect(publishFishingState(payload, 3)).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0]?.playerId).toBe(1);
    expect(received[0]?.sequence).toBe(3);
    expect(received[0]?.payload).toEqual(payload);
    off?.();
    disconnect();
    expect(publishFishingState(payload, 3)).toBe(false);
    expect(onFishingState(() => undefined)).toBeNull();
  });
});

afterEach(() => {
  disconnect();
  FakeSocket.instances.length = 0;
});

describe('httpBase', () => {
  it('menurunkan alamat http dari alamat ws', () => {
    expect(httpBase('ws://10.0.0.5:8080')).toBe('http://10.0.0.5:8080');
    expect(httpBase('wss://server.test/')).toBe('https://server.test');
  });
});

describe('connectOnline', () => {
  it('membuat room baru lewat POST /rooms dan mengembalikan kodenya', async () => {
    const calls: FetchCall[] = [];
    const deps = onlineDeps(fakeFetch(calls, [reply(201, { code: 'ABC234', token: 'tok-1' })]));

    const code = await connectOnline({ serverUrl: 'wss://server.test', username: 'Budi', appearance: DEFAULT_APPEARANCE, deps });

    expect(code).toBe('ABC234');
    expect(roomCode()).toBe('ABC234');
    expect(currentMode()).toBe('online');
    expect(calls).toEqual([{ url: 'https://server.test/rooms', method: 'POST', headers: { 'x-world-version': '3.0.0-u4-fishing' } }]);
    expect(lastSocket().url).toBe('wss://server.test/ws?room=ABC234&token=tok-1');
    // Klien online tetap ClientSession: server yang berwenang.
    expect(netSession()).toBeInstanceOf(ClientSession);
  });

  it('memakai endpoint join kalau kode room sudah ada dan mengirim hello setelah socket terbuka', async () => {
    const calls: FetchCall[] = [];
    const deps = onlineDeps(fakeFetch(calls, [reply(200, { code: 'ABC234', token: 'tok-2' })]));

    const code = await connectOnline({
      serverUrl: 'ws://10.0.0.5:8080',
      roomCode: 'abc234',
      username: 'Budi',
      appearance: DEFAULT_APPEARANCE,
      deps,
    });

    expect(code).toBe('ABC234');
    expect(calls).toEqual([{ url: 'http://10.0.0.5:8080/rooms/ABC234/join', method: 'POST', headers: { 'x-world-version': '3.0.0-u4-fishing' } }]);
    const socket = lastSocket();
    // Hello diantre selama socket belum terbuka, lalu terkirim saat open.
    expect(socket.sent).toHaveLength(0);
    socket.open();
    expect(socket.sent).toHaveLength(1);
  });

  it('welcome mengisi store: id pemain, daftar pemain, status connected', async () => {
    const deps = onlineDeps(fakeFetch([], [reply(201, { code: 'ABC234', token: 'tok-3' })]));
    await connectOnline({ serverUrl: 'wss://server.test', username: 'Budi', appearance: DEFAULT_APPEARANCE, deps });
    const socket = lastSocket();
    socket.open();

    socket.receive(
      encodeMessage({ type: 'welcome', playerId: 7, timeOfDay: 0.5, players: [player(7, 'Budi'), player(8, 'Siti')] }),
    );

    const state = useNetStore.getState();
    expect(state.playerId).toBe(7);
    expect(state.status).toBe('connected');
    // Pemain lokal tidak masuk daftar remote.
    expect(Object.keys(state.remotes)).toEqual(['8']);
    expect(state.remotes[8]?.username).toBe('Siti');
  });

  it('chat masuk tersimpan di riwayat store', async () => {
    const deps = onlineDeps(fakeFetch([], [reply(201, { code: 'ABC234', token: 'tok-4' })]));
    await connectOnline({ serverUrl: 'wss://server.test', username: 'Budi', appearance: DEFAULT_APPEARANCE, deps });
    const socket = lastSocket();
    socket.open();
    socket.receive(encodeMessage({ type: 'welcome', playerId: 7, timeOfDay: 0, players: [player(7, 'Budi'), player(8, 'Siti')] }));

    socket.receive(encodeMessage({ type: 'chat', channel: 'session', fromId: 8, msgId: 3, timeMs: 1234, text: 'halo semua' }));

    const chat = useNetStore.getState().chat.session;
    expect(chat).toHaveLength(1);
    expect(chat[0]).toMatchObject({ id: 3, channel: 'session', fromId: 8, text: 'halo semua' });
    expect(useNetStore.getState().unread.session).toBe(1);
  });

  it('disconnect menutup socket dan mengembalikan store ke keadaan awal', async () => {
    const deps = onlineDeps(fakeFetch([], [reply(201, { code: 'ABC234', token: 'tok-5' })]));
    await connectOnline({ serverUrl: 'wss://server.test', username: 'Budi', appearance: DEFAULT_APPEARANCE, deps });
    const socket = lastSocket();
    socket.open();
    socket.receive(encodeMessage({ type: 'welcome', playerId: 7, timeOfDay: 0, players: [player(7, 'Budi'), player(8, 'Siti')] }));

    disconnect();

    expect(socket.closedWith).toBe(1000);
    const state = useNetStore.getState();
    expect(state.status).toBe('idle');
    expect(state.playerId).toBeNull();
    expect(state.remotes).toEqual({});
    expect(state.chat.session).toEqual([]);
    expect(netSession()).toBeNull();
    expect(currentMode()).toBeNull();
    expect(roomCode()).toBeNull();
  });

  it('fetch gagal: status error dengan pesan bahasa Indonesia tentang alamat server', async () => {
    const deps = onlineDeps(fakeFetch([], [new Error('network down')]));

    await expect(
      connectOnline({ serverUrl: 'wss://server.test', username: 'Budi', appearance: DEFAULT_APPEARANCE, deps }),
    ).rejects.toThrow(ERR_SERVER);

    expect(useNetStore.getState().status).toBe('error');
    expect(useNetStore.getState().error).toBe(ERR_SERVER);
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it('room tidak ada atau penuh: pesan khusus room', async () => {
    const deps = onlineDeps(fakeFetch([], [reply(404, { error: 'room-not-found' })]));

    await expect(
      connectOnline({ serverUrl: 'wss://server.test', roomCode: 'ZZZ999', username: 'Budi', appearance: DEFAULT_APPEARANCE, deps }),
    ).rejects.toThrow(ERR_ROOM);
    expect(useNetStore.getState().error).toBe(ERR_ROOM);

    const full = onlineDeps(fakeFetch([], [reply(409, { error: 'room-full' })]));
    await expect(
      connectOnline({ serverUrl: 'wss://server.test', roomCode: 'ABC234', username: 'Budi', appearance: DEFAULT_APPEARANCE, deps: full }),
    ).rejects.toThrow(ERR_ROOM);

    // 409 world-version: pesan khusus "perbarui konten dulu".
    const versionDeps = onlineDeps(fakeFetch([], [reply(409, { error: 'world-version', message: 'Perbarui konten dulu.' })]));
    await expect(
      connectOnline({ serverUrl: 'wss://server.test', roomCode: 'ABC234', username: 'Budi', appearance: DEFAULT_APPEARANCE, deps: versionDeps }),
    ).rejects.toThrow(ERR_WORLD_VERSION);
    expect(useNetStore.getState().error).toBe(ERR_WORLD_VERSION);
  });
});

describe('connectLocalHost', () => {
  it('host ikut jadi pemain dan pemain remote yang bergabung tampil di store host', async () => {
    const plugin = new FakeNearby();
    let nowMs = 5000;
    await connectLocalHost({
      username: 'Tuan Rumah',
      appearance: DEFAULT_APPEARANCE,
      deps: { plugin, now: () => nowMs },
    });

    expect(currentMode()).toBe('local-host');
    const hostId = useNetStore.getState().playerId;
    expect(hostId).not.toBeNull();
    expect(useNetStore.getState().status).toBe('connected');

    // Satu HP lain tersambung lalu mengirim hello: host menerimanya lewat transport Nearby.
    plugin.emit('connected', { endpointId: 'A', name: 'HP A' });
    plugin.emit('payload', {
      endpointId: 'A',
      data: bytesToBase64(encodeMessage({ type: 'hello', username: 'Siti', appearance: DEFAULT_APPEARANCE })),
    });

    nowMs += 100;
    tick();

    const remotes = Object.values(useNetStore.getState().remotes);
    expect(remotes.map((remote) => remote.username)).toEqual(['Siti']);
    // Chat pemain lokal host lolos aturan host dan langsung tampil di HP host.
    expect(sendChat('session', 'selamat datang')).toBe(true);
    expect(useNetStore.getState().chat.session.map((entry) => entry.text)).toEqual(['selamat datang']);
  });

  it('tick tanpa sesi tidak melakukan apa pun', () => {
    disconnect();
    expect(() => tick()).not.toThrow();
  });
});

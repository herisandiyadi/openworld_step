import { describe, expect, it } from 'vitest';
import type { PluginListenerHandle } from '@capacitor/core';
import { bytesToBase64, type NearbyEventMap, type NearbyEventName, type NearbySendOptions } from './nearbyPlugin';
import { createNearbyClientTransport, createNearbyHostTransport } from './nearbyTransport';
import { HOST_PEER, type IncomingMessage, type PeerEvent } from './transport';

/**
 * Plugin native tidak ada di lingkungan test, jadi transport diuji dengan plugin palsu
 * yang disuntikkan lewat factory (tanpa mock global).
 */
class FakeNearby {
  readonly sent: NearbySendOptions[] = [];
  stopAllCalls = 0;
  removedHandles = 0;
  /** Gagalkan `send` berikutnya dengan pesan ini (untuk menguji event error). */
  failSendWith: string | null = null;
  private readonly listeners = new Map<NearbyEventName, ((event: never) => void)[]>();

  addListener<E extends NearbyEventName>(eventName: E, listener: (event: NearbyEventMap[E]) => void): Promise<PluginListenerHandle> {
    const list = this.listeners.get(eventName) ?? [];
    list.push(listener as (event: never) => void);
    this.listeners.set(eventName, list);
    const handle: PluginListenerHandle = {
      remove: () => {
        this.removedHandles += 1;
        const current = this.listeners.get(eventName) ?? [];
        this.listeners.set(
          eventName,
          current.filter((item) => item !== (listener as (event: never) => void)),
        );
        return Promise.resolve();
      },
    };
    return Promise.resolve(handle);
  }

  send(options: NearbySendOptions): Promise<{ sentTo: number; reliable: true }> {
    if (this.failSendWith !== null) {
      const message = this.failSendWith;
      this.failSendWith = null;
      return Promise.reject(new Error(message));
    }
    this.sent.push(options);
    return Promise.resolve({ sentTo: 1, reliable: true });
  }

  stopAll(): Promise<void> {
    this.stopAllCalls += 1;
    return Promise.resolve();
  }

  /** Memicu event plugin seperti yang dilakukan sisi native. */
  emit<E extends NearbyEventName>(eventName: E, event: NearbyEventMap[E]): void {
    for (const listener of [...(this.listeners.get(eventName) ?? [])]) (listener as (value: NearbyEventMap[E]) => void)(event);
  }
}

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);

describe('NearbyTransport (host)', () => {
  it('memetakan connected/disconnected ke event peer dan mencatat daftar endpoint', async () => {
    const plugin = new FakeNearby();
    const transport = createNearbyHostTransport(plugin);
    await transport.ready;
    const events: PeerEvent[] = [];
    transport.onPeer((event) => events.push(event));

    plugin.emit('connected', { endpointId: 'A', name: 'HP A' });
    plugin.emit('connected', { endpointId: 'B', name: 'HP B' });
    expect(transport.peers()).toEqual(['A', 'B']);
    plugin.emit('disconnected', { endpointId: 'A' });

    expect(events).toEqual([
      { kind: 'open', peer: 'A' },
      { kind: 'open', peer: 'B' },
      { kind: 'close', peer: 'A' },
    ]);
    expect(transport.peers()).toEqual(['B']);
  });

  it('broadcast tanpa endpointId dan sendTo ke satu endpoint, flag reliable hanya diteruskan', async () => {
    const plugin = new FakeNearby();
    const transport = createNearbyHostTransport(plugin);
    await transport.ready;
    plugin.emit('connected', { endpointId: 'A', name: 'HP A' });

    transport.send(bytes(1, 2, 3), false);
    transport.sendTo('A', bytes(9), true);
    // Endpoint tidak dikenal: tidak ada pengiriman.
    transport.sendTo('Z', bytes(9), true);

    expect(plugin.sent).toEqual([
      { data: bytesToBase64(bytes(1, 2, 3)), reliable: false },
      { endpointId: 'A', data: bytesToBase64(bytes(9)), reliable: true },
    ]);
  });

  it('tidak mengirim apa pun saat belum ada endpoint tersambung', async () => {
    const plugin = new FakeNearby();
    const transport = createNearbyHostTransport(plugin);
    await transport.ready;
    transport.send(bytes(1), true);
    expect(plugin.sent).toEqual([]);
  });

  it('mendekode payload base64 menjadi Uint8Array dari endpoint pengirim', async () => {
    const plugin = new FakeNearby();
    const transport = createNearbyHostTransport(plugin);
    await transport.ready;
    const received: IncomingMessage[] = [];
    transport.onMessage((message) => received.push(message));

    plugin.emit('connected', { endpointId: 'A', name: 'HP A' });
    plugin.emit('payload', { endpointId: 'A', data: bytesToBase64(bytes(7, 8, 255)) });
    // Payload dari endpoint yang belum tersambung dibuang.
    plugin.emit('payload', { endpointId: 'X', data: bytesToBase64(bytes(1)) });
    // Base64 rusak tidak boleh melempar.
    plugin.emit('payload', { endpointId: 'A', data: '!!!bukan base64!!!' });

    expect(received).toHaveLength(1);
    expect(received[0]?.from).toBe('A');
    expect([...(received[0]?.data ?? [])]).toEqual([7, 8, 255]);
  });

  it('melaporkan connectionFailed dan kegagalan send sebagai event error', async () => {
    const plugin = new FakeNearby();
    const transport = createNearbyHostTransport(plugin);
    await transport.ready;
    const events: PeerEvent[] = [];
    transport.onPeer((event) => events.push(event));

    plugin.emit('connectionFailed', { endpointId: 'A', status: 8, message: 'ditolak' });
    plugin.emit('connected', { endpointId: 'B', name: 'HP B' });
    plugin.failSendWith = 'payload gagal';
    transport.sendTo('B', bytes(1), true);
    await Promise.resolve();
    await Promise.resolve();

    expect(events).toEqual([
      { kind: 'error', peer: 'A', reason: 'ditolak' },
      { kind: 'open', peer: 'B' },
      { kind: 'error', peer: 'B', reason: 'payload gagal' },
    ]);
  });

  it('close() memanggil stopAll, melepas listener, dan berhenti mengirim', async () => {
    const plugin = new FakeNearby();
    const transport = createNearbyHostTransport(plugin);
    await transport.ready;
    const received: IncomingMessage[] = [];
    transport.onMessage((message) => received.push(message));
    plugin.emit('connected', { endpointId: 'A', name: 'HP A' });

    transport.close();
    expect(plugin.stopAllCalls).toBe(1);
    expect(plugin.removedHandles).toBe(4);
    transport.send(bytes(1), true);
    plugin.emit('payload', { endpointId: 'A', data: bytesToBase64(bytes(1)) });
    expect(plugin.sent).toEqual([]);
    expect(received).toEqual([]);
    expect(transport.peers()).toEqual([]);
    // close() kedua tidak menambah stopAll.
    transport.close();
    expect(plugin.stopAllCalls).toBe(1);
  });
});

describe('NearbyTransport (klien)', () => {
  it('melaporkan host sebagai HOST_PEER dan mengirim ke endpoint host', async () => {
    const plugin = new FakeNearby();
    const transport = createNearbyClientTransport(plugin);
    await transport.ready;
    const events: PeerEvent[] = [];
    const received: IncomingMessage[] = [];
    transport.onPeer((event) => events.push(event));
    transport.onMessage((message) => received.push(message));

    // Belum tersambung: belum ada yang dikirim, tapi pesan diantrekan (bukan dibuang).
    transport.send(bytes(9), true);
    expect(plugin.sent).toEqual([]);

    plugin.emit('connected', { endpointId: 'HOST1', name: 'HP Host' });
    // Sambungan kedua diabaikan: klien P2P_STAR hanya punya satu host.
    plugin.emit('connected', { endpointId: 'HOST2', name: 'HP Lain' });
    transport.send(bytes(5), false);
    transport.sendTo(HOST_PEER, bytes(6), true);
    plugin.emit('payload', { endpointId: 'HOST1', data: bytesToBase64(bytes(42)) });

    expect(transport.peers()).toEqual([HOST_PEER]);
    expect(plugin.sent).toEqual([
      // Antrean pra-koneksi dikirim lebih dulu, berurutan.
      { endpointId: 'HOST1', data: bytesToBase64(bytes(9)), reliable: true },
      { endpointId: 'HOST1', data: bytesToBase64(bytes(5)), reliable: false },
      { endpointId: 'HOST1', data: bytesToBase64(bytes(6)), reliable: true },
    ]);
    expect(received).toHaveLength(1);
    expect(received[0]?.from).toBe(HOST_PEER);
    expect(events).toEqual([{ kind: 'open', peer: HOST_PEER }]);

    plugin.emit('disconnected', { endpointId: 'HOST1' });
    expect(events.at(-1)).toEqual({ kind: 'close', peer: HOST_PEER });
    expect(transport.peers()).toEqual([]);
  });

  it('mengantrekan hello yang dikirim sebelum host tersambung lalu mengirimnya saat open', async () => {
    const plugin = new FakeNearby();
    const transport = createNearbyClientTransport(plugin);
    await transport.ready;

    // ClientSession.join() mengirim hello sebelum handshake Nearby selesai.
    transport.send(bytes(1, 2, 3), true);
    expect(plugin.sent).toEqual([]);

    plugin.emit('connected', { endpointId: 'HOST1', name: 'HP Host' });
    expect(plugin.sent).toEqual([{ endpointId: 'HOST1', data: bytesToBase64(bytes(1, 2, 3)), reliable: true }]);
  });

  it('antrean pra-koneksi dibatasi dan dibuang saat close()', async () => {
    const plugin = new FakeNearby();
    const transport = createNearbyClientTransport(plugin);
    await transport.ready;

    for (let i = 0; i < 40; i += 1) transport.send(bytes(i), true);
    transport.close();
    plugin.emit('connected', { endpointId: 'HOST1', name: 'HP Host' });
    expect(plugin.sent).toEqual([]);
  });

  it('saat antrean penuh, 32 pesan pertama (termasuk hello) yang disimpan', async () => {
    const plugin = new FakeNearby();
    const transport = createNearbyClientTransport(plugin);
    await transport.ready;

    for (let i = 0; i < 40; i += 1) transport.send(bytes(i), true);
    plugin.emit('connected', { endpointId: 'HOST1', name: 'HP Host' });

    expect(plugin.sent).toHaveLength(32);
    // Pesan pertama (hello) tetap ada; kelebihan 32..39 yang dibuang.
    expect(plugin.sent[0]).toEqual({ endpointId: 'HOST1', data: bytesToBase64(bytes(0)), reliable: true });
    expect(plugin.sent.at(-1)).toEqual({ endpointId: 'HOST1', data: bytesToBase64(bytes(31)), reliable: true });
  });
});

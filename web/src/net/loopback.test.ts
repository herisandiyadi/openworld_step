import { describe, expect, it } from 'vitest';
import { LoopbackNetwork } from './loopback';
import { HOST_PEER, type PeerEvent } from './transport';

const bytes = (...values: number[]) => new Uint8Array(values);

describe('LoopbackNetwork', () => {
  it('menghubungkan host dengan 3 klien dan memberi tahu host', () => {
    const network = new LoopbackNetwork();
    const host = network.host();
    const events: PeerEvent[] = [];
    host.onPeer((event) => events.push(event));
    const clients = [network.connect(), network.connect(), network.connect()];
    expect(host.peers()).toEqual(clients.map((client) => client.peer));
    expect(events.map((event) => event.kind)).toEqual(['open', 'open', 'open']);
  });

  it('mengirim klien -> host dan host -> semua / satu klien', () => {
    const network = new LoopbackNetwork();
    const host = network.host();
    const received: string[] = [];
    host.onMessage(({ from, data }) => received.push(`${from}:${data[0]}`));
    const a = network.connect('a');
    const b = network.connect('b');
    const got = { a: [] as number[], b: [] as number[] };
    a.transport.onMessage(({ from, data }) => {
      expect(from).toBe(HOST_PEER);
      got.a.push(data[0] as number);
    });
    b.transport.onMessage(({ data }) => got.b.push(data[0] as number));
    a.transport.send(bytes(1), true);
    b.transport.send(bytes(2), false);
    host.send(bytes(3), true);
    host.sendTo('b', bytes(4), true);
    expect(received).toEqual(['a:1', 'b:2']);
    expect(got).toEqual({ a: [3], b: [3, 4] });
  });

  it('menyalin buffer supaya pengirim bisa memakai ulang array-nya', () => {
    const network = new LoopbackNetwork();
    const host = network.host();
    const client = network.connect();
    let seen: Uint8Array | null = null;
    host.onMessage(({ data }) => (seen = data));
    const data = bytes(9);
    client.transport.send(data, true);
    data[0] = 0;
    expect(seen).toEqual(bytes(9));
  });

  it('menyimulasikan latensi lewat advance()', () => {
    const network = new LoopbackNetwork({ latencyMs: 50 });
    const host = network.host();
    const client = network.connect();
    const received: number[] = [];
    host.onMessage(({ data }) => received.push(data[0] as number));
    client.transport.send(bytes(1), true);
    expect(received).toEqual([]);
    expect(network.inFlight).toBe(1);
    network.advance(49);
    expect(received).toEqual([]);
    network.advance(1);
    expect(received).toEqual([1]);
  });

  it('membuang hanya paket unreliable sesuai drop rate', () => {
    let call = 0;
    // Bergantian 0.1 / 0.9: separuh paket unreliable dibuang pada drop rate 0.5.
    const network = new LoopbackNetwork({ unreliableDropRate: 0.5, random: () => (call++ % 2 === 0 ? 0.1 : 0.9) });
    const host = network.host();
    const client = network.connect();
    const received: string[] = [];
    host.onMessage(({ data }) => received.push(`${data[0]}`));
    for (let i = 0; i < 4; i++) client.transport.send(bytes(i), false);
    for (let i = 10; i < 14; i++) client.transport.send(bytes(i), true);
    expect(received).toEqual(['1', '3', '10', '11', '12', '13']);
  });

  it('disconnect memberi tahu kedua sisi dan menghentikan pengiriman', () => {
    const network = new LoopbackNetwork();
    const host = network.host();
    const hostEvents: PeerEvent[] = [];
    host.onPeer((event) => hostEvents.push(event));
    const client = network.connect('x');
    const clientEvents: PeerEvent[] = [];
    client.transport.onPeer((event) => clientEvents.push(event));
    const received: number[] = [];
    client.transport.onMessage(({ data }) => received.push(data[0] as number));
    client.transport.close();
    host.send(bytes(1), true);
    expect(received).toEqual([]);
    expect(hostEvents.at(-1)).toEqual({ kind: 'close', peer: 'x' });
    expect(clientEvents).toEqual([{ kind: 'close', peer: HOST_PEER }]);
    expect(host.peers()).toEqual([]);
  });

  it('unsubscribe menghentikan callback', () => {
    const network = new LoopbackNetwork();
    const host = network.host();
    const client = network.connect();
    let count = 0;
    const off = host.onMessage(() => count++);
    client.transport.send(bytes(1), true);
    off();
    client.transport.send(bytes(2), true);
    expect(count).toBe(1);
  });
});

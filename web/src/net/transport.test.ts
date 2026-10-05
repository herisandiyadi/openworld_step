import { describe, expect, it } from 'vitest';
import { LoopbackNetwork } from './loopback';
import { HOST_PEER, type HostTransport, type Transport } from './transport';

describe('Transport interface', () => {
  it('loopback memenuhi kontrak Transport dan HostTransport', () => {
    const network = new LoopbackNetwork();
    const host: HostTransport = network.host();
    const client: Transport = network.connect().transport;
    for (const transport of [host, client]) {
      expect(typeof transport.send).toBe('function');
      expect(typeof transport.onMessage).toBe('function');
      expect(typeof transport.onPeer).toBe('function');
      expect(typeof transport.close).toBe('function');
    }
    expect(typeof host.sendTo).toBe('function');
    expect(HOST_PEER).toBe('host');
  });
});

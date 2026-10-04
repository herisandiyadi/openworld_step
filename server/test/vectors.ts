/**
 * Vektor uji kompatibilitas wire. Nilai hex di bawah BUKAN hasil server ini: semuanya diambil
 * dengan menjalankan encoder KLIEN asli (web/src/net/protocol.ts + appearanceCodec.ts) di Node
 * lewat esbuild, lalu Buffer.from(bytes).toString('hex'). Kalau server menghasilkan byte lain,
 * test/protocol.test.ts gagal. Pesan dan nilainya mengikuti web/src/net/protocol.test.ts.
 *
 * Cara membuat ulang (dari direktori wt-multiplayer/web):
 *   bundle sebuah entry yang memanggil encodeMessage untuk tiap sampel di bawah, cetak hex-nya.
 */
import { DEFAULT_APPEARANCE, type Appearance } from '../src/appearance.js';
import type { NetMessage } from '../src/protocol.js';

export const LOOK: Appearance = { ...DEFAULT_APPEARANCE, gender: 'f', hairColor: 2 };

/** Nama sampel → pesan yang di-encode. */
export const SAMPLES: Record<string, NetMessage> = {
  hello: { type: 'hello', username: 'Budi Ánh', appearance: LOOK },
  welcome: {
    type: 'welcome',
    playerId: 3,
    timeOfDay: 123.5,
    players: [
      { id: 1, username: 'Host', appearance: DEFAULT_APPEARANCE },
      { id: 3, username: 'Sari', appearance: LOOK },
    ],
  },
  state: {
    type: 'state',
    timeMs: 1000,
    players: [
      { id: 7, x: 12.5, y: 0.3, z: -40.25, heading: 1.2, mode: 'bike', anim: 'ride', jumping: false },
      { id: 8, x: -200, y: 5, z: 255.9, heading: 6.1, mode: 'walk', anim: 'jump', jumping: true },
    ],
  },
  appearance: { type: 'appearance', playerId: 4, appearance: LOOK },
  vehicleClaimMount: { type: 'vehicleClaim', vehicleId: 'v_spawn_bike', action: 'mount', x: 5.25, z: -4, yaw: 0 },
  vehicleClaimRelease: { type: 'vehicleClaim', vehicleId: 'v_spawn_bike', action: 'release', x: 10, z: 2.5, yaw: 1.5 },
  vehicleState: { type: 'vehicleState', vehicleId: 'v_96_96', ownerId: 2, x: 98, z: 108, yaw: 0.5 },
  clock: { type: 'clock', timeOfDay: 240, timeMs: 123456 },
  chat: { type: 'chat', channel: 'nearby', fromId: 2, msgId: 9, timeMs: 5000, text: 'Halo semua 👋' },
  playerJoin: { type: 'playerJoin', player: { id: 5, username: 'Tono', appearance: LOOK } },
  playerLeave: { type: 'playerLeave', playerId: 5 },
  ping: { type: 'ping', nonce: 0xfffffffe },
  pong: { type: 'pong', nonce: 42 },
};

/** Hex hasil encode KLIEN untuk tiap sampel di atas. */
export const CLIENT_HEX: Record<keyof typeof SAMPLES, string> = {
  hello: '010101410800094275646920c3816e68',
  welcome: '0102000342f700000200010100080004486f73740003014108000453617269',
  state: '0103000003e8020007863f6be0204d3102030000081c00fff22500f9000501',
  appearance: '0104000401410800',
  vehicleClaimMount: '0105000c765f737061776e5f62696b6540a80000c080000000000000',
  vehicleClaimRelease: '0105010c765f737061776e5f62696b6541200000402000003fc00000',
  vehicleState: '0106000207765f39365f393642c4000042d800003f000000',
  clock: '0107437000000001e240',
  chat: '01080100020000000900001388000f48616c6f2073656d756120f09f918b',
  playerJoin: '010900050141080004546f6e6f',
  playerLeave: '010a0005',
  ping: '010bfffffffe',
  pong: '010c0000002a',
};

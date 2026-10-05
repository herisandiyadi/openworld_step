import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE, type Appearance } from '../state/profile';
import { HALF_WORLD } from '../world/worldSpec';
import { LoopbackNetwork } from './loopback';
import { CHAT_TEXT_MAX, encodeMessage, PROTOCOL_VERSION, type PlayerSnapshot } from './protocol';
import {
  AOI_INTERVAL_MS,
  aoiDue,
  aoiTier,
  CHAT_BURST,
  CHAT_HISTORY_MAX,
  ClientSession,
  CLOCK_INTERVAL_MS,
  HostSession,
  INTERPOLATION_DELAY_MS,
  interpolateSnapshots,
  isPlausibleMove,
  lerpAngle,
  newRateBucket,
  pushHistory,
  pushSnapshot,
  takeToken,
  type ChatEntry,
  type RejectEvent,
  type TimedSnapshot,
  type VehicleInfo,
} from './session';

/** Jam palsu supaya rate limit dan AOI bisa diuji tanpa menunggu. */
let now = 1_000_000;
const clock = () => now;
const state = (over: Partial<Omit<PlayerSnapshot, 'id'>> = {}): Omit<PlayerSnapshot, 'id'> => ({
  x: 0,
  y: 0,
  z: 0,
  heading: 0,
  mode: 'walk',
  anim: 'idle',
  jumping: false,
  ...over,
});

interface Harness {
  network: LoopbackNetwork;
  host: HostSession;
  rejects: RejectEvent[];
  localChats: ChatEntry[];
}

function makeHost(options: { localPlayer?: { username: string; appearance: Appearance } } = {}): Harness {
  const network = new LoopbackNetwork();
  const rejects: RejectEvent[] = [];
  const localChats: ChatEntry[] = [];
  const host = new HostSession(network.host(), {
    now: clock,
    getTimeOfDay: () => 120,
    onReject: (event) => rejects.push(event),
    onLocalChat: (entry) => localChats.push(entry),
    ...options,
  });
  return { network, host, rejects, localChats };
}

interface Client {
  session: ClientSession;
  chats: ChatEntry[];
  joins: number[];
  leaves: number[];
  vehicles: VehicleInfo[];
  clocks: number[];
  appearances: [number, Appearance][];
  pings: number[];
  send: (data: Uint8Array, reliable: boolean) => void;
}

function addClient(harness: Harness, username: string, appearance = DEFAULT_APPEARANCE): Client {
  const { transport } = harness.network.connect();
  const client: Client = {
    chats: [],
    joins: [],
    leaves: [],
    vehicles: [],
    clocks: [],
    appearances: [],
    pings: [],
    send: (data, reliable) => transport.send(data, reliable),
    session: new ClientSession(
      transport,
      {
        onChat: (entry) => client.chats.push(entry),
        onPlayerJoin: (player) => client.joins.push(player.id),
        onPlayerLeave: (id) => client.leaves.push(id),
        onVehicle: (vehicle) => client.vehicles.push(vehicle),
        onClock: (timeOfDay) => client.clocks.push(timeOfDay),
        onAppearance: (id, look) => client.appearances.push([id, look]),
        onPing: (rtt) => client.pings.push(rtt),
      },
      clock,
    ),
  };
  client.session.join(username, appearance);
  return client;
}

beforeEach(() => {
  now = 1_000_000;
});

describe('gerbang M1: 2 klien loopback sinkron posisi', () => {
  it('klien kedua menerima posisi klien pertama lewat host', () => {
    const harness = makeHost();
    const a = addClient(harness, 'Budi');
    const b = addClient(harness, 'Sari');
    expect(harness.host.playerList().map((player) => player.username)).toEqual(['Budi', 'Sari']);
    expect(a.session.playerId).toBe(1);
    expect(b.session.playerId).toBe(2);
    expect(a.joins).toEqual([2]);

    a.session.sendState(state({ x: 10, z: -20, heading: 1, mode: 'bike', anim: 'ride' }));
    b.session.sendState(state({ x: 12, z: -20 }));
    harness.host.tick();

    const seenByB = b.session.latest(1);
    expect(seenByB).not.toBeNull();
    expect(seenByB?.x).toBeCloseTo(10, 1);
    expect(seenByB?.z).toBeCloseTo(-20, 1);
    expect(seenByB?.mode).toBe('bike');
    expect(seenByB?.anim).toBe('ride');
    expect(b.session.latest(2)).toBeNull(); // posisi sendiri tidak di-buffer
    expect(a.session.latest(2)?.x).toBeCloseTo(12, 1);
  });

  it('interpolasi memakai snapshot 120 ms di belakang', () => {
    const harness = makeHost();
    const a = addClient(harness, 'Budi');
    const b = addClient(harness, 'Sari');
    b.session.sendState(state());
    for (let step = 0; step < 6; step++) {
      a.session.sendState(state({ x: step * 2 }));
      harness.host.tick();
      now += 100;
    }
    // hostTime() - 120 ms jatuh di antara dua snapshot terakhir.
    const sampled = b.session.sample(1, INTERPOLATION_DELAY_MS);
    expect(sampled).not.toBeNull();
    expect(sampled?.x).toBeGreaterThan(7);
    expect(sampled?.x).toBeLessThan(10.1);
  });

  it('klien yang keluar memicu playerLeave', () => {
    const harness = makeHost();
    const a = addClient(harness, 'Budi');
    const b = addClient(harness, 'Sari');
    b.session.close();
    expect(a.leaves).toEqual([2]);
    expect(harness.host.playerList()).toHaveLength(1);
  });
});

describe('validasi host', () => {
  it('menolak pesan dengan versi protokol berbeda', () => {
    const harness = makeHost();
    const a = addClient(harness, 'Budi');
    const bytes = encodeMessage({ type: 'chat', channel: 'session', fromId: 0, msgId: 0, timeMs: 0, text: 'halo' });
    bytes[0] = PROTOCOL_VERSION + 1;
    a.send(bytes, true);
    expect(harness.rejects.map((event) => event.reason)).toEqual(['version']);
    expect(a.chats).toEqual([]);
  });

  it('menolak pesan sebelum hello', () => {
    const harness = makeHost();
    const { transport } = harness.network.connect();
    transport.send(encodeMessage({ type: 'ping', nonce: 1 }), true);
    expect(harness.rejects.map((event) => event.reason)).toEqual(['not-joined']);
  });

  it('menolak username tidak valid dan hello ganda', () => {
    const harness = makeHost();
    const a = addClient(harness, 'Budi');
    a.session.join('Budi', DEFAULT_APPEARANCE);
    expect(harness.rejects.map((event) => event.reason)).toEqual(['already-joined']);
    const { transport } = harness.network.connect();
    transport.send(encodeMessage({ type: 'hello', username: 'a', appearance: DEFAULT_APPEARANCE }), true);
    expect(harness.rejects.at(-1)?.reason).toBe('username');
  });

  it('menolak sesi penuh (5 pemain lokal)', () => {
    const harness = makeHost();
    for (let index = 0; index < 5; index++) addClient(harness, `Pemain ${index}`);
    addClient(harness, 'Keenam');
    expect(harness.rejects.at(-1)?.reason).toBe('room-full');
    expect(harness.host.playerList()).toHaveLength(5);
  });

  it('anti-teleport: lompatan posisi yang tidak mungkin ditolak', () => {
    const harness = makeHost();
    const a = addClient(harness, 'Budi');
    a.session.sendState(state({ x: 0, z: 0 }));
    now += 100;
    a.session.sendState(state({ x: 200, z: 0 }));
    expect(harness.rejects.at(-1)?.reason).toBe('speed');
    expect(harness.host.playerState(1)?.x).toBeCloseTo(0, 1);
    // Gerak wajar diterima.
    a.session.sendState(state({ x: 1.5, z: 0 }));
    expect(harness.host.playerState(1)?.x).toBeCloseTo(1.5, 1);
  });

  it('posisi di luar batas peta tidak lolos decode', () => {
    const harness = makeHost();
    const a = addClient(harness, 'Budi');
    // Kuantisasi sudah menjepit ke dalam peta, jadi dicek lewat helper murni.
    expect(isPlausibleMove(null, { x: HALF_WORLD + 1, z: 0 }, 1000)).toBe(false);
    a.session.sendState(state({ x: HALF_WORLD + 500, z: 0 }));
    expect(harness.host.playerState(1)?.x).toBeCloseTo(HALF_WORLD, 0);
  });
});

describe('chat (MULTIPLAYER.md 5.1)', () => {
  it('3+ klien menerima pesan kanal sesi', () => {
    const harness = makeHost();
    const a = addClient(harness, 'Budi');
    const b = addClient(harness, 'Sari');
    const c = addClient(harness, 'Tono');
    a.session.sendChat('session', 'halo semua');
    for (const client of [a, b, c]) {
      expect(client.chats).toHaveLength(1);
      expect(client.chats[0]?.text).toBe('halo semua');
      expect(client.chats[0]?.fromId).toBe(1);
      expect(client.chats[0]?.channel).toBe('session');
    }
  });

  it('pesan dekat hanya sampai ke klien dalam radius 30 m', () => {
    const harness = makeHost();
    const a = addClient(harness, 'Budi');
    const b = addClient(harness, 'Sari');
    const c = addClient(harness, 'Tono');
    a.session.sendState(state({ x: 0, z: 0 }));
    b.session.sendState(state({ x: 25, z: 0 }));
    c.session.sendState(state({ x: 100, z: 0 }));
    a.session.sendChat('nearby', 'ada yang dekat?');
    expect(a.chats).toHaveLength(1);
    expect(b.chats).toHaveLength(1);
    expect(c.chats).toHaveLength(0);
  });

  it('rate limit 1 pesan/detik dengan burst 5', () => {
    const harness = makeHost();
    const a = addClient(harness, 'Budi');
    const b = addClient(harness, 'Sari');
    for (let index = 0; index < CHAT_BURST + 2; index++) a.session.sendChat('session', `pesan ${index}`);
    expect(b.chats).toHaveLength(CHAT_BURST);
    expect(harness.rejects.filter((event) => event.reason === 'rate-limit')).toHaveLength(2);
    // Setelah 1 detik ada satu token lagi.
    now += 1000;
    a.session.sendChat('session', 'lagi');
    expect(b.chats).toHaveLength(CHAT_BURST + 1);
  });

  it('teks lebih dari 200 karakter ditolak (klien dan host)', () => {
    const harness = makeHost();
    const a = addClient(harness, 'Budi');
    const b = addClient(harness, 'Sari');
    expect(a.session.sendChat('session', 'x'.repeat(CHAT_TEXT_MAX + 1))).toBe(false);
    expect(a.session.sendChat('session', '   ')).toBe(false);
    expect(b.chats).toHaveLength(0);
    // Klien nakal mengirim 201 karakter: ditolak host saat decode.
    const text = 'y'.repeat(CHAT_TEXT_MAX + 1);
    const packet = new Uint8Array(2 + 13 + text.length);
    const view = new DataView(packet.buffer);
    packet[0] = PROTOCOL_VERSION;
    packet[1] = 8;
    view.setUint16(13, text.length);
    packet.set(new TextEncoder().encode(text), 15);
    a.send(packet, true);
    expect(harness.rejects.at(-1)?.reason).toBe('text');
    expect(b.chats).toHaveLength(0);
    // Tepat 200 karakter diterima.
    expect(a.session.sendChat('session', 'z'.repeat(CHAT_TEXT_MAX))).toBe(true);
    expect(b.chats).toHaveLength(1);
  });

  it('host menyimpan 50 pesan terakhir per kanal', () => {
    const harness = makeHost();
    const a = addClient(harness, 'Budi');
    for (let index = 0; index < 60; index++) {
      now += 1000;
      a.session.sendChat('session', `pesan ${index}`);
    }
    const history = harness.host.chatHistory('session');
    expect(history).toHaveLength(CHAT_HISTORY_MAX);
    expect(history[history.length - 1]?.text).toBe('pesan 59');
    expect(harness.host.chatHistory('nearby')).toHaveLength(0);
  });

  it('pemain lokal host ikut mengirim dan menerima chat', () => {
    const harness = makeHost({ localPlayer: { username: 'Host', appearance: DEFAULT_APPEARANCE } });
    const a = addClient(harness, 'Budi');
    harness.host.setLocalState(state({ x: 0, z: 0 }));
    expect(harness.host.sendLocalChat('session', 'selamat datang')).toBe(true);
    expect(a.chats[0]?.text).toBe('selamat datang');
    a.session.sendChat('session', 'terima kasih');
    expect(harness.localChats.at(-1)?.text).toBe('terima kasih');
  });

  it('pemain baru tidak menerima riwayat lama', () => {
    const harness = makeHost();
    const a = addClient(harness, 'Budi');
    a.session.sendChat('session', 'sebelum join');
    const b = addClient(harness, 'Sari');
    expect(b.chats).toHaveLength(0);
  });
});

describe('kendaraan: siapa cepat dia dapat', () => {
  it('klaim kedua ditolak selama kendaraan dipakai', () => {
    const harness = makeHost();
    const a = addClient(harness, 'Budi');
    const b = addClient(harness, 'Sari');
    a.session.sendState(state({ x: 5.2, z: -4 }));
    b.session.sendState(state({ x: 5.4, z: -4 }));
    a.session.claimVehicle('v_spawn_bike', 'mount', { x: 5.2, z: -4, yaw: 0 });
    expect(harness.host.vehicle('v_spawn_bike')?.ownerId).toBe(1);
    expect(b.vehicles.at(-1)?.ownerId).toBe(1);
    b.session.claimVehicle('v_spawn_bike', 'mount', { x: 5.4, z: -4, yaw: 0 });
    expect(harness.rejects.at(-1)?.reason).toBe('vehicle-taken');
    expect(harness.host.vehicle('v_spawn_bike')?.ownerId).toBe(1);
  });

  it('turun mengembalikan kendaraan ke posisi baru dan bisa diambil pemain lain', () => {
    const harness = makeHost();
    const a = addClient(harness, 'Budi');
    const b = addClient(harness, 'Sari');
    a.session.sendState(state({ x: 5.2, z: -4 }));
    a.session.claimVehicle('v_spawn_bike', 'mount', { x: 5.2, z: -4, yaw: 0 });
    now += 1000;
    a.session.sendState(state({ x: 9, z: -4 }));
    a.session.claimVehicle('v_spawn_bike', 'release', { x: 9, z: -4, yaw: 1 });
    const parked = harness.host.vehicle('v_spawn_bike');
    expect(parked?.ownerId).toBe(0);
    expect(parked?.x).toBeCloseTo(9);
    expect(b.vehicles.at(-1)?.ownerId).toBe(0);
    b.session.sendState(state({ x: 9.5, z: -4 }));
    b.session.claimVehicle('v_spawn_bike', 'mount', { x: 9.5, z: -4, yaw: 0 });
    expect(harness.host.vehicle('v_spawn_bike')?.ownerId).toBe(2);
  });

  it('menolak kendaraan tak dikenal, terlalu jauh, dan turun oleh bukan pemilik', () => {
    const harness = makeHost();
    const a = addClient(harness, 'Budi');
    a.session.sendState(state({ x: 0, z: 0 }));
    a.session.claimVehicle('tidak_ada', 'mount', { x: 0, z: 0, yaw: 0 });
    expect(harness.rejects.at(-1)?.reason).toBe('vehicle-unknown');
    a.session.claimVehicle('v_96_96', 'mount', { x: 0, z: 0, yaw: 0 });
    expect(harness.rejects.at(-1)?.reason).toBe('vehicle-far');
    a.session.claimVehicle('v_spawn_car', 'release', { x: 0, z: 0, yaw: 0 });
    expect(harness.rejects.at(-1)?.reason).toBe('not-owner');
  });

  it('kendaraan kembali terparkir saat pemiliknya keluar', () => {
    const harness = makeHost();
    const a = addClient(harness, 'Budi');
    const b = addClient(harness, 'Sari');
    a.session.sendState(state({ x: 5.2, z: -4 }));
    a.session.claimVehicle('v_spawn_bike', 'mount', { x: 5.2, z: -4, yaw: 0 });
    a.session.close();
    expect(harness.host.vehicle('v_spawn_bike')?.ownerId).toBe(0);
    expect(b.vehicles.at(-1)?.ownerId).toBe(0);
  });

  it('kendaraan yang sedang dipakai dikirim ke pemain yang baru join', () => {
    const harness = makeHost();
    const a = addClient(harness, 'Budi');
    a.session.sendState(state({ x: 5.2, z: -4 }));
    a.session.claimVehicle('v_spawn_bike', 'mount', { x: 5.2, z: -4, yaw: 0 });
    const b = addClient(harness, 'Sari');
    expect(b.vehicles).toEqual([expect.objectContaining({ vehicleId: 'v_spawn_bike', ownerId: 1 })]);
  });
});

describe('jam, penampilan, ping', () => {
  it('host mengirim jam tiap 10 detik', () => {
    const harness = makeHost();
    const a = addClient(harness, 'Budi');
    harness.host.tick();
    expect(a.clocks).toEqual([120]);
    now += CLOCK_INTERVAL_MS - 1;
    harness.host.tick();
    expect(a.clocks).toHaveLength(1);
    now += 1;
    harness.host.tick();
    expect(a.clocks).toEqual([120, 120]);
  });

  it('perubahan penampilan diteruskan ke pemain lain saja', () => {
    const harness = makeHost();
    const a = addClient(harness, 'Budi');
    const b = addClient(harness, 'Sari');
    const look: Appearance = { ...DEFAULT_APPEARANCE, gender: 'f', hairStyle: 2, accessory: 1 };
    a.session.sendAppearance(look);
    expect(b.appearances).toEqual([[1, look]]);
    expect(a.appearances).toEqual([]);
    expect(harness.host.playerList()[0]?.appearance).toEqual(look);
  });

  it('ping menghasilkan pong dengan rtt', () => {
    const harness = makeHost();
    const a = addClient(harness, 'Budi');
    a.session.ping();
    expect(a.pings).toEqual([0]);
  });
});

describe('helper AOI dan interpolasi (fungsi murni)', () => {
  it('tier AOI mengikuti radius 120 / 250 m', () => {
    expect(aoiTier(0)).toBe('near');
    expect(aoiTier(120)).toBe('near');
    expect(aoiTier(120.1)).toBe('mid');
    expect(aoiTier(250)).toBe('mid');
    expect(aoiTier(251)).toBe('far');
    expect(AOI_INTERVAL_MS.near).toBeCloseTo(1000 / 15);
    expect(AOI_INTERVAL_MS.mid).toBeCloseTo(1000 / 3);
    expect(AOI_INTERVAL_MS.far).toBe(2000);
  });

  it('aoiDue memakai frekuensi per tier', () => {
    expect(aoiDue(10, undefined, 0)).toBe(true);
    expect(aoiDue(10, 0, 50)).toBe(false);
    expect(aoiDue(10, 0, 67)).toBe(true);
    expect(aoiDue(200, 0, 100)).toBe(false);
    expect(aoiDue(200, 0, 334)).toBe(true);
    // Toleransi 1 ms disengaja supaya tick yang sedikit cepat tidak melewatkan satu siklus.
    expect(aoiDue(400, 0, 1998)).toBe(false);
    expect(aoiDue(400, 0, 1999)).toBe(true);
    expect(aoiDue(400, 0, 2000)).toBe(true);
  });

  it('host menerapkan AOI: pemain jauh dikirim lebih jarang', () => {
    const harness = makeHost();
    const a = addClient(harness, 'Budi');
    const b = addClient(harness, 'Sari');
    a.session.sendState(state({ x: 0, z: 0 }));
    b.session.sendState(state({ x: 300, z: 0 }));
    harness.host.tick();
    const first = b.session.latest(1);
    expect(first).not.toBeNull();
    now += 100;
    a.session.sendState(state({ x: 1, z: 0 }));
    harness.host.tick();
    // Jarak 300 m masuk tier 'far' (2 detik), jadi belum ada update baru.
    expect(b.session.latest(1)?.x).toBeCloseTo(first?.x ?? -1, 3);
    now += 2000;
    harness.host.tick();
    expect(b.session.latest(1)?.x).toBeCloseTo(1, 1);
  });

  it('interpolasi linier antar dua snapshot', () => {
    const buffer: TimedSnapshot[] = [
      { t: 0, snap: { id: 1, x: 0, y: 0, z: 0, heading: 0, mode: 'walk', anim: 'walk', jumping: false } },
      { t: 100, snap: { id: 1, x: 10, y: 2, z: -10, heading: 1, mode: 'walk', anim: 'walk', jumping: false } },
    ];
    const mid = interpolateSnapshots(buffer, 50);
    expect(mid?.x).toBeCloseTo(5);
    expect(mid?.y).toBeCloseTo(1);
    expect(mid?.z).toBeCloseTo(-5);
    expect(mid?.heading).toBeCloseTo(0.5);
    expect(interpolateSnapshots(buffer, -10)?.x).toBe(0);
    expect(interpolateSnapshots(buffer, 999)?.x).toBe(10);
    expect(interpolateSnapshots([], 0)).toBeNull();
  });

  it('interpolasi sudut lewat jalur terpendek', () => {
    expect(lerpAngle(0.1, Math.PI * 2 - 0.1, 0.5)).toBeCloseTo(0, 5);
    expect(lerpAngle(0, Math.PI / 2, 0.5)).toBeCloseTo(Math.PI / 4);
  });

  it('pushSnapshot mengabaikan snapshot telat dan membatasi buffer', () => {
    const snapAt = (t: number): TimedSnapshot => ({
      t,
      snap: { id: 1, x: t, y: 0, z: 0, heading: 0, mode: 'walk', anim: 'idle', jumping: false },
    });
    let buffer: TimedSnapshot[] = [];
    for (const t of [0, 100, 200]) buffer = pushSnapshot(buffer, snapAt(t));
    buffer = pushSnapshot(buffer, snapAt(150));
    expect(buffer.map((item) => item.t)).toEqual([0, 100, 200]);
    for (let t = 300; t < 3000; t += 100) buffer = pushSnapshot(buffer, snapAt(t));
    expect(buffer).toHaveLength(20);
  });

  it('isPlausibleMove mengikuti kecepatan maksimum', () => {
    expect(isPlausibleMove({ x: 0, z: 0 }, { x: 2, z: 0 }, 100)).toBe(true);
    expect(isPlausibleMove({ x: 0, z: 0 }, { x: 50, z: 0 }, 100)).toBe(false);
    expect(isPlausibleMove(null, { x: 100, z: 100 }, 0)).toBe(true);
  });

  it('token bucket dan pushHistory', () => {
    const bucket = newRateBucket(0);
    for (let index = 0; index < CHAT_BURST; index++) expect(takeToken(bucket, 0)).toBe(true);
    expect(takeToken(bucket, 0)).toBe(false);
    expect(takeToken(bucket, 1000)).toBe(true);
    expect(pushHistory([1, 2, 3], 4, 3)).toEqual([2, 3, 4]);
  });
});

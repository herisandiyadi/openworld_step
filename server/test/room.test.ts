import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE } from '../src/appearance.js';
import { decodeMessage, type NetMessage, type PlayerSnapshot } from '../src/protocol.js';
import { generateRoomCode, isRoomCode, Room, RoomManager, ROOM_CODE_ALPHABET, type Connection } from '../src/room.js';

class FakeConn implements Connection {
  bufferedAmount = 0;
  readonly received: NetMessage[] = [];
  send(data: Uint8Array): void {
    const decoded = decodeMessage(data);
    if (!decoded.ok) throw new Error(`server mengirim pesan rusak: ${decoded.error}`);
    this.received.push(decoded.message);
  }
  ofType<T extends NetMessage['type']>(type: T): Extract<NetMessage, { type: T }>[] {
    return this.received.filter((m) => m.type === type) as Extract<NetMessage, { type: T }>[];
  }
  clear(): void {
    this.received.length = 0;
  }
}

const pose = (x: number, z: number): PlayerSnapshot => ({ id: 0, x, y: 0, z, heading: 0, mode: 'walk', anim: 'walk', jumping: false });

function setup(count: number) {
  let now = 1_000_000;
  const clock = { advance: (ms: number) => (now += ms) };
  const room = new Room('ABCDEF', { now: () => now });
  const players = [];
  for (let i = 0; i < count; i++) {
    const conn = new FakeConn();
    const result = room.join(room.issueToken(), conn, `Bot ${i}`, DEFAULT_APPEARANCE);
    if (!result.ok) throw new Error(result.reason);
    players.push({ conn, player: result.player });
  }
  return { room, players, clock };
}

describe('kode room', () => {
  it('6 karakter tanpa 0/O/1/I/L', () => {
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[0O1IL]/);
    for (let i = 0; i < 2000; i++) {
      const code = generateRoomCode();
      expect(code).toHaveLength(6);
      expect(isRoomCode(code)).toBe(true);
    }
    expect(isRoomCode('ABC0EF')).toBe(false);
  });

  it('room kosong kedaluwarsa setelah TTL, room berisi tidak', () => {
    let now = 0;
    const manager = new RoomManager({ now: () => now, emptyTtlMs: 1000 });
    const empty = manager.create();
    const busy = manager.create();
    if (!empty || !busy) throw new Error('room');
    busy.join(busy.issueToken(), new FakeConn(), 'Budi', DEFAULT_APPEARANCE);
    now = 1500;
    expect(manager.sweep()).toEqual([empty.code]);
    expect(manager.get(busy.code)).toBe(busy);
  });
});

describe('join', () => {
  it('welcome berisi diri sendiri, playerJoin ke yang lain, tanpa riwayat chat', () => {
    const { room, players } = setup(1);
    const first = players[0]!;
    first.player.state = { ...pose(0, 0), id: first.player.info.id };
    room.relayChat(first.player, 'session', 'halo sebelum join');
    const conn = new FakeConn();
    const result = room.join(room.issueToken(), conn, '  Sari   Dewi ', DEFAULT_APPEARANCE);
    expect(result.ok).toBe(true);
    const welcome = conn.ofType('welcome')[0]!;
    expect(welcome.players.map((p) => p.username)).toEqual(['Bot 0', 'Sari Dewi']);
    expect(conn.ofType('chat')).toHaveLength(0);
    expect(first.conn.ofType('playerJoin')[0]?.player.username).toBe('Sari Dewi');
  });

  it('username tidak valid ditolak (aturan klien 2-20 karakter)', () => {
    const room = new Room('ABCDEF');
    for (const name of ['A', 'x'.repeat(21), '<script>', ' _abc', '']) {
      expect(room.join(room.issueToken(), new FakeConn(), name, DEFAULT_APPEARANCE)).toEqual({ ok: false, reason: 'username' });
    }
    expect(room.join(room.issueToken(), new FakeConn(), 'Ánh 2', DEFAULT_APPEARANCE).ok).toBe(true);
  });

  it('maksimal 50 pemain', () => {
    const { room } = setup(50);
    expect(room.join(room.issueToken(), new FakeConn(), 'Pemain51', DEFAULT_APPEARANCE)).toEqual({ ok: false, reason: 'room-full' });
  });

  it('token tidak dikenal atau sedang dipakai ditolak', () => {
    const room = new Room('ABCDEF');
    expect(room.join('palsu', new FakeConn(), 'Budi', DEFAULT_APPEARANCE).ok).toBe(false);
    const token = room.issueToken();
    const first = room.join(token, new FakeConn(), 'Budi', DEFAULT_APPEARANCE);
    expect(first.ok).toBe(true);
    expect(room.join(token, new FakeConn(), 'Budi', DEFAULT_APPEARANCE).ok).toBe(false);
    // Setelah keluar, token boleh dipakai untuk reconnect.
    if (first.ok) room.leave(first.player);
    expect(room.join(token, new FakeConn(), 'Budi', DEFAULT_APPEARANCE).ok).toBe(true);
  });
});

describe('state dan AOI di room', () => {
  it('anti-teleport menolak lompatan dan id klien diabaikan', () => {
    const { room, players, clock } = setup(1);
    const p = players[0]!.player;
    room.handle(p, { type: 'state', timeMs: 0, players: [{ ...pose(0, 0), id: 999 }] });
    expect(p.state?.id).toBe(p.info.id);
    clock.advance(100);
    room.handle(p, { type: 'state', timeMs: 0, players: [pose(100, 0)] });
    expect(p.state?.x).toBe(0);
    expect(room.stats.rejected.speed).toBe(1);
  });

  it('pemain jauh tidak menerima update 15 Hz, pemain dekat menerima', () => {
    const { room, players, clock } = setup(3);
    const [a, near, far] = players as [typeof players[0], typeof players[0], typeof players[0]];
    room.handle(a!.player, { type: 'state', timeMs: 0, players: [pose(0, 0)] });
    room.handle(near!.player, { type: 'state', timeMs: 0, players: [pose(30, 0)] });
    room.handle(far!.player, { type: 'state', timeMs: 0, players: [pose(-250, -250)] });
    for (const p of players) p.conn.clear();
    const seen = new Map<number, number>();
    for (let tick = 0; tick < 30; tick++) {
      room.tick();
      clock.advance(1000 / 15);
    }
    for (const message of a!.conn.ofType('state')) for (const s of message.players) seen.set(s.id, (seen.get(s.id) ?? 0) + 1);
    expect(seen.get(near!.player.info.id)).toBe(30);
    expect(seen.get(far!.player.info.id) ?? 0).toBeLessThanOrEqual(1);
    // Pemain jauh juga hanya melihat pemain A sesekali.
    const farSeen = far!.conn.ofType('state').flatMap((m) => m.players).filter((s) => s.id === a!.player.info.id).length;
    expect(farSeen).toBeLessThanOrEqual(1);
  });

  it('penampilan baru dikirim sekali saat subjek ada di AOI, tidak tiap tick', () => {
    const { room, players, clock } = setup(2);
    const [a, b] = players as [typeof players[0], typeof players[0]];
    room.handle(a!.player, { type: 'state', timeMs: 0, players: [pose(0, 0)] });
    room.handle(b!.player, { type: 'state', timeMs: 0, players: [pose(10, 0)] });
    room.handle(b!.player, { type: 'appearance', playerId: 0, appearance: { ...DEFAULT_APPEARANCE, gender: 'f' } });
    a!.conn.clear();
    for (let i = 0; i < 20; i++) {
      room.tick();
      clock.advance(70);
    }
    const looks = a!.conn.ofType('appearance');
    expect(looks).toHaveLength(1);
    expect(looks[0]).toEqual({ type: 'appearance', playerId: b!.player.info.id, appearance: { ...DEFAULT_APPEARANCE, gender: 'f' } });
  });

  it('jam dikirim tiap 10 detik', () => {
    const { room, players, clock } = setup(1);
    players[0]!.conn.clear();
    for (let i = 0; i < 25; i++) {
      room.tick();
      clock.advance(1000);
    }
    expect(players[0]!.conn.ofType('clock')).toHaveLength(3);
  });
});

describe('chat', () => {
  it('nearby hanya ke pemain dalam 30 m (posisi server), session ke semua', () => {
    const { room, players } = setup(3);
    const [a, near, far] = players as [typeof players[0], typeof players[0], typeof players[0]];
    room.handle(a!.player, { type: 'state', timeMs: 0, players: [pose(0, 0)] });
    room.handle(near!.player, { type: 'state', timeMs: 0, players: [pose(20, 0)] });
    room.handle(far!.player, { type: 'state', timeMs: 0, players: [pose(40, 0)] });
    for (const p of players) p.conn.clear();
    room.handle(a!.player, { type: 'chat', channel: 'nearby', fromId: 0, msgId: 0, timeMs: 0, text: ' rahasia\u0007 dekat ' });
    expect(a!.conn.ofType('chat')[0]?.text).toBe('rahasia dekat');
    expect(near!.conn.ofType('chat')).toHaveLength(1);
    expect(far!.conn.ofType('chat')).toHaveLength(0);
    room.handle(a!.player, { type: 'chat', channel: 'session', fromId: 0, msgId: 0, timeMs: 0, text: 'semua' });
    expect(far!.conn.ofType('chat').map((m) => m.text)).toEqual(['semua']);
    expect(far!.conn.ofType('chat')[0]?.fromId).toBe(a!.player.info.id);
  });

  it('rate limit 1/detik burst 5', () => {
    const { room, players, clock } = setup(1);
    const p = players[0]!;
    for (let i = 0; i < 8; i++) room.handle(p.player, { type: 'chat', channel: 'session', fromId: 0, msgId: 0, timeMs: 0, text: `m${i}` });
    expect(p.conn.ofType('chat')).toHaveLength(5);
    clock.advance(1000);
    room.handle(p.player, { type: 'chat', channel: 'session', fromId: 0, msgId: 0, timeMs: 0, text: 'lagi' });
    expect(p.conn.ofType('chat')).toHaveLength(6);
    expect(room.stats.rejected['rate-limit']).toBe(3);
  });
});

describe('kendaraan', () => {
  it('siapa cepat dia dapat; turun hanya oleh pemilik; pemilik keluar → terparkir', () => {
    const { room, players } = setup(2);
    const [a, b] = players as [typeof players[0], typeof players[0]];
    room.handle(a!.player, { type: 'state', timeMs: 0, players: [pose(5, -4)] });
    room.handle(b!.player, { type: 'state', timeMs: 0, players: [pose(5, -3)] });
    room.handle(a!.player, { type: 'vehicleClaim', vehicleId: 'v_spawn_bike', action: 'mount', x: 0, z: 0, yaw: 0 });
    expect(room.vehicles.get('v_spawn_bike')?.ownerId).toBe(a!.player.info.id);
    b!.conn.clear();
    room.handle(b!.player, { type: 'vehicleClaim', vehicleId: 'v_spawn_bike', action: 'mount', x: 0, z: 0, yaw: 0 });
    expect(room.stats.rejected['vehicle-taken']).toBe(1);
    expect(b!.conn.ofType('vehicleState')[0]?.ownerId).toBe(a!.player.info.id);
    room.handle(b!.player, { type: 'vehicleClaim', vehicleId: 'v_spawn_bike', action: 'release', x: 5, z: -3, yaw: 0 });
    expect(room.stats.rejected['not-owner']).toBe(1);
    room.handle(a!.player, { type: 'vehicleClaim', vehicleId: 'tidak_ada', action: 'mount', x: 0, z: 0, yaw: 0 });
    expect(room.stats.rejected['vehicle-unknown']).toBe(1);
    b!.conn.clear();
    room.leave(a!.player);
    expect(room.vehicles.get('v_spawn_bike')?.ownerId).toBe(0);
    expect(b!.conn.ofType('vehicleState')[0]?.ownerId).toBe(0);
    expect(b!.conn.ofType('playerLeave')[0]?.playerId).toBe(a!.player.info.id);
  });

  it('klaim dari jarak > 6 m ditolak', () => {
    const { room, players } = setup(1);
    const p = players[0]!.player;
    room.handle(p, { type: 'state', timeMs: 0, players: [pose(50, 50)] });
    room.handle(p, { type: 'vehicleClaim', vehicleId: 'v_spawn_bike', action: 'mount', x: 0, z: 0, yaw: 0 });
    expect(room.stats.rejected['vehicle-far']).toBe(1);
    expect(room.vehicles.get('v_spawn_bike')?.ownerId).toBe(0);
  });
});

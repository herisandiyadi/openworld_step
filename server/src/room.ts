import { randomBytes, randomInt } from 'node:crypto';
import { AOI_MID_RADIUS, aoiDue, aoiTier, SpatialGrid, type AoiTier } from './aoi.js';
import { normalizeUsername, validateUsername, type Appearance } from './appearance.js';
import {
  DAY_SECONDS,
  encodeMessage,
  isReliable,
  sanitizeText,
  isValidChatText,
  type ChatChannel,
  type NetMessage,
  type PlayerId,
  type PlayerInfo,
  type PlayerSnapshot,
  type VehicleStateMessage,
} from './protocol.js';
import {
  distance2d,
  isPlausibleMove,
  NEARBY_CHAT_RADIUS,
  newRateBucket,
  takeToken,
  VEHICLE_REACH,
  type RateBucket,
  type RejectReason,
} from './validate.js';
import { INITIAL_VEHICLES } from './vehicles.js';

/* ------------------------------------------------------------------------------------------------
 * Konstanta room (MULTIPLAYER.md 4.1, 5.1, 6)
 * ---------------------------------------------------------------------------------------------- */

export const MAX_PLAYERS_ONLINE = 50;
/** Jam siang-malam dikirim tiap 10 detik. */
export const CLOCK_INTERVAL_MS = 10_000;
/** Riwayat chat di memori per kanal (tidak pernah dikirim ke pemain baru, tidak ditulis ke disk). */
export const CHAT_HISTORY_MAX = 50;
/** Kode room: 6 karakter tanpa karakter ambigu (0/O, 1/I/L). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;
/** Room kosong dihapus setelah masa tenggang ini (memberi waktu pembuat room untuk tersambung). */
export const ROOM_EMPTY_TTL_MS = 60_000;
/** Kalau buffer kirim WebSocket melebihi ini, snapshot `state` (unreliable) dibuang untuk koneksi itu. */
export const UNRELIABLE_DROP_BYTES = 64 * 1024;
export const FISHING_SPOT_TTL_MS = 5_000;

interface FishingReservation {
  playerId: PlayerId;
  heartbeatAt: number;
}

export function generateRoomCode(): string {
  let code = '';
  for (let index = 0; index < ROOM_CODE_LENGTH; index++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  return code;
}

export const isRoomCode = (value: string): boolean =>
  value.length === ROOM_CODE_LENGTH && [...value].every((char) => ROOM_CODE_ALPHABET.includes(char));

/** Token sesi anonim (144 bit acak, base64url). */
export const generateToken = (): string => randomBytes(18).toString('base64url');

/** Sisi koneksi yang dilihat room. Server membungkus WebSocket; test memakai objek palsu. */
export interface Connection {
  send(data: Uint8Array): void;
  /** Byte yang masih antre di socket; dipakai untuk membuang pesan unreliable saat macet. */
  readonly bufferedAmount: number;
}

export interface ChatEntry {
  id: number;
  channel: ChatChannel;
  fromId: PlayerId;
  timeMs: number;
  text: string;
}

export interface VehicleInfo {
  vehicleId: string;
  ownerId: PlayerId;
  x: number;
  z: number;
  yaw: number;
}

export interface RoomPlayer {
  info: PlayerInfo;
  token: string;
  conn: Connection;
  state: PlayerSnapshot | null;
  stateAtMs: number;
  chat: RateBucket;
  /** Waktu terakhir posisi subjek X dikirim ke pemain ini (AOI). */
  lastSent: Map<PlayerId, number>;
  /** Versi penampilan subjek X yang sudah diketahui pemain ini (dikirim sekali per versi, 3.1). */
  knownAppearance: Map<PlayerId, number>;
  /** Naik setiap kali pemain ini mengganti penampilan. */
  appearanceVersion: number;
}

export interface RoomStats {
  bytesOut: number;
  messagesOut: number;
  droppedUnreliable: number;
  rejected: Partial<Record<RejectReason, number>>;
}

export interface RoomOptions {
  now?: () => number;
  maxPlayers?: number;
  /** Jam dunia awal (detik). */
  startTimeOfDay?: number;
  /** Kunci kompatibilitas konten dunia: semua pemain di room harus memakai versi yang sama. */
  worldVersion?: string;
  onReject?: (code: string, playerId: PlayerId | null, reason: RejectReason) => void;
}

export type HelloResult = { ok: true; player: RoomPlayer } | { ok: false; reason: RejectReason };

/**
 * Satu room in-memory. Perilaku host-authoritative SAMA dengan HostSession di
 * web/src/net/session.ts (mode server/relay, tanpa pemain lokal), ditambah AOI berbasis grid,
 * penampilan sekali per AOI, dan token sesi.
 */
export class Room {
  readonly players = new Map<PlayerId, RoomPlayer>();
  readonly vehicles = new Map<string, VehicleInfo>();
  private readonly fishingReservations = new Map<string, FishingReservation>();
  readonly worldVersion: string;
  readonly history: Record<ChatChannel, ChatEntry[]> = { session: [], nearby: [] };
  /** Token yang diterbitkan untuk room ini (token → playerId atau null kalau belum dipakai). */
  readonly tokens = new Map<string, PlayerId | null>();
  readonly stats: RoomStats = { bytesOut: 0, messagesOut: 0, droppedUnreliable: 0, rejected: {} };
  readonly createdAtMs: number;
  /** Waktu room terakhir kali menjadi kosong (atau dibuat); null kalau ada pemain. */
  emptySinceMs: number | null;

  private readonly now: () => number;
  private readonly maxPlayers: number;
  private readonly startTimeOfDay: number;
  private readonly grid = new SpatialGrid();
  private nextPlayerId = 1;
  private nextChatId = 1;
  private lastClockMs = -Infinity;

  constructor(readonly code: string, private readonly options: RoomOptions = {}) {
    this.now = options.now ?? Date.now;
    this.maxPlayers = options.maxPlayers ?? MAX_PLAYERS_ONLINE;
    this.startTimeOfDay = options.startTimeOfDay ?? DAY_SECONDS * 0.35;
    this.worldVersion = options.worldVersion ?? 'legacy';
    this.createdAtMs = this.now();
    this.emptySinceMs = this.createdAtMs;
    for (const vehicle of INITIAL_VEHICLES) {
      this.vehicles.set(vehicle.id, { vehicleId: vehicle.id, ownerId: 0, x: vehicle.x, z: vehicle.z, yaw: vehicle.yaw });
    }
  }

  get size(): number {
    return this.players.size;
  }

  get isFull(): boolean {
    return this.players.size >= this.maxPlayers;
  }

  /** Jam siang-malam (detik, 0..480) berjalan mengikuti waktu nyata sejak room dibuat. */
  timeOfDay(): number {
    return (this.startTimeOfDay + (this.now() - this.createdAtMs) / 1000) % DAY_SECONDS;
  }

  /** Token sesi anonim baru untuk room ini. */
  issueToken(): string {
    const token = generateToken();
    this.tokens.set(token, null);
    return token;
  }

  /** Token sah dan tidak sedang dipakai koneksi lain. */
  canUseToken(token: string): boolean {
    return this.tokens.has(token) && this.tokens.get(token) === null;
  }

  playerList(): PlayerInfo[] {
    return [...this.players.values()].map((player) => player.info);
  }

  fishingSpotOwner(spotId: string): PlayerId | null {
    return this.fishingReservations.get(spotId)?.playerId ?? null;
  }

  private reject(player: RoomPlayer | null, reason: RejectReason): void {
    this.stats.rejected[reason] = (this.stats.rejected[reason] ?? 0) + 1;
    this.options.onReject?.(this.code, player?.info.id ?? null, reason);
  }

  /** Mencatat penolakan dari lapisan server (decode, rate limit umum) ke statistik room. */
  countReject(reason: RejectReason, playerId: PlayerId | null): void {
    this.stats.rejected[reason] = (this.stats.rejected[reason] ?? 0) + 1;
    this.options.onReject?.(this.code, playerId, reason);
  }

  private allocateId(): PlayerId {
    // Lewati id yang masih dipakai (relevan kalau room hidup lama dan id berputar di 65535).
    for (let attempt = 0; attempt < 0xffff; attempt++) {
      const id = this.nextPlayerId;
      this.nextPlayerId = this.nextPlayerId >= 0xffff ? 1 : this.nextPlayerId + 1;
      if (!this.players.has(id)) return id;
    }
    throw new Error('Id pemain habis.');
  }

  private sendRaw(player: RoomPlayer, data: Uint8Array, reliable: boolean): void {
    if (!reliable && player.conn.bufferedAmount > UNRELIABLE_DROP_BYTES) {
      this.stats.droppedUnreliable++;
      return;
    }
    player.conn.send(data);
    this.stats.bytesOut += data.length;
    this.stats.messagesOut++;
  }

  private sendTo(player: RoomPlayer, message: NetMessage): void {
    this.sendRaw(player, encodeMessage(message), isReliable(message.type));
  }

  private broadcast(message: NetMessage, except?: RoomPlayer): void {
    const data = encodeMessage(message);
    const reliable = isReliable(message.type);
    for (const player of this.players.values()) {
      if (player !== except) this.sendRaw(player, data, reliable);
    }
  }

  /**
   * Pesan `hello`: validasi username (aturan profile.ts), kapasitas room, lalu kirim `welcome`
   * ke pemain baru dan `playerJoin` ke yang lain. Riwayat chat tidak dikirim (5.1).
   */
  join(token: string, conn: Connection, username: string, appearance: Appearance): HelloResult {
    if (!this.canUseToken(token)) {
      this.reject(null, 'not-joined');
      return { ok: false, reason: 'not-joined' };
    }
    if (validateUsername(username) !== null) {
      this.reject(null, 'username');
      return { ok: false, reason: 'username' };
    }
    if (this.isFull) {
      this.reject(null, 'room-full');
      return { ok: false, reason: 'room-full' };
    }
    const id = this.allocateId();
    const info: PlayerInfo = { id, username: normalizeUsername(username), appearance };
    const player: RoomPlayer = {
      info,
      token,
      conn,
      state: null,
      stateAtMs: 0,
      chat: newRateBucket(this.now()),
      lastSent: new Map(),
      knownAppearance: new Map(),
      appearanceVersion: 0,
    };
    this.players.set(id, player);
    this.tokens.set(token, id);
    this.emptySinceMs = null;
    // `welcome` dan `playerJoin` di wire wajib membawa penampilan, jadi itulah pengiriman "sekali" untuk
    // pemain yang sudah ada saat join. Perubahan berikutnya dikirim saat subjek masuk AOI (lihat tick).
    this.sendTo(player, { type: 'welcome', playerId: id, timeOfDay: this.timeOfDay(), players: this.playerList() });
    for (const other of this.players.values()) {
      player.knownAppearance.set(other.info.id, other.appearanceVersion);
      if (other !== player) other.knownAppearance.set(id, player.appearanceVersion);
    }
    this.broadcast({ type: 'playerJoin', player: info }, player);
    for (const vehicle of this.vehicles.values()) {
      if (vehicle.ownerId !== 0) this.sendTo(player, this.vehicleMessage(vehicle));
    }
    // Jam langsung dikirim supaya pemain baru sinkron tanpa menunggu 10 detik.
    this.sendTo(player, { type: 'clock', timeOfDay: this.timeOfDay(), timeMs: this.now() >>> 0 });
    return { ok: true, player };
  }

  /** Pemain keluar: kendaraannya kembali terparkir, yang lain menerima `playerLeave`. */
  leave(player: RoomPlayer): void {
    const id = player.info.id;
    if (this.players.get(id) !== player) return;
    this.players.delete(id);
    // Token boleh dipakai lagi untuk reconnect (mendapat id pemain baru).
    if (this.tokens.has(player.token)) this.tokens.set(player.token, null);
    for (const other of this.players.values()) {
      other.lastSent.delete(id);
      other.knownAppearance.delete(id);
    }
    for (const vehicle of this.vehicles.values()) {
      if (vehicle.ownerId !== id) continue;
      vehicle.ownerId = 0;
      this.broadcast(this.vehicleMessage(vehicle));
    }
    for (const [spotId, reservation] of this.fishingReservations) {
      if (reservation.playerId !== id) continue;
      this.fishingReservations.delete(spotId);
      this.broadcast({ type: 'fishingRelease', playerId: id, spotId });
    }
    this.broadcast({ type: 'playerLeave', playerId: id });
    if (this.players.size === 0) this.emptySinceMs = this.now();
  }

  /** Pesan dari pemain yang sudah join (sudah lolos validateIncoming). */
  handle(player: RoomPlayer, message: NetMessage): void {
    switch (message.type) {
      case 'hello':
        this.reject(player, 'already-joined');
        return;
      case 'state':
        this.handleState(player, message.players);
        return;
      case 'appearance':
        // Penampilan sudah lewat decodeAppearanceOrDefault: nilai tidak valid jadi default.
        player.info = { ...player.info, appearance: message.appearance };
        player.appearanceVersion++;
        // Pengirim sendiri tahu penampilannya; pemain lain menerimanya saat subjek ada di AOI (tick).
        player.knownAppearance.set(player.info.id, player.appearanceVersion);
        return;
      case 'chat':
        this.relayChat(player, message.channel, message.text);
        return;
      case 'vehicleClaim':
        this.handleVehicleClaim(player, message.vehicleId, message.action, message.x, message.z, message.yaw);
        return;
      case 'fishingReserve':
        this.handleFishingReservation(player, 'reserve', message.spotId);
        return;
      case 'fishingRelease':
        this.handleFishingReservation(player, 'release', message.spotId);
        return;
      case 'fishingState':
        // Id dari klien diabaikan: server yang menentukan pengirimnya.
        this.broadcast(
          { type: 'fishingState', playerId: player.info.id, sequence: message.sequence, payload: message.payload },
          player,
        );
        return;
      case 'ping':
        this.sendTo(player, { type: 'pong', nonce: message.nonce });
        return;
      default:
        this.reject(player, 'unexpected');
    }
  }

  private handleState(player: RoomPlayer, entries: PlayerSnapshot[]): void {
    const entry = entries[0];
    if (entries.length !== 1 || !entry) {
      this.reject(player, 'field');
      return;
    }
    const nowMs = this.now();
    if (!isPlausibleMove(player.state, entry, nowMs - player.stateAtMs)) {
      this.reject(player, 'speed');
      return;
    }
    // Id dari klien diabaikan: server yang menentukan pengirimnya.
    player.state = { ...entry, id: player.info.id };
    player.stateAtMs = nowMs;
  }

  /** Relay chat: `session` ke semua, `nearby` hanya ke pemain dalam 30 m (posisi versi server). */
  relayChat(player: RoomPlayer, channel: ChatChannel, rawText: string): boolean {
    const text = sanitizeText(rawText);
    if (!isValidChatText(text)) {
      this.reject(player, 'chat-text');
      return false;
    }
    if (!takeToken(player.chat, this.now())) {
      this.reject(player, 'rate-limit');
      return false;
    }
    const entry: ChatEntry = { id: this.nextChatId++, channel, fromId: player.info.id, timeMs: this.now() >>> 0, text };
    const list = this.history[channel];
    list.push(entry);
    if (list.length > CHAT_HISTORY_MAX) list.splice(0, list.length - CHAT_HISTORY_MAX);
    const data = encodeMessage({ type: 'chat', channel, fromId: entry.fromId, msgId: entry.id, timeMs: entry.timeMs, text });
    for (const recipient of this.players.values()) {
      if (channel === 'nearby' && !this.withinNearby(player, recipient)) continue;
      this.sendRaw(recipient, data, true);
    }
    return true;
  }

  private withinNearby(sender: RoomPlayer, recipient: RoomPlayer): boolean {
    if (sender === recipient) return true;
    if (!sender.state || !recipient.state) return false;
    return distance2d(sender.state, recipient.state) <= NEARBY_CHAT_RADIUS;
  }

  private handleVehicleClaim(player: RoomPlayer, vehicleId: string, action: 'mount' | 'release', x: number, z: number, yaw: number): void {
    const vehicle = this.vehicles.get(vehicleId);
    if (!vehicle) {
      this.reject(player, 'vehicle-unknown');
      return;
    }
    if (action === 'mount') {
      // Siapa cepat dia dapat: klaim kedua ditolak dan pengirim diberi tahu pemilik sekarang.
      if (vehicle.ownerId !== 0) {
        this.reject(player, 'vehicle-taken');
        this.sendTo(player, this.vehicleMessage(vehicle));
        return;
      }
      if (!player.state || distance2d(player.state, vehicle) > VEHICLE_REACH) {
        this.reject(player, 'vehicle-far');
        this.sendTo(player, this.vehicleMessage(vehicle));
        return;
      }
      vehicle.ownerId = player.info.id;
    } else {
      if (vehicle.ownerId !== player.info.id) {
        this.reject(player, 'not-owner');
        return;
      }
      if (player.state && distance2d(player.state, { x, z }) > VEHICLE_REACH) {
        this.reject(player, 'vehicle-far');
        return;
      }
      vehicle.ownerId = 0;
      vehicle.x = x;
      vehicle.z = z;
      vehicle.yaw = yaw;
    }
    this.broadcast(this.vehicleMessage(vehicle));
  }

  private vehicleMessage(vehicle: VehicleInfo): VehicleStateMessage {
    return { type: 'vehicleState', vehicleId: vehicle.vehicleId, ownerId: vehicle.ownerId, x: vehicle.x, z: vehicle.z, yaw: vehicle.yaw };
  }

  /**
   * Reservasi titik pancing (FISHING.md 8): klaim pertama menang; klaim kedua ditolak dan
   * pengirim diberi tahu pemilik sekarang lewat `fishingReserve` versi server. Lepas hanya
   * boleh oleh pemilik. Pemilik bisa mengulang `fishingReserve` sebagai detak jantung.
   */
  private handleFishingReservation(player: RoomPlayer, action: 'reserve' | 'release', spotId: string): boolean {
    const id = player.info.id;
    if (action === 'reserve') {
      const ownerId = this.fishingReservations.get(spotId)?.playerId;
      if (ownerId !== undefined && ownerId !== id) {
        this.reject(player, 'spot-taken');
        return false;
      }
      this.fishingReservations.set(spotId, { playerId: id, heartbeatAt: this.now() });
      this.broadcast({ type: 'fishingReserve', playerId: id, spotId }, player);
      return true;
    }
    const ownerId = this.fishingReservations.get(spotId)?.playerId;
    if (ownerId !== id) {
      this.reject(player, 'not-owner');
      return false;
    }
    this.fishingReservations.delete(spotId);
    this.broadcast({ type: 'fishingRelease', playerId: id, spotId }, player);
    return true;
  }

  /**
   * Dipanggil 15 Hz: snapshot posisi per penerima sesuai AOI (grid 64 m), penampilan yang belum
   * diketahui penerima untuk subjek di AOI dekat/menengah, dan jam tiap 10 detik.
   * Mengembalikan tier tiap pasangan yang dikirim (dipakai test).
   */
  tick(): Map<PlayerId, Map<PlayerId, AoiTier>> {
    const nowMs = this.now();
    const sent = new Map<PlayerId, Map<PlayerId, AoiTier>>();
    this.grid.clear();
    const active: RoomPlayer[] = [];
    for (const player of this.players.values()) {
      if (!player.state) continue;
      active.push(player);
      this.grid.insert({ id: player.info.id, x: player.state.x, z: player.state.z });
    }
    for (const recipient of this.players.values()) {
      const origin = recipient.state;
      // Jarak subjek dalam 250 m dari grid; subjek lain otomatis tier "far".
      const nearby = new Map<PlayerId, number>();
      if (origin) {
        for (const entry of this.grid.queryRadius(origin.x, origin.z, AOI_MID_RADIUS)) {
          nearby.set(entry.id, distance2d(origin, entry));
        }
      }
      const entries: PlayerSnapshot[] = [];
      const tiers = new Map<PlayerId, AoiTier>();
      for (const subject of active) {
        if (subject === recipient || !subject.state) continue;
        // Penerima tanpa posisi dianggap dekat dengan semua (sama dengan session.ts).
        const dist = origin ? (nearby.get(subject.info.id) ?? Infinity) : 0;
        const subjectId = subject.info.id;
        if (!aoiDue(dist, recipient.lastSent.get(subjectId), nowMs)) continue;
        recipient.lastSent.set(subjectId, nowMs);
        const tier = aoiTier(dist);
        tiers.set(subjectId, tier);
        entries.push(subject.state);
        // Penampilan dikirim SEKALI saat subjek masuk AOI penerima (3.1), bukan tiap update posisi.
        if (tier !== 'far' && recipient.knownAppearance.get(subjectId) !== subject.appearanceVersion) {
          recipient.knownAppearance.set(subjectId, subject.appearanceVersion);
          this.sendTo(recipient, { type: 'appearance', playerId: subjectId, appearance: subject.info.appearance });
        }
      }
      if (entries.length > 0) {
        this.sendTo(recipient, { type: 'state', timeMs: nowMs >>> 0, players: entries });
        sent.set(recipient.info.id, tiers);
      }
    }
    if (nowMs - this.lastClockMs >= CLOCK_INTERVAL_MS) {
      this.lastClockMs = nowMs;
      this.broadcast({ type: 'clock', timeOfDay: this.timeOfDay(), timeMs: nowMs >>> 0 });
    }
    for (const [spotId, reservation] of this.fishingReservations) {
      if (nowMs - reservation.heartbeatAt < FISHING_SPOT_TTL_MS) continue;
      this.fishingReservations.delete(spotId);
      this.broadcast({ type: 'fishingRelease', playerId: 0, spotId });
    }
    return sent;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Pengelola room
 * ---------------------------------------------------------------------------------------------- */

export interface RoomManagerOptions extends RoomOptions {
  maxRooms?: number;
  emptyTtlMs?: number;
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private readonly now: () => number;
  private readonly maxRooms: number;
  private readonly emptyTtlMs: number;

  constructor(private readonly options: RoomManagerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.maxRooms = options.maxRooms ?? 100;
    this.emptyTtlMs = options.emptyTtlMs ?? ROOM_EMPTY_TTL_MS;
  }

  /** Room baru dengan kode acak unik; null kalau batas jumlah room tercapai. */
  create(): Room | null {
    if (this.rooms.size >= this.maxRooms) return null;
    let code = generateRoomCode();
    while (this.rooms.has(code)) code = generateRoomCode();
    const room = new Room(code, this.options);
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  get playerCount(): number {
    let total = 0;
    for (const room of this.rooms.values()) total += room.size;
    return total;
  }

  /** Room yang kosong lebih lama dari TTL dihapus. Mengembalikan kode yang dihapus. */
  sweep(): string[] {
    const nowMs = this.now();
    const removed: string[] = [];
    for (const [code, room] of this.rooms) {
      if (room.size === 0 && room.emptySinceMs !== null && nowMs - room.emptySinceMs >= this.emptyTtlMs) {
        this.rooms.delete(code);
        removed.push(code);
      }
    }
    return removed;
  }

  tickAll(): void {
    for (const room of this.rooms.values()) if (room.size > 0) room.tick();
  }
}

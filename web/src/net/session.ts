import { INITIAL_VEHICLES } from '../game/vehicles';
import { DEFAULT_APPEARANCE, normalizeUsername, validateUsername, type Appearance } from '../state/profile';
import {
  decodeMessage,
  encodeMessage,
  inWorldBounds,
  isReliable,
  isValidChatText,
  sanitizeText,
  type ChatChannel,
  type ChatMessage,
  type DecodeError,
  type NetMessage,
  type PlayerId,
  type PlayerInfo,
  type PlayerSnapshot,
  type VehicleStateMessage,
} from './protocol';
import {
  releaseSpot,
  reserveSpot,
  staleSpotsOf,
  type FishingSpotReservations,
  type SpotReservation,
} from '../fishing/fishingSpots';
import type { HostTransport, IncomingMessage, PeerEvent, PeerId, Transport, Unsubscribe } from './transport';

/* ------------------------------------------------------------------------------------------------
 * Konstanta (MULTIPLAYER.md 3, 4.1, 5.1)
 * ---------------------------------------------------------------------------------------------- */

/** Radius kanal "Dekat" (m). */
export const NEARBY_CHAT_RADIUS = 30;
/** Rate limit chat: 1 pesan per detik, burst 5. */
export const CHAT_RATE_PER_SEC = 1;
export const CHAT_BURST = 5;
/** Riwayat chat di memori per kanal. */
export const CHAT_HISTORY_MAX = 50;
/** Jam siang-malam dikirim host tiap 10 detik. */
export const CLOCK_INTERVAL_MS = 10_000;
/** Maksimum pemain per sesi (5 lokal, 50 online). */
export const MAX_PLAYERS_LOCAL = 5;
export const MAX_PLAYERS_ONLINE = 50;
/**
 * Kecepatan maksimum yang diterima host (m/s): mobil 18 m/s (game/vehicleSpec.ts) + toleransi 40 %
 * untuk jitter paket. Ditambah slack jarak tetap supaya paket yang menumpuk tidak salah ditolak.
 */
export const MAX_PLAYER_SPEED = 18 * 1.4;
export const SPEED_SLACK_M = 2;
/** Jarak maksimum pemain ke kendaraan saat klaim naik (m). */
export const VEHICLE_REACH = 6;
/** Fishing claims are refreshed by reserve and expire without a heartbeat. */
export const FISHING_SPOT_TTL_MS = 5_000;

/** AOI (4.1): dekat 15 Hz, menengah 3 Hz, jauh posisi kasar tiap 2 detik. */
export const AOI_NEAR_RADIUS = 120;
export const AOI_MID_RADIUS = 250;
export const AOI_INTERVAL_MS = { near: 1000 / 15, mid: 1000 / 3, far: 2000 } as const;
export type AoiTier = keyof typeof AOI_INTERVAL_MS;

/** Pemain lain digambar 100-150 ms di belakang (4). */
export const INTERPOLATION_DELAY_MS = 120;
/** Batas buffer snapshot per pemain remote. */
export const SNAPSHOT_BUFFER_MAX = 20;

/* ------------------------------------------------------------------------------------------------
 * Fungsi murni (dipakai host, renderer, dan test)
 * ---------------------------------------------------------------------------------------------- */

export const distance2d = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(a.x - b.x, a.z - b.z);

export function aoiTier(dist: number): AoiTier {
  if (dist <= AOI_NEAR_RADIUS) return 'near';
  if (dist <= AOI_MID_RADIUS) return 'mid';
  return 'far';
}

/** Benar kalau update subjek sudah waktunya dikirim lagi ke penerima ini. */
export function aoiDue(dist: number, lastSentMs: number | undefined, nowMs: number): boolean {
  if (lastSentMs === undefined) return true;
  // Toleransi 1 ms supaya tick 15 Hz yang sedikit lebih cepat tidak melewatkan satu siklus.
  return nowMs - lastSentMs >= AOI_INTERVAL_MS[aoiTier(dist)] - 1;
}

/**
 * Anti-teleport: benar kalau perpindahan dari `prev` ke `next` dalam `dtMs` masih masuk akal
 * dan posisi baru ada di dalam peta.
 */
export function isPlausibleMove(prev: { x: number; z: number } | null, next: { x: number; z: number }, dtMs: number): boolean {
  if (!inWorldBounds(next.x, next.z)) return false;
  if (!prev) return true;
  const dt = Math.max(0, dtMs) / 1000;
  return distance2d(prev, next) <= MAX_PLAYER_SPEED * dt + SPEED_SLACK_M;
}

/** Token bucket untuk rate limit chat; state disimpan per pemain. */
export interface RateBucket {
  tokens: number;
  updatedMs: number;
}

export const newRateBucket = (nowMs: number): RateBucket => ({ tokens: CHAT_BURST, updatedMs: nowMs });

/** Mengambil satu token kalau ada. Mengubah `bucket` di tempat. */
export function takeToken(bucket: RateBucket, nowMs: number): boolean {
  const elapsed = Math.max(0, nowMs - bucket.updatedMs) / 1000;
  bucket.tokens = Math.min(CHAT_BURST, bucket.tokens + elapsed * CHAT_RATE_PER_SEC);
  bucket.updatedMs = nowMs;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

/** Menambah ke riwayat dengan batas panjang (mengembalikan array baru). */
export const pushHistory = <T>(history: readonly T[], item: T, max = CHAT_HISTORY_MAX): T[] => {
  const next = [...history, item];
  return next.length > max ? next.slice(next.length - max) : next;
};

export interface TimedSnapshot {
  /** Waktu host (ms) saat snapshot dibuat. */
  t: number;
  snap: PlayerSnapshot;
}

const TWO_PI = Math.PI * 2;
/** Interpolasi sudut lewat jalur terpendek. */
export function lerpAngle(a: number, b: number, t: number): number {
  let delta = (b - a) % TWO_PI;
  if (delta > Math.PI) delta -= TWO_PI;
  if (delta < -Math.PI) delta += TWO_PI;
  return (((a + delta * t) % TWO_PI) + TWO_PI) % TWO_PI;
}

/** Menyisipkan snapshot ke buffer terurut waktu (snapshot lama/duplikat yang datang telat diabaikan). */
export function pushSnapshot(buffer: TimedSnapshot[], entry: TimedSnapshot, max = SNAPSHOT_BUFFER_MAX): TimedSnapshot[] {
  const last = buffer[buffer.length - 1];
  if (last && entry.t <= last.t) return buffer;
  const next = [...buffer, entry];
  return next.length > max ? next.slice(next.length - max) : next;
}

/**
 * Posisi pemain remote pada `renderTimeMs` (biasanya waktu host - INTERPOLATION_DELAY_MS).
 * Tidak ada ekstrapolasi: sebelum snapshot pertama dipakai yang pertama, setelah yang terakhir
 * dipakai yang terakhir. Mode/animasi/lompat diambil dari snapshot yang lebih dekat.
 */
export function interpolateSnapshots(buffer: readonly TimedSnapshot[], renderTimeMs: number): PlayerSnapshot | null {
  const first = buffer[0];
  const last = buffer[buffer.length - 1];
  if (!first || !last) return null;
  if (renderTimeMs <= first.t) return first.snap;
  if (renderTimeMs >= last.t) return last.snap;
  for (let index = 1; index < buffer.length; index++) {
    const b = buffer[index] as TimedSnapshot;
    if (b.t < renderTimeMs) continue;
    const a = buffer[index - 1] as TimedSnapshot;
    const span = b.t - a.t;
    const t = span > 0 ? (renderTimeMs - a.t) / span : 1;
    const discrete = t < 0.5 ? a.snap : b.snap;
    return {
      id: b.snap.id,
      x: a.snap.x + (b.snap.x - a.snap.x) * t,
      y: a.snap.y + (b.snap.y - a.snap.y) * t,
      z: a.snap.z + (b.snap.z - a.snap.z) * t,
      heading: lerpAngle(a.snap.heading, b.snap.heading, t),
      mode: discrete.mode,
      anim: discrete.anim,
      jumping: discrete.jumping,
    };
  }
  return last.snap;
}

/* ------------------------------------------------------------------------------------------------
 * Host
 * ---------------------------------------------------------------------------------------------- */

export type RejectReason =
  | DecodeError
  | 'not-joined'
  | 'already-joined'
  | 'username'
  | 'room-full'
  | 'rate-limit'
  | 'chat-text'
  | 'speed'
  | 'vehicle-taken'
  | 'vehicle-unknown'
  | 'vehicle-far'
  | 'not-owner'
  | 'spot-taken'
  | 'unexpected';

export interface RejectEvent {
  peer: PeerId;
  reason: RejectReason;
}

export interface ChatEntry {
  /** Id pesan dari host. */
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

interface HostPlayer {
  info: PlayerInfo;
  /** Undefined untuk pemain lokal di HP host. */
  peer: PeerId | undefined;
  state: PlayerSnapshot | null;
  stateAtMs: number;
  chat: RateBucket;
  /** Waktu terakhir posisi subjek X dikirim ke pemain ini (AOI). */
  lastSent: Map<PlayerId, number>;
}

export interface FishingSpotEvent {
  type: 'fishingReserve' | 'fishingRelease';
  spotId: string;
  /** Host-originated expiry/disconnect release has no player identity. */
  fromId: PlayerId;
}

export interface HostOptions {
  /** Waktu (ms); default Date.now. Test memakai jam palsu. */
  now?: () => number;
  /** Jam dunia host (detik, game/dayCycle.ts). */
  getTimeOfDay?: () => number;
  maxPlayers?: number;
  /** Pemain di HP host sendiri (mode lokal). Tanpa ini host hanya relay (mode server). */
  localPlayer?: { username: string; appearance: Appearance };
  /** Dipanggil saat host menolak pesan (logging dan test). */
  onReject?: (event: RejectEvent) => void;
  /** Chat that is visible to the local host player. */
  onLocalChat?: (entry: ChatEntry) => void;
  /** Fishing state received from a client and stamped by the host. */
  onFishingState?: (playerId: PlayerId, sequence: number, payload: Uint8Array) => void;
  /** Reservation changes received from remote clients. */
  onFishingSpotEvent?: (event: FishingSpotEvent) => void;
}

/**
 * Host-authoritative untuk data bersama (pemain, kendaraan, jam, chat) dan client authority
 * untuk posisi (divalidasi kecepatan dan batas peta). Dipakai HP host (lokal) dan nanti
 * dicerminkan oleh server Node (M3).
 */
export class HostSession {
  private readonly players = new Map<PlayerId, HostPlayer>();
  private readonly byPeer = new Map<PeerId, PlayerId>();
  private readonly vehicles = new Map<string, VehicleInfo>();
  private fishingReservations: FishingSpotReservations = {};
  private readonly history: Record<ChatChannel, ChatEntry[]> = { session: [], nearby: [] };
  private readonly unsubscribe: Unsubscribe[] = [];
  private readonly now: () => number;
  private readonly getTimeOfDay: () => number;
  private readonly maxPlayers: number;
  private nextPlayerId = 1;
  private nextChatId = 1;
  private lastClockMs = -Infinity;
  readonly localPlayerId: PlayerId | null = null;

  constructor(private readonly transport: HostTransport, private readonly options: HostOptions = {}) {
    this.now = options.now ?? Date.now;
    this.getTimeOfDay = options.getTimeOfDay ?? (() => 0);
    this.maxPlayers = options.maxPlayers ?? MAX_PLAYERS_LOCAL;
    for (const vehicle of INITIAL_VEHICLES) {
      this.vehicles.set(vehicle.id, { vehicleId: vehicle.id, ownerId: 0, x: vehicle.x, z: vehicle.z, yaw: vehicle.yaw });
    }
    if (options.localPlayer) {
      const id = this.allocateId();
      this.localPlayerId = id;
      this.players.set(id, this.makePlayer({ id, ...options.localPlayer }, undefined));
    }
    this.unsubscribe.push(transport.onMessage((message) => this.handleMessage(message)));
    this.unsubscribe.push(transport.onPeer((event) => this.handlePeer(event)));
  }

  /** Daftar pemain (id, username, penampilan) menurut host. */
  playerList(): PlayerInfo[] {
    return [...this.players.values()].map((player) => player.info);
  }

  playerState(id: PlayerId): PlayerSnapshot | null {
    return this.players.get(id)?.state ?? null;
  }

  vehicle(vehicleId: string): VehicleInfo | undefined {
    return this.vehicles.get(vehicleId);
  }

  /** Owner id of a fishing spot reservation, or null when free (FISHING.md 8). */
  fishingSpotOwner(spotId: string): PlayerId | null {
    const owner = this.fishingReservations[spotId]?.playerId;
    if (owner === undefined) return null;
    const id = Number(owner);
    return Number.isInteger(id) && id > 0 && id <= 0xffff ? id : null;
  }

  chatHistory(channel: ChatChannel): readonly ChatEntry[] {
    return this.history[channel];
  }

  /** Posisi pemain lokal host (mode lokal), dipanggil dari game loop. */
  setLocalState(state: Omit<PlayerSnapshot, 'id'>): void {
    if (this.localPlayerId === null) return;
    const player = this.players.get(this.localPlayerId);
    if (!player || !inWorldBounds(state.x, state.z)) return;
    player.state = { ...state, id: this.localPlayerId };
    player.stateAtMs = this.now();
  }

  /** Chat dari pemain lokal host; melewati aturan yang sama dengan klien. */
  sendLocalChat(channel: ChatChannel, text: string): boolean {
    if (this.localPlayerId === null) return false;
    const player = this.players.get(this.localPlayerId);
    return player ? this.relayChat(player, channel, text) : false;
  }

  /** Reserves a spot for the local host player without going through the transport. */
  reserveLocalFishingSpot(spotId: string): boolean {
    if (this.localPlayerId === null) return false;
    const player = this.players.get(this.localPlayerId);
    return player ? this.handleFishingReservation(player, 'reserve', spotId) : false;
  }

  /** Releases a spot owned by the local host player. */
  releaseLocalFishingSpot(spotId: string): boolean {
    if (this.localPlayerId === null) return false;
    const player = this.players.get(this.localPlayerId);
    return player ? this.handleFishingReservation(player, 'release', spotId) : false;
  }

  /** Publishes local-host fishing state to remote clients and local observers. */
  publishLocalFishingState(sequence: number, payload: Uint8Array): boolean {
    if (this.localPlayerId === null) return false;
    this.broadcast({ type: 'fishingState', playerId: this.localPlayerId, sequence, payload });
    this.options.onFishingState?.(this.localPlayerId, sequence, payload);
    return true;
  }

  /**
   * Called 15 Hz from the game loop: sends AOI position snapshots and the clock.
   */
  tick(): void {
    const nowMs = this.now();
    for (const recipient of this.players.values()) {
      if (recipient.peer === undefined) continue;
      const origin = recipient.state;
      const entries: PlayerSnapshot[] = [];
      for (const subject of this.players.values()) {
        if (subject === recipient || !subject.state) continue;
        // Penerima yang belum punya posisi dianggap dekat dengan semua (setelah spawn).
        const dist = origin ? distance2d(origin, subject.state) : 0;
        if (!aoiDue(dist, recipient.lastSent.get(subject.info.id), nowMs)) continue;
        recipient.lastSent.set(subject.info.id, nowMs);
        entries.push(subject.state);
      }
      if (entries.length > 0) this.sendTo(recipient, { type: 'state', timeMs: nowMs >>> 0, players: entries });
    }
    if (nowMs - this.lastClockMs >= CLOCK_INTERVAL_MS) {
      this.lastClockMs = nowMs;
      this.broadcast({ type: 'clock', timeOfDay: this.getTimeOfDay(), timeMs: nowMs >>> 0 });
    }
    // Reservasi titik pancing tanpa detak jantung dialokasikan lagi (FISHING.md 8).
    for (const spotId of staleSpotsOf(this.fishingReservations, nowMs, FISHING_SPOT_TTL_MS)) {
      this.fishingReservations = releaseSpot(this.fishingReservations, spotId);
      this.broadcast({ type: 'fishingRelease', playerId: 0, spotId });
      this.options.onFishingSpotEvent?.({ type: 'fishingRelease', spotId, fromId: 0 });
    }
  }

  close(): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe.length = 0;
  }

  private allocateId(): PlayerId {
    const id = this.nextPlayerId;
    this.nextPlayerId = this.nextPlayerId >= 0xffff ? 1 : this.nextPlayerId + 1;
    return id;
  }

  private makePlayer(info: PlayerInfo, peer: PeerId | undefined): HostPlayer {
    return { info, peer, state: null, stateAtMs: 0, chat: newRateBucket(this.now()), lastSent: new Map() };
  }

  private reject(peer: PeerId, reason: RejectReason): void {
    this.options.onReject?.({ peer, reason });
  }

  private sendTo(player: HostPlayer, message: NetMessage): void {
    if (player.peer === undefined) return;
    this.transport.sendTo(player.peer, encodeMessage(message), isReliable(message.type));
  }

  private broadcast(message: NetMessage, except?: HostPlayer): void {
    const data = encodeMessage(message);
    const reliable = isReliable(message.type);
    for (const player of this.players.values()) {
      if (player === except || player.peer === undefined) continue;
      this.transport.sendTo(player.peer, data, reliable);
    }
  }

  private handlePeer(event: PeerEvent): void {
    if (event.kind !== 'close') return;
    const id = this.byPeer.get(event.peer);
    if (id === undefined) return;
    this.byPeer.delete(event.peer);
    this.players.delete(id);
    for (const player of this.players.values()) player.lastSent.delete(id);
    // Titik pancing yang direservasi pemain ini dikembalikan.
    for (const spotId of Object.keys(this.fishingReservations)) {
      if ((this.fishingReservations[spotId] as SpotReservation).playerId !== String(id)) continue;
      this.fishingReservations = releaseSpot(this.fishingReservations, spotId);
      this.broadcast({ type: 'fishingRelease', playerId: id, spotId });
      this.options.onFishingSpotEvent?.({ type: 'fishingRelease', spotId, fromId: id });
    }
    // Kendaraan yang sedang dinaiki kembali terparkir di posisi terakhir pemain.
    for (const vehicle of this.vehicles.values()) {
      if (vehicle.ownerId !== id) continue;
      vehicle.ownerId = 0;
      this.broadcast(this.vehicleMessage(vehicle));
    }
    this.broadcast({ type: 'playerLeave', playerId: id });
  }

  private handleMessage({ from, data }: IncomingMessage): void {
    const decoded = decodeMessage(data);
    if (!decoded.ok) {
      this.reject(from, decoded.error);
      return;
    }
    const message = decoded.message;
    const playerId = this.byPeer.get(from);
    if (message.type === 'hello') {
      this.handleHello(from, message.username, message.appearance);
      return;
    }
    const player = playerId === undefined ? undefined : this.players.get(playerId);
    if (!player) {
      this.reject(from, 'not-joined');
      return;
    }
    switch (message.type) {
      case 'state':
        this.handleState(player, message.players);
        return;
      case 'appearance':
        player.info = { ...player.info, appearance: message.appearance };
        this.broadcast({ type: 'appearance', playerId: player.info.id, appearance: message.appearance }, player);
        return;
      case 'chat':
        if (!this.relayChat(player, message.channel, message.text)) return;
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
        // Id dari klien diabaikan: host yang menentukan siapa pengirimnya. Payload diteruskan
        // tanpa diubah (sudah tervalidasi panjangnya oleh decodeMessage).
        this.broadcast(
          { type: 'fishingState', playerId: player.info.id, sequence: message.sequence, payload: message.payload },
          player,
        );
        this.options.onFishingState?.(player.info.id, message.sequence, message.payload);
        return;
      case 'ping':
        this.sendTo(player, { type: 'pong', nonce: message.nonce });
        return;
      default:
        // welcome/clock/playerJoin/... hanya boleh dikirim host.
        this.reject(from, 'unexpected');
    }
  }

  private handleHello(peer: PeerId, username: string, appearance: Appearance): void {
    if (this.byPeer.has(peer)) {
      this.reject(peer, 'already-joined');
      return;
    }
    if (validateUsername(username) !== null) {
      this.reject(peer, 'username');
      return;
    }
    if (this.players.size >= this.maxPlayers) {
      this.reject(peer, 'room-full');
      return;
    }
    const id = this.allocateId();
    const info: PlayerInfo = { id, username: normalizeUsername(username), appearance };
    const player = this.makePlayer(info, peer);
    this.players.set(id, player);
    this.byPeer.set(peer, id);
    // Daftar di `welcome` termasuk pemain baru itu sendiri. Pemain baru tidak melihat riwayat chat sebelumnya (5.1).
    this.sendTo(player, { type: 'welcome', playerId: id, timeOfDay: this.getTimeOfDay(), players: this.playerList() });
    this.broadcast({ type: 'playerJoin', player: info }, player);
    for (const vehicle of this.vehicles.values()) {
      if (vehicle.ownerId !== 0) this.sendTo(player, this.vehicleMessage(vehicle));
    }
  }

  private handleState(player: HostPlayer, entries: PlayerSnapshot[]): void {
    const entry = entries[0];
    if (entries.length !== 1 || !entry) {
      this.reject(player.peer ?? 'host', 'field');
      return;
    }
    const nowMs = this.now();
    if (!isPlausibleMove(player.state, entry, nowMs - player.stateAtMs)) {
      this.reject(player.peer ?? 'host', 'speed');
      return;
    }
    // Id dari klien diabaikan: host yang menentukan siapa pengirimnya.
    player.state = { ...entry, id: player.info.id };
    player.stateAtMs = nowMs;
  }

  private relayChat(player: HostPlayer, channel: ChatChannel, rawText: string): boolean {
    const peer = player.peer ?? 'host';
    const text = sanitizeText(rawText);
    if (!isValidChatText(text)) {
      this.reject(peer, 'chat-text');
      return false;
    }
    if (!takeToken(player.chat, this.now())) {
      this.reject(peer, 'rate-limit');
      return false;
    }
    const entry: ChatEntry = { id: this.nextChatId++, channel, fromId: player.info.id, timeMs: this.now() >>> 0, text };
    this.history[channel] = pushHistory(this.history[channel], entry);
    const message: ChatMessage = { type: 'chat', channel, fromId: entry.fromId, msgId: entry.id, timeMs: entry.timeMs, text };
    const data = encodeMessage(message);
    for (const recipient of this.players.values()) {
      if (channel === 'nearby' && !this.withinNearby(player, recipient)) continue;
      if (recipient.peer === undefined) this.options.onLocalChat?.(entry);
      else this.transport.sendTo(recipient.peer, data, true);
    }
    return true;
  }

  /** Penyaringan kanal "Dekat" memakai posisi versi host, bukan versi penerima (5.1). */
  private withinNearby(sender: HostPlayer, recipient: HostPlayer): boolean {
    if (sender === recipient) return true;
    if (!sender.state || !recipient.state) return false;
    return distance2d(sender.state, recipient.state) <= NEARBY_CHAT_RADIUS;
  }

  private handleVehicleClaim(player: HostPlayer, vehicleId: string, action: 'mount' | 'release', x: number, z: number, yaw: number): void {
    const peer = player.peer ?? 'host';
    const vehicle = this.vehicles.get(vehicleId);
    if (!vehicle) {
      this.reject(peer, 'vehicle-unknown');
      return;
    }
    if (action === 'mount') {
      // Siapa cepat dia dapat: klaim kedua ditolak dan pengirim diberi tahu pemilik sekarang.
      if (vehicle.ownerId !== 0) {
        this.reject(peer, 'vehicle-taken');
        this.sendTo(player, this.vehicleMessage(vehicle));
        return;
      }
      if (!player.state || distance2d(player.state, vehicle) > VEHICLE_REACH) {
        this.reject(peer, 'vehicle-far');
        this.sendTo(player, this.vehicleMessage(vehicle));
        return;
      }
      vehicle.ownerId = player.info.id;
    } else {
      if (vehicle.ownerId !== player.info.id) {
        this.reject(peer, 'not-owner');
        return;
      }
      if (player.state && distance2d(player.state, { x, z }) > VEHICLE_REACH) {
        this.reject(peer, 'vehicle-far');
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
   * pengirim diberi tahu pemilik sekarang lewat `fishingReserve` versi host. Lepas hanya
   * boleh oleh pemilik. Pemilik bisa mengulang `fishingReserve` sebagai detak jantung.
   */
  private handleFishingReservation(player: HostPlayer, action: 'reserve' | 'release', spotId: string): boolean {
    const peer = player.peer ?? 'host';
    if (action === 'reserve') {
      const ownerId = this.fishingSpotOwner(spotId);
      if (ownerId !== null && ownerId !== player.info.id) {
        this.reject(peer, 'spot-taken');
        return false;
      }
      const next = reserveSpot(this.fishingReservations, spotId, String(player.info.id), this.now());
      if (next === this.fishingReservations) {
        this.reject(peer, 'spot-taken');
        return false;
      }
      this.fishingReservations = next;
      this.broadcast({ type: 'fishingReserve', playerId: player.info.id, spotId }, player);
      this.options.onFishingSpotEvent?.({ type: 'fishingReserve', spotId, fromId: player.info.id });
      return true;
    }
    const ownerId = this.fishingSpotOwner(spotId);
    if (ownerId !== player.info.id) {
      this.reject(peer, 'not-owner');
      return false;
    }
    this.fishingReservations = releaseSpot(this.fishingReservations, spotId);
    this.broadcast({ type: 'fishingRelease', playerId: player.info.id, spotId }, player);
    this.options.onFishingSpotEvent?.({ type: 'fishingRelease', spotId, fromId: player.info.id });
    return true;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Klien
 * ---------------------------------------------------------------------------------------------- */

export interface ClientEvents {
  onWelcome?: (playerId: PlayerId, players: PlayerInfo[], timeOfDay: number) => void;
  onPlayerJoin?: (player: PlayerInfo) => void;
  onPlayerLeave?: (playerId: PlayerId) => void;
  onAppearance?: (playerId: PlayerId, appearance: Appearance) => void;
  onState?: (snapshots: PlayerSnapshot[], hostTimeMs: number) => void;
  onChat?: (entry: ChatEntry) => void;
  onClock?: (timeOfDay: number) => void;
  onVehicle?: (vehicle: VehicleInfo) => void;
  onFishingSpotEvent?: (event: FishingSpotEvent) => void;
  /** Payload adalah byte fishingSync versi-1; pemanggil mendekode dengan `decodeFishingSync`. */
  onFishingState?: (playerId: PlayerId, sequence: number, payload: Uint8Array) => void;
  onPing?: (rttMs: number) => void;
  onDisconnect?: () => void;
  onReject?: (error: DecodeError) => void;
}

/** Sisi klien: mengirim hello/posisi/chat, menyimpan buffer snapshot untuk interpolasi. */
export class ClientSession {
  playerId: PlayerId | null = null;
  private readonly buffers = new Map<PlayerId, TimedSnapshot[]>();
  private readonly pendingPings = new Map<number, number>();
  private readonly unsubscribe: Unsubscribe[] = [];
  private readonly now: () => number;
  /** Perkiraan (waktu host - waktu lokal), diambil maksimum supaya latensi tidak menumpuk. */
  private hostOffsetMs: number | null = null;
  private nextNonce = 1;

  constructor(private readonly transport: Transport, private readonly events: ClientEvents = {}, now?: () => number) {
    this.now = now ?? Date.now;
    this.unsubscribe.push(transport.onMessage(({ data }) => this.handle(data)));
    this.unsubscribe.push(
      transport.onPeer((event) => {
        if (event.kind === 'close') this.events.onDisconnect?.();
      }),
    );
  }

  join(username: string, appearance: Appearance = DEFAULT_APPEARANCE): void {
    this.send({ type: 'hello', username, appearance });
  }

  sendState(state: Omit<PlayerSnapshot, 'id'>): void {
    this.send({ type: 'state', timeMs: this.now() >>> 0, players: [{ ...state, id: 0 }] });
  }

  sendAppearance(appearance: Appearance): void {
    this.send({ type: 'appearance', playerId: 0, appearance });
  }

  /** Mengembalikan false kalau teks sudah pasti ditolak (kosong / > 200 karakter). */
  sendChat(channel: ChatChannel, text: string): boolean {
    if (!isValidChatText(text)) return false;
    this.send({ type: 'chat', channel, fromId: 0, msgId: 0, timeMs: 0, text });
    return true;
  }

  claimVehicle(vehicleId: string, action: 'mount' | 'release', pose: { x: number; z: number; yaw: number }): void {
    this.send({ type: 'vehicleClaim', vehicleId, action, ...pose });
  }

  /** Reservasi/lepas titik pancing di host (FISHING.md 8). */
  claimFishingSpot(spotId: string, action: 'reserve' | 'release'): void {
    this.send({ type: action === 'reserve' ? 'fishingReserve' : 'fishingRelease', playerId: 0, spotId });
  }

  /** Menyiarkan state pancing (payload fishingSync versi-1) dengan nomor urut sendiri. */
  sendFishingState(sequence: number, payload: Uint8Array): void {
    this.send({ type: 'fishingState', playerId: 0, sequence, payload });
  }

  ping(): void {
    const nonce = this.nextNonce++ >>> 0;
    this.pendingPings.set(nonce, this.now());
    this.send({ type: 'ping', nonce });
  }

  /** Perkiraan waktu host sekarang (ms). */
  hostTime(): number {
    return this.now() + (this.hostOffsetMs ?? 0);
  }

  /** Posisi pemain remote yang siap digambar (100-150 ms di belakang). */
  sample(playerId: PlayerId, delayMs = INTERPOLATION_DELAY_MS): PlayerSnapshot | null {
    const buffer = this.buffers.get(playerId);
    return buffer ? interpolateSnapshots(buffer, this.hostTime() - delayMs) : null;
  }

  /** Snapshot terbaru (tanpa interpolasi), mis. untuk titik di minimap. */
  latest(playerId: PlayerId): PlayerSnapshot | null {
    const buffer = this.buffers.get(playerId);
    return buffer?.[buffer.length - 1]?.snap ?? null;
  }

  close(): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe.length = 0;
    this.transport.close();
  }

  private send(message: NetMessage): void {
    this.transport.send(encodeMessage(message), isReliable(message.type));
  }

  private syncHostTime(hostMs: number): void {
    const offset = hostMs - this.now();
    if (this.hostOffsetMs === null || offset > this.hostOffsetMs) this.hostOffsetMs = offset;
  }

  private handle(data: Uint8Array): void {
    const decoded = decodeMessage(data);
    if (!decoded.ok) {
      this.events.onReject?.(decoded.error);
      return;
    }
    const message = decoded.message;
    switch (message.type) {
      case 'welcome':
        this.playerId = message.playerId;
        this.events.onWelcome?.(message.playerId, message.players, message.timeOfDay);
        return;
      case 'playerJoin':
        this.events.onPlayerJoin?.(message.player);
        return;
      case 'playerLeave':
        this.buffers.delete(message.playerId);
        this.events.onPlayerLeave?.(message.playerId);
        return;
      case 'appearance':
        this.events.onAppearance?.(message.playerId, message.appearance);
        return;
      case 'state':
        this.syncHostTime(message.timeMs);
        for (const snap of message.players) {
          if (snap.id === this.playerId) continue;
          this.buffers.set(snap.id, pushSnapshot(this.buffers.get(snap.id) ?? [], { t: message.timeMs, snap }));
        }
        this.events.onState?.(message.players, message.timeMs);
        return;
      case 'chat':
        this.events.onChat?.({ id: message.msgId, channel: message.channel, fromId: message.fromId, timeMs: message.timeMs, text: message.text });
        return;
      case 'clock':
        this.syncHostTime(message.timeMs);
        this.events.onClock?.(message.timeOfDay);
        return;
      case 'vehicleState':
        this.events.onVehicle?.({ vehicleId: message.vehicleId, ownerId: message.ownerId, x: message.x, z: message.z, yaw: message.yaw });
        return;
      case 'fishingReserve':
      case 'fishingRelease':
        this.events.onFishingSpotEvent?.({ type: message.type, spotId: message.spotId, fromId: message.playerId });
        return;
      case 'fishingState':
        if (message.playerId === this.playerId) return;
        this.events.onFishingState?.(message.playerId, message.sequence, message.payload);
        return;
      case 'pong': {
        const sentAt = this.pendingPings.get(message.nonce);
        if (sentAt === undefined) return;
        this.pendingPings.delete(message.nonce);
        this.events.onPing?.(this.now() - sentAt);
        return;
      }
      default:
        return;
    }
  }
}

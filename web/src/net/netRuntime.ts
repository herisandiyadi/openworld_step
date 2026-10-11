import { INITIAL_VEHICLES } from '../game/vehicles';
import type { Appearance } from '../state/profile';
import { loadWorldIndex } from '../world/worldState';
import { createNearbyClientTransport, createNearbyHostTransport, type NearbyPluginPart } from './nearbyTransport';
import { useNetStore } from './netStore';
import type { ChatChannel, PlayerId, PlayerInfo, PlayerSnapshot } from './protocol';
import { ClientSession, HostSession, type ChatEntry, type ClientEvents, type VehicleInfo } from './session';
import type { Transport, Unsubscribe } from './transport';
import { WsTransport, type WebSocketFactory, type WsTransportOptions } from './wsTransport';

/**
 * Manajer koneksi: satu pintu untuk UI dan game loop (MULTIPLAYER.md bagian 4 dan 6).
 * Modul ini yang menyambungkan transport (Nearby / WebSocket) ke sesi (HostSession /
 * ClientSession) lalu meneruskan semua kejadian jaringan ke `useNetStore`.
 *
 * Hanya ada satu sesi aktif per aplikasi, jadi state-nya disimpan di level modul.
 * Memanggil salah satu fungsi `connect*` saat sesi lain masih hidup otomatis memutus
 * sesi sebelumnya lebih dulu.
 *
 * Di mode internet server-lah yang berwenang: klien online tetap `ClientSession` biasa,
 * bukan `HostSession`.
 */

export type NetMode = 'local-host' | 'local-client' | 'online';

/** Pesan error siap tampil (bahasa Indonesia) untuk tiga kegagalan yang bisa dibedakan. */
export const ERR_SERVER = 'Gagal menyambung ke server. Periksa alamat server di Pengaturan.';
export const ERR_ROOM = 'Room tidak ditemukan atau sudah penuh.';
export const ERR_NEARBY = 'Nearby tidak tersedia di perangkat ini.';

/** Jeda ping klien di mode lokal (ms); mode internet memakai ping milik WsTransport. */
const LOCAL_PING_INTERVAL_MS = 2000;

/* ------------------------------------------------------------------------------------------------
 * Dependensi yang bisa disuntikkan (unit test memakai versi palsu, tanpa jaringan sama sekali)
 * ---------------------------------------------------------------------------------------------- */

/** Bagian `Response` yang dipakai saat membuat/gabung room. */
export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string> }) => Promise<FetchResponseLike>;

export interface NetDeps {
  /** Plugin Nearby; default plugin native asli. */
  plugin?: NearbyPluginPart;
  /** Pembuat WebSocket; default `new WebSocket(url)` di dalam WsTransport. */
  createSocket?: WebSocketFactory;
  /** Pengambil HTTP untuk endpoint room; default `fetch` global. */
  fetch?: FetchLike;
  /** Metadata dunia aktif; default dibaca dari public/world/index.json. */
  getWorldVersion?: () => Promise<string>;
  /** Opsi tambahan WsTransport (backoff, ping, dll). */
  ws?: WsTransportOptions;
  /** Waktu (ms); default Date.now. */
  now?: () => number;
}

export interface LocalHostOptions {
  username: string;
  appearance: Appearance;
  maxPlayers?: number;
  /** Jam dunia host (detik) supaya klien ikut siang-malam yang sama. */
  getTimeOfDay?: () => number;
  deps?: NetDeps;
}

export interface LocalClientOptions {
  username: string;
  appearance: Appearance;
  deps?: NetDeps;
}

export interface OnlineOptions {
  /** `ws://` atau `wss://` (state/netSettings.ts). */
  serverUrl: string;
  /** Kosong = buat room baru, terisi = gabung room itu. */
  roomCode?: string;
  username: string;
  appearance: Appearance;
  deps?: NetDeps;
}

/* ------------------------------------------------------------------------------------------------
 * State modul
 * ---------------------------------------------------------------------------------------------- */

type VehicleListener = (vehicle: VehicleInfo) => void;

let mode: NetMode | null = null;
let activeSession: HostSession | ClientSession | null = null;
let activeTransport: Transport | null = null;
let activeCode: string | null = null;
let nowFn: () => number = Date.now;
/** Jumlah pesan yang ditolak; hanya untuk diagnosa, tidak masuk store. */
let rejectCount = 0;
let lastPingMs = 0;
/** Tanda tangan daftar pemain versi host terakhir yang sudah ditulis ke store. */
let hostPlayersKey = '';
const hostVehicleOwners = new Map<string, PlayerId>();
const vehicleListeners = new Set<VehicleListener>();
const fishingStateListeners = new Set<FishingStateListener>();

export type FishingStateListener = (playerId: number, sequence: number, payload: Uint8Array) => void;

/** Subscribes to live fishing-state frames (local host and remote players). */
export function onFishingState(cb: FishingStateListener): Unsubscribe | null {
  if (!activeSession) return null;
  fishingStateListeners.add(cb);
  return () => fishingStateListeners.delete(cb);
}

/** Local player id of the active session (null when not connected or not yet welcomed). */
export function localPlayerId(): PlayerId | null {
  const session = activeSession;
  if (!session) return null;
  return session instanceof HostSession ? session.localPlayerId : session.playerId;
}

/** Publishes 8-byte fishing state with a monotonically increasing sequence. */
export function publishFishingState(payload: Uint8Array, sequence: number): boolean {
  const session = activeSession;
  if (!session) return false;
  if (session instanceof HostSession) return session.publishLocalFishingState(sequence, payload);
  session.sendFishingState(sequence, payload);
  return true;
}

/** Reserves a fishing spot in the active session (local host direct, clients via the host). */
export function reserveFishingSpot(spotId: string, _now?: number): boolean {
  const session = activeSession;
  if (!session) return false;
  if (session instanceof HostSession) return session.reserveLocalFishingSpot(spotId);
  session.claimFishingSpot(spotId, 'reserve');
  return true;
}

/** Releases a fishing spot owned by the local player in the active session. */
export function releaseFishingSpot(spotId: string): boolean {
  const session = activeSession;
  if (!session) return false;
  if (session instanceof HostSession) return session.releaseLocalFishingSpot(spotId);
  session.claimFishingSpot(spotId, 'release');
  return true;
}


const emitVehicle = (vehicle: VehicleInfo): void => {
  for (const listener of [...vehicleListeners]) listener(vehicle);
};

/** Berlangganan perubahan pemilik kendaraan (dari klien maupun dari host saat jadi host). */
export function onVehicleUpdate(cb: VehicleListener): Unsubscribe {
  vehicleListeners.add(cb);
  return () => vehicleListeners.delete(cb);
}

/** Jumlah pesan yang ditolak sesi ini (dipakai test dan panel diagnosa). */
export function rejectedCount(): number {
  return rejectCount;
}

export function netSession(): HostSession | ClientSession | null {
  return activeSession;
}

export function currentMode(): NetMode | null {
  return mode;
}

export function roomCode(): string | null {
  return activeCode;
}

/* ------------------------------------------------------------------------------------------------
 * Jembatan kejadian klien -> store
 * ---------------------------------------------------------------------------------------------- */

function clientEvents(): ClientEvents {
  const store = (): ReturnType<typeof useNetStore.getState> => useNetStore.getState();
  return {
    onWelcome: (playerId: PlayerId, players: PlayerInfo[]) => {
      const state = store();
      state.setPlayerId(playerId);
      state.setPlayers(players);
      state.setStatus('connected');
    },
    onPlayerJoin: (player) => store().addPlayer(player),
    onPlayerLeave: (playerId) => store().removePlayer(playerId),
    onAppearance: (playerId, appearance) => store().setAppearance(playerId, appearance),
    onState: (snapshots) => store().applySnapshots(snapshots),
    onChat: (entry: ChatEntry) => store().addChat(entry),
    onVehicle: (vehicle) => emitVehicle(vehicle),
    onFishingState: (playerId, sequence, payload) => {
      for (const listener of [...fishingStateListeners]) listener(playerId, sequence, payload);
    },
    onFishingSpotEvent: (event) => {
      // Reservation ownership is authoritative in HostSession; runtime listeners only observe state.
      void event;
    },
    onPing: (rttMs) => store().setPing(rttMs),
    // WsTransport (dan UI mode lokal) menyambung ulang sendiri, jadi putus bukan akhir sesi.
    onDisconnect: () => store().setStatus('connecting'),
    // Pesan ditolak tidak mengubah tampilan; cukup dihitung di sini.
    onReject: () => {
      rejectCount += 1;
    },
  };
}

/* ------------------------------------------------------------------------------------------------
 * Mode lokal
 * ---------------------------------------------------------------------------------------------- */

export async function connectLocalHost(opts: LocalHostOptions): Promise<void> {
  disconnect();
  const deps = opts.deps ?? {};
  nowFn = deps.now ?? Date.now;
  useNetStore.getState().setStatus('connecting');
  const transport = createNearbyHostTransport(deps.plugin);
  try {
    await transport.ready;
  } catch (error) {
    transport.close();
    fail(ERR_NEARBY, error);
  }
  const host = new HostSession(transport, {
    now: nowFn,
    ...(opts.getTimeOfDay ? { getTimeOfDay: opts.getTimeOfDay } : {}),
    ...(opts.maxPlayers === undefined ? {} : { maxPlayers: opts.maxPlayers }),
    localPlayer: { username: opts.username, appearance: opts.appearance },
    onReject: () => {
      rejectCount += 1;
    },
    // Chat yang lolos aturan host langsung tampil di HP host sendiri.
    onLocalChat: (entry) => useNetStore.getState().addChat(entry),
    // Kejadian pancing host ikut dioper ke listener runtime (mode live).
    onFishingState: (playerId, sequence, payload) => {
      for (const listener of [...fishingStateListeners]) listener(playerId, sequence, payload);
    },
    onFishingSpotEvent: (event) => {
      void event;
    },
  });
  mode = 'local-host';
  activeTransport = transport;
  activeSession = host;
  activeCode = null;
  const store = useNetStore.getState();
  store.setPlayerId(host.localPlayerId);
  store.setStatus('connected');
  // Posisi awal kendaraan sudah diketahui semua pihak; yang diberitakan hanya perubahan pemilik.
  for (const parked of INITIAL_VEHICLES) hostVehicleOwners.set(parked.id, host.vehicle(parked.id)?.ownerId ?? 0);
  // Host juga pemain: daftar pemain versi host disalin ke store sejak awal.
  syncHostStore(host);
}

export async function connectLocalClient(opts: LocalClientOptions): Promise<void> {
  disconnect();
  const deps = opts.deps ?? {};
  nowFn = deps.now ?? Date.now;
  useNetStore.getState().setStatus('connecting');
  const transport = createNearbyClientTransport(deps.plugin);
  try {
    await transport.ready;
  } catch (error) {
    transport.close();
    fail(ERR_NEARBY, error);
  }
  const client = new ClientSession(transport, clientEvents(), nowFn);
  mode = 'local-client';
  activeTransport = transport;
  activeSession = client;
  activeCode = null;
  client.join(opts.username, opts.appearance);
}

/* ------------------------------------------------------------------------------------------------
 * Mode internet
 * ---------------------------------------------------------------------------------------------- */

interface RoomTicket {
  code: string;
  token: string;
}

/** `ws://host:1234` -> `http://host:1234`, `wss://...` -> `https://...` (tanpa garis miring akhir). */
export function httpBase(serverUrl: string): string {
  const trimmed = serverUrl.trim().replace(/\/+$/, '');
  if (trimmed.startsWith('wss://')) return `https://${trimmed.slice('wss://'.length)}`;
  if (trimmed.startsWith('ws://')) return `http://${trimmed.slice('ws://'.length)}`;
  return trimmed;
}

/** Alamat WebSocket server (server/src/server.ts: `/ws?room=...&token=...`). */
export function wsUrl(serverUrl: string, ticket: RoomTicket): string {
  const base = serverUrl.trim().replace(/\/+$/, '');
  return `${base}/ws?room=${encodeURIComponent(ticket.code)}&token=${encodeURIComponent(ticket.token)}`;
}

const parseTicket = (body: unknown): RoomTicket | null => {
  if (typeof body !== 'object' || body === null) return null;
  const { code, token } = body as { code?: unknown; token?: unknown };
  if (typeof code !== 'string' || typeof token !== 'string' || !code || !token) return null;
  return { code: code.toUpperCase(), token };
};

/**
 * POST /rooms (buat, 201) atau POST /rooms/KODE/join (gabung, 200). `worldVersion` aplikasi
 * ini (versi data peta dari index.json, lihat worldSpec.ts) dikirim lewat header
 * `x-world-version`; server menolak dengan 409 `{ error: 'world-version' }` kalau pemain
 * lain di room memakai versi yang berbeda (CONTENT_UPDATES.md bagian 5). Kegagalan jaringan
 * dan jawaban 404/409 dibedakan supaya pesan di UI tepat.
 */
export const ERR_WORLD_VERSION = 'Versi peta berbeda dari pemain lain. Perbarui konten dulu.';

async function requestRoom(serverUrl: string, roomCodeInput: string | undefined, worldVersion: string, fetchFn: FetchLike): Promise<RoomTicket> {
  const base = httpBase(serverUrl);
  const code = roomCodeInput?.trim().toUpperCase();
  const url = code ? `${base}/rooms/${encodeURIComponent(code)}/join` : `${base}/rooms`;
  let response: FetchResponseLike;
  try {
    response = await fetchFn(url, { method: 'POST', headers: { 'x-world-version': worldVersion } });
  } catch (error) {
    fail(ERR_SERVER, error);
  }
  if (response.status === 404) fail(ERR_ROOM, null);
  const errorBody = response.status === 409 ? await response.json().catch(() => null) : null;
  if (
    response.status === 409 &&
    typeof errorBody === 'object' && errorBody !== null &&
    (errorBody as { error?: unknown }).error === 'world-version'
  ) fail(ERR_WORLD_VERSION, null);
  if (response.status === 409) fail(ERR_ROOM, null);
  if (!response.ok) fail(ERR_SERVER, null);
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    fail(ERR_SERVER, error);
  }
  const ticket = parseTicket(body);
  if (!ticket) fail(ERR_SERVER, null);
  return ticket;
}

/** Mengembalikan kode room yang dipakai (hasil server, bukan masukan pemain). */
export async function connectOnline(opts: OnlineOptions): Promise<string> {
  disconnect();
  const deps = opts.deps ?? {};
  nowFn = deps.now ?? Date.now;
  useNetStore.getState().setStatus('connecting');
  const fetchFn = deps.fetch ?? ((url: string, init?: { method?: string; headers?: Record<string, string> }) => fetch(url, init));
  const worldVersion = await (deps.getWorldVersion ?? (async () => (await loadWorldIndex()).worldVersion))();
  const ticket = await requestRoom(opts.serverUrl, opts.roomCode, worldVersion, fetchFn);
  const transport = new WsTransport(wsUrl(opts.serverUrl, ticket), {
    ...(deps.ws ?? {}),
    ...(deps.createSocket ? { createSocket: deps.createSocket } : {}),
  });
  const client = new ClientSession(transport, clientEvents(), nowFn);
  mode = 'online';
  activeTransport = transport;
  activeSession = client;
  activeCode = ticket.code;
  // Pesan hello reliable: diantre WsTransport kalau socket belum terbuka, lalu dikirim otomatis.
  client.join(opts.username, opts.appearance);
  return ticket.code;
}

/* ------------------------------------------------------------------------------------------------
 * Operasi sesi aktif
 * ---------------------------------------------------------------------------------------------- */

export function disconnect(): void {
  const session = activeSession;
  const transport = activeTransport;
  activeSession = null;
  activeTransport = null;
  activeCode = null;
  mode = null;
  rejectCount = 0;
  lastPingMs = 0;
  hostPlayersKey = '';
  hostVehicleOwners.clear();
  fishingStateListeners.clear();
  // ClientSession.close() sudah menutup transport; HostSession tidak, jadi ditutup di sini.
  if (session instanceof ClientSession) session.close();
  else if (session) {
    session.close();
    transport?.close();
  } else transport?.close();
  useNetStore.getState().reset();
}

export function sendChat(channel: ChatChannel, text: string): boolean {
  const session = activeSession;
  if (!session) return false;
  return session instanceof HostSession ? session.sendLocalChat(channel, text) : session.sendChat(channel, text);
}

/**
 * Klaim/lepas kendaraan. Di mode klien dikirim ke host; saat jadi host pemain lokal
 * tidak lewat jaringan (kendaraan diurus langsung oleh logika game di HP ini).
 */
export function claimVehicle(vehicleId: string, action: 'mount' | 'release', pose: { x: number; z: number; yaw: number }): void {
  const session = activeSession;
  if (session instanceof ClientSession) session.claimVehicle(vehicleId, action, pose);
}

export function setLocalState(state: Omit<PlayerSnapshot, 'id'>): void {
  const session = activeSession;
  if (!session) return;
  if (session instanceof HostSession) session.setLocalState(state);
  else session.sendState(state);
}

/** Aman dipanggil tiap frame: tanpa sesi tidak melakukan apa pun. */
export function tick(): void {
  const session = activeSession;
  if (!session) return;
  if (session instanceof HostSession) {
    session.tick();
    syncHostStore(session);
    return;
  }
  // Mode lokal tidak punya ping transport, jadi ping protokol dipicu dari sini.
  if (mode !== 'local-client') return;
  const now = nowFn();
  if (now - lastPingMs < LOCAL_PING_INTERVAL_MS) return;
  lastPingMs = now;
  session.ping();
}

/** Daftar pemain, posisi, dan pemilik kendaraan versi host disalin ke store untuk UI host. */
function syncHostStore(host: HostSession): void {
  const store = useNetStore.getState();
  const players = host.playerList();
  const key = players.map((player) => `${player.id}:${player.username}`).join(',');
  if (key !== hostPlayersKey) {
    hostPlayersKey = key;
    store.setPlayers(players);
  }
  const snapshots: PlayerSnapshot[] = [];
  for (const player of players) {
    if (player.id === host.localPlayerId) continue;
    const snapshot = host.playerState(player.id);
    if (snapshot) snapshots.push(snapshot);
  }
  if (snapshots.length > 0) store.applySnapshots(snapshots);
  for (const parked of INITIAL_VEHICLES) {
    const vehicle = host.vehicle(parked.id);
    if (!vehicle) continue;
    if (hostVehicleOwners.get(parked.id) === vehicle.ownerId) continue;
    hostVehicleOwners.set(parked.id, vehicle.ownerId);
    emitVehicle({ ...vehicle });
  }
}

/** Menulis status error ke store lalu melempar Error dengan pesan yang sama. */
function fail(message: string, cause: unknown): never {
  useNetStore.getState().setStatus('error', message);
  throw cause === null ? new Error(message) : new Error(message, { cause });
}

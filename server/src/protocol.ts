import { APPEARANCE_BYTES, decodeAppearanceOrDefault, encodeAppearanceInto, type Appearance } from './appearance.js';

/*
 * SALINAN dari web/src/net/protocol.ts (klien). Logika encode/decode TIDAK boleh diubah tanpa
 * mengubah klien dan menaikkan PROTOCOL_VERSION. Kompatibilitas byte-per-byte dijaga oleh
 * test/protocol.test.ts yang memakai vektor hex hasil encode kode klien asli.
 * Perbedaan dengan klien hanya impor: konstanta dunia di bawah disalin dari web/src/world/worldSpec.ts.
 */

/** Ukuran chunk dunia (m), sama dengan worldSpec.ts. Dipakai juga oleh grid AOI. */
export const CHUNK_SIZE = 64;
export const WORLD_CHUNKS = 8;
export const WORLD_SIZE = CHUNK_SIZE * WORLD_CHUNKS;
export const HALF_WORLD = WORLD_SIZE / 2;
/** Panjang satu hari game (detik), sama dengan game/dayCycle.ts. */
export const DAY_SECONDS = 480;

export type MoveMode = 'walk' | 'skate' | 'bike' | 'moto' | 'car';

/**
 * Protokol wire multiplayer (MULTIPLAYER.md bagian 4). Semua pesan biner lewat DataView,
 * tidak ada JSON: pesan posisi dikirim 10-15 Hz, jadi tiap byte dihitung.
 * Byte order: big-endian (network order) untuk semua field multi-byte.
 * Format lengkap tiap pesan ada di docs/NET_PROTOCOL.md.
 */
export const PROTOCOL_VERSION = 1;

/** Id byte tiap jenis pesan. Nilai tidak boleh digeser tanpa menaikkan PROTOCOL_VERSION. */
export const MSG = {
  hello: 1,
  welcome: 2,
  state: 3,
  appearance: 4,
  vehicleClaim: 5,
  vehicleState: 6,
  clock: 7,
  chat: 8,
  playerJoin: 9,
  playerLeave: 10,
  ping: 11,
  pong: 12,
} as const;
export type MsgId = (typeof MSG)[keyof typeof MSG];

/** Header tiap pesan: 1 byte versi protokol + 1 byte id pesan. */
export const HEADER_BYTES = 2;
/** Satu entri posisi di snapshot `state`: id 2 + x/z/y 6 + heading 1 + mode 1 + anim 1 + flag 1. */
export const STATE_ENTRY_BYTES = 12;
/** Batas panjang teks chat (MULTIPLAYER.md 5.1). */
export const CHAT_TEXT_MAX = 200;
export const USERNAME_BYTES_MAX = 80;
/** Batas vertikal peta untuk kuantisasi y (meter). */
export const MIN_Y = -32;
export const MAX_Y = 224;
/** Maksimum pemain dalam satu snapshot (50 per room, 4.1). */
export const MAX_PLAYERS_PER_SNAPSHOT = 64;

export type PlayerId = number;

/** Urutan harus stabil: indeksnya ikut terkirim sebagai byte moveMode. */
export const MOVE_MODES: readonly MoveMode[] = ['walk', 'skate', 'bike', 'moto', 'car'];
/** Klip animasi yang relevan untuk pemain lain (cukup untuk RemotePlayers). */
export const ANIM_IDS = ['idle', 'walk', 'run', 'ride', 'sit', 'jump'] as const;
export type AnimId = (typeof ANIM_IDS)[number];

export const CHAT_CHANNELS = ['session', 'nearby'] as const;
export type ChatChannel = (typeof CHAT_CHANNELS)[number];

export interface PlayerSnapshot {
  id: PlayerId;
  x: number;
  y: number;
  z: number;
  /** Radian, dikuantisasi ke 8 bit (1.4 derajat). */
  heading: number;
  mode: MoveMode;
  anim: AnimId;
  jumping: boolean;
}

export interface HelloMessage {
  type: 'hello';
  username: string;
  appearance: Appearance;
}

export interface PlayerInfo {
  id: PlayerId;
  username: string;
  appearance: Appearance;
}

export interface WelcomeMessage {
  type: 'welcome';
  playerId: PlayerId;
  /** Jam dunia host dalam detik (0..DAY_SECONDS). */
  timeOfDay: number;
  players: PlayerInfo[];
}

export interface StateMessage {
  type: 'state';
  /** Waktu host saat snapshot dibuat (ms, dipotong 32 bit) untuk interpolasi. */
  timeMs: number;
  players: PlayerSnapshot[];
}

export interface AppearanceMessage {
  type: 'appearance';
  /** 0 saat klien mengirim ke host (host tahu pengirimnya dari koneksi). */
  playerId: PlayerId;
  appearance: Appearance;
}

export interface VehicleClaimMessage {
  type: 'vehicleClaim';
  vehicleId: string;
  /** 'mount' = minta naik, 'release' = turun di posisi x/z/yaw. */
  action: 'mount' | 'release';
  x: number;
  z: number;
  yaw: number;
}

export interface VehicleStateMessage {
  type: 'vehicleState';
  vehicleId: string;
  /** 0 = terparkir (tidak ada yang naik). */
  ownerId: PlayerId;
  x: number;
  z: number;
  yaw: number;
}

export interface ClockMessage {
  type: 'clock';
  timeOfDay: number;
  timeMs: number;
}

export interface ChatMessage {
  type: 'chat';
  channel: ChatChannel;
  /** 0 saat klien mengirim; host mengisi id pengirim sebelum meneruskan. */
  fromId: PlayerId;
  /** Id pesan unik per sesi, diisi host (0 dari klien). */
  msgId: number;
  /** Waktu host (ms, 32 bit), diisi host. */
  timeMs: number;
  text: string;
}

export interface PlayerJoinMessage {
  type: 'playerJoin';
  player: PlayerInfo;
}

export interface PlayerLeaveMessage {
  type: 'playerLeave';
  playerId: PlayerId;
}

export interface PingMessage {
  type: 'ping';
  nonce: number;
}

export interface PongMessage {
  type: 'pong';
  nonce: number;
}

export type NetMessage =
  | HelloMessage
  | WelcomeMessage
  | StateMessage
  | AppearanceMessage
  | VehicleClaimMessage
  | VehicleStateMessage
  | ClockMessage
  | ChatMessage
  | PlayerJoinMessage
  | PlayerLeaveMessage
  | PingMessage
  | PongMessage;

/** Pesan `state` dikirim unreliable, sisanya reliable (MULTIPLAYER.md bagian 3). */
export const isReliable = (type: NetMessage['type']): boolean => type !== 'state';

export type DecodeError =
  | 'empty'
  | 'version'
  | 'unknown-type'
  | 'length'
  | 'text'
  | 'bounds'
  | 'field';

export type DecodeResult = { ok: true; message: NetMessage } | { ok: false; error: DecodeError };

const fail = (error: DecodeError): DecodeResult => ({ ok: false, error });

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

/** Buang karakter kontrol dan rapikan spasi (MULTIPLAYER.md 5.1), tanpa memotong panjang. */
export function sanitizeText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Benar kalau teks chat layak dikirim: tidak kosong dan maksimal 200 karakter. */
export function isValidChatText(text: string): boolean {
  const clean = sanitizeText(text);
  return clean.length > 0 && [...clean].length <= CHAT_TEXT_MAX;
}

export const inWorldBounds = (x: number, z: number): boolean =>
  Number.isFinite(x) && Number.isFinite(z) && Math.abs(x) <= HALF_WORLD && Math.abs(z) <= HALF_WORLD;

const clamp = (value: number, min: number, max: number): number => (value < min ? min : value > max ? max : value);

/** x/z: 16 bit sepanjang lebar peta (512 m / 65535 ≈ 8 mm). */
export const quantizeXZ = (value: number): number =>
  Math.round(((clamp(value, -HALF_WORLD, HALF_WORLD) + HALF_WORLD) / WORLD_SIZE) * 0xffff);
export const dequantizeXZ = (raw: number): number => (raw / 0xffff) * WORLD_SIZE - HALF_WORLD;
/** y: 16 bit antara MIN_Y dan MAX_Y (4 mm). */
export const quantizeY = (value: number): number =>
  Math.round(((clamp(value, MIN_Y, MAX_Y) - MIN_Y) / (MAX_Y - MIN_Y)) * 0xffff);
export const dequantizeY = (raw: number): number => (raw / 0xffff) * (MAX_Y - MIN_Y) + MIN_Y;
const TWO_PI = Math.PI * 2;
/** heading: 8 bit penuh keliling (1.41 derajat). */
export const quantizeHeading = (value: number): number => {
  const wrapped = ((value % TWO_PI) + TWO_PI) % TWO_PI;
  return Math.round((wrapped / TWO_PI) * 256) & 0xff;
};
export const dequantizeHeading = (raw: number): number => (raw / 256) * TWO_PI;

class Writer {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private offset = 0;

  constructor(size: number) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
  }

  u8(value: number): void {
    this.view.setUint8(this.offset, value & 0xff);
    this.offset += 1;
  }

  u16(value: number): void {
    this.view.setUint16(this.offset, value & 0xffff);
    this.offset += 2;
  }

  u32(value: number): void {
    this.view.setUint32(this.offset, value >>> 0);
    this.offset += 4;
  }

  f32(value: number): void {
    this.view.setFloat32(this.offset, value);
    this.offset += 4;
  }

  raw(data: Uint8Array): void {
    this.bytes.set(data, this.offset);
    this.offset += data.length;
  }

  appearance(appearance: Appearance): void {
    encodeAppearanceInto(this.bytes, this.offset, appearance);
    this.offset += APPEARANCE_BYTES;
  }

  /** String pendek: 1 byte panjang (byte UTF-8) + isi. */
  str8(data: Uint8Array): void {
    this.u8(data.length);
    this.raw(data);
  }

  /** String chat: 2 byte panjang + isi. */
  str16(data: Uint8Array): void {
    this.u16(data.length);
    this.raw(data);
  }

  finish(): Uint8Array {
    return this.bytes.subarray(0, this.offset);
  }
}

class Reader {
  private readonly view: DataView;
  private offset: number;

  constructor(private readonly bytes: Uint8Array, offset: number) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = offset;
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  get atEnd(): boolean {
    return this.offset === this.bytes.length;
  }

  need(count: number): boolean {
    return this.remaining >= count;
  }

  u8(): number {
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  u16(): number {
    const value = this.view.getUint16(this.offset);
    this.offset += 2;
    return value;
  }

  u32(): number {
    const value = this.view.getUint32(this.offset);
    this.offset += 4;
    return value;
  }

  f32(): number {
    const value = this.view.getFloat32(this.offset);
    this.offset += 4;
    return value;
  }

  /**
   * Penampilan tidak valid (versi format beda, angka di luar 0-2) tidak menolak seluruh pesan:
   * pemain memakai tampilan default (MULTIPLAYER.md 3.1). `null` hanya kalau byte-nya kurang.
   */
  appearance(): Appearance | null {
    if (!this.need(APPEARANCE_BYTES)) return null;
    const appearance = decodeAppearanceOrDefault(this.bytes, this.offset);
    this.offset += APPEARANCE_BYTES;
    return appearance;
  }

  /** `null` kalau panjangnya melebihi sisa buffer atau isinya bukan UTF-8 yang sah. */
  text(lengthBytes: 1 | 2, maxBytes: number): string | null {
    if (!this.need(lengthBytes)) return null;
    const length = lengthBytes === 1 ? this.u8() : this.u16();
    if (length > maxBytes || !this.need(length)) return null;
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    try {
      return textDecoder.decode(slice);
    } catch {
      return null;
    }
  }
}

const utf8 = (text: string): Uint8Array => textEncoder.encode(text);

const modeId = (mode: MoveMode): number => {
  const index = MOVE_MODES.indexOf(mode);
  return index < 0 ? 0 : index;
};
const animId = (anim: AnimId): number => {
  const index = ANIM_IDS.indexOf(anim);
  return index < 0 ? 0 : index;
};

/** Melempar RangeError kalau isi pesan tidak sah (teks terlalu panjang, penampilan tidak valid). */
export function encodeMessage(message: NetMessage): Uint8Array {
  switch (message.type) {
    case 'hello': {
      const name = utf8(message.username);
      if (name.length > USERNAME_BYTES_MAX) throw new RangeError('Username terlalu panjang.');
      const writer = new Writer(HEADER_BYTES + APPEARANCE_BYTES + 1 + name.length);
      writer.u8(PROTOCOL_VERSION);
      writer.u8(MSG.hello);
      writer.appearance(message.appearance);
      writer.str8(name);
      return writer.finish();
    }
    case 'welcome': {
      const names = message.players.map((player) => utf8(player.username));
      const size =
        HEADER_BYTES +
        2 +
        4 +
        1 +
        message.players.reduce((sum, _player, index) => sum + 2 + APPEARANCE_BYTES + 1 + (names[index] as Uint8Array).length, 0);
      const writer = new Writer(size);
      writer.u8(PROTOCOL_VERSION);
      writer.u8(MSG.welcome);
      writer.u16(message.playerId);
      writer.f32(message.timeOfDay);
      writer.u8(message.players.length);
      message.players.forEach((player, index) => {
        writer.u16(player.id);
        writer.appearance(player.appearance);
        writer.str8(names[index] as Uint8Array);
      });
      return writer.finish();
    }
    case 'state': {
      const writer = new Writer(HEADER_BYTES + 4 + 1 + message.players.length * STATE_ENTRY_BYTES);
      writer.u8(PROTOCOL_VERSION);
      writer.u8(MSG.state);
      writer.u32(message.timeMs);
      writer.u8(message.players.length);
      for (const player of message.players) {
        writer.u16(player.id);
        writer.u16(quantizeXZ(player.x));
        writer.u16(quantizeXZ(player.z));
        writer.u16(quantizeY(player.y));
        writer.u8(quantizeHeading(player.heading));
        writer.u8(modeId(player.mode));
        writer.u8(animId(player.anim));
        writer.u8(player.jumping ? 1 : 0);
      }
      return writer.finish();
    }
    case 'appearance': {
      const writer = new Writer(HEADER_BYTES + 2 + APPEARANCE_BYTES);
      writer.u8(PROTOCOL_VERSION);
      writer.u8(MSG.appearance);
      writer.u16(message.playerId);
      writer.appearance(message.appearance);
      return writer.finish();
    }
    case 'vehicleClaim': {
      const id = utf8(message.vehicleId);
      const writer = new Writer(HEADER_BYTES + 1 + 1 + id.length + 12);
      writer.u8(PROTOCOL_VERSION);
      writer.u8(MSG.vehicleClaim);
      writer.u8(message.action === 'release' ? 1 : 0);
      writer.str8(id);
      writer.f32(message.x);
      writer.f32(message.z);
      writer.f32(message.yaw);
      return writer.finish();
    }
    case 'vehicleState': {
      const id = utf8(message.vehicleId);
      const writer = new Writer(HEADER_BYTES + 2 + 1 + id.length + 12);
      writer.u8(PROTOCOL_VERSION);
      writer.u8(MSG.vehicleState);
      writer.u16(message.ownerId);
      writer.str8(id);
      writer.f32(message.x);
      writer.f32(message.z);
      writer.f32(message.yaw);
      return writer.finish();
    }
    case 'clock': {
      const writer = new Writer(HEADER_BYTES + 4 + 4);
      writer.u8(PROTOCOL_VERSION);
      writer.u8(MSG.clock);
      writer.f32(message.timeOfDay);
      writer.u32(message.timeMs);
      return writer.finish();
    }
    case 'chat': {
      const clean = sanitizeText(message.text);
      if (!isValidChatText(clean)) throw new RangeError('Teks chat tidak valid.');
      const text = utf8(clean);
      const writer = new Writer(HEADER_BYTES + 1 + 2 + 4 + 4 + 2 + text.length);
      writer.u8(PROTOCOL_VERSION);
      writer.u8(MSG.chat);
      writer.u8(message.channel === 'nearby' ? 1 : 0);
      writer.u16(message.fromId);
      writer.u32(message.msgId);
      writer.u32(message.timeMs);
      writer.str16(text);
      return writer.finish();
    }
    case 'playerJoin': {
      const name = utf8(message.player.username);
      if (name.length > USERNAME_BYTES_MAX) throw new RangeError('Username terlalu panjang.');
      const writer = new Writer(HEADER_BYTES + 2 + APPEARANCE_BYTES + 1 + name.length);
      writer.u8(PROTOCOL_VERSION);
      writer.u8(MSG.playerJoin);
      writer.u16(message.player.id);
      writer.appearance(message.player.appearance);
      writer.str8(name);
      return writer.finish();
    }
    case 'playerLeave': {
      const writer = new Writer(HEADER_BYTES + 2);
      writer.u8(PROTOCOL_VERSION);
      writer.u8(MSG.playerLeave);
      writer.u16(message.playerId);
      return writer.finish();
    }
    case 'ping':
    case 'pong': {
      const writer = new Writer(HEADER_BYTES + 4);
      writer.u8(PROTOCOL_VERSION);
      writer.u8(message.type === 'ping' ? MSG.ping : MSG.pong);
      writer.u32(message.nonce);
      return writer.finish();
    }
  }
}

/**
 * Validasi penuh: versi protokol, panjang buffer persis, teks UTF-8 <= 200 karakter,
 * dan koordinat di dalam batas peta. Pesan yang tidak lolos dibuang oleh host/klien.
 */
export function decodeMessage(data: Uint8Array): DecodeResult {
  if (data.length < HEADER_BYTES) return fail('empty');
  if (data[0] !== PROTOCOL_VERSION) return fail('version');
  const type = data[1] as number;
  const reader = new Reader(data, HEADER_BYTES);
  switch (type) {
    case MSG.hello: {
      const appearance = reader.appearance();
      if (!appearance) return fail('length');
      const username = reader.text(1, USERNAME_BYTES_MAX);
      if (username === null) return fail('text');
      if (!reader.atEnd) return fail('length');
      return { ok: true, message: { type: 'hello', username, appearance } };
    }
    case MSG.welcome: {
      if (!reader.need(7)) return fail('length');
      const playerId = reader.u16();
      const timeOfDay = reader.f32();
      const count = reader.u8();
      if (count > MAX_PLAYERS_PER_SNAPSHOT) return fail('field');
      const players: PlayerInfo[] = [];
      for (let index = 0; index < count; index++) {
        if (!reader.need(2 + APPEARANCE_BYTES + 1)) return fail('length');
        const id = reader.u16();
        const appearance = reader.appearance();
        if (!appearance) return fail('length');
        const username = reader.text(1, USERNAME_BYTES_MAX);
        if (username === null) return fail('text');
        players.push({ id, username, appearance });
      }
      if (!reader.atEnd) return fail('length');
      if (!Number.isFinite(timeOfDay)) return fail('field');
      return { ok: true, message: { type: 'welcome', playerId, timeOfDay, players } };
    }
    case MSG.state: {
      if (!reader.need(5)) return fail('length');
      const timeMs = reader.u32();
      const count = reader.u8();
      if (count > MAX_PLAYERS_PER_SNAPSHOT) return fail('field');
      if (reader.remaining !== count * STATE_ENTRY_BYTES) return fail('length');
      const players: PlayerSnapshot[] = [];
      for (let index = 0; index < count; index++) {
        const id = reader.u16();
        const x = dequantizeXZ(reader.u16());
        const z = dequantizeXZ(reader.u16());
        const y = dequantizeY(reader.u16());
        const heading = dequantizeHeading(reader.u8());
        const rawMode = reader.u8();
        const rawAnim = reader.u8();
        const flags = reader.u8();
        if (rawMode >= MOVE_MODES.length || rawAnim >= ANIM_IDS.length || flags > 1) return fail('field');
        if (!inWorldBounds(x, z)) return fail('bounds');
        players.push({
          id,
          x,
          y,
          z,
          heading,
          mode: MOVE_MODES[rawMode] as MoveMode,
          anim: ANIM_IDS[rawAnim] as AnimId,
          jumping: flags === 1,
        });
      }
      return { ok: true, message: { type: 'state', timeMs, players } };
    }
    case MSG.appearance: {
      if (reader.remaining !== 2 + APPEARANCE_BYTES) return fail('length');
      const playerId = reader.u16();
      const appearance = reader.appearance();
      if (!appearance) return fail('length');
      return { ok: true, message: { type: 'appearance', playerId, appearance } };
    }
    case MSG.vehicleClaim: {
      if (!reader.need(2)) return fail('length');
      const rawAction = reader.u8();
      if (rawAction > 1) return fail('field');
      const vehicleId = reader.text(1, USERNAME_BYTES_MAX);
      if (vehicleId === null) return fail('text');
      if (reader.remaining !== 12) return fail('length');
      const x = reader.f32();
      const z = reader.f32();
      const yaw = reader.f32();
      if (!inWorldBounds(x, z) || !Number.isFinite(yaw)) return fail('bounds');
      return {
        ok: true,
        message: { type: 'vehicleClaim', vehicleId, action: rawAction === 1 ? 'release' : 'mount', x, z, yaw },
      };
    }
    case MSG.vehicleState: {
      if (!reader.need(3)) return fail('length');
      const ownerId = reader.u16();
      const vehicleId = reader.text(1, USERNAME_BYTES_MAX);
      if (vehicleId === null) return fail('text');
      if (reader.remaining !== 12) return fail('length');
      const x = reader.f32();
      const z = reader.f32();
      const yaw = reader.f32();
      if (!inWorldBounds(x, z) || !Number.isFinite(yaw)) return fail('bounds');
      return { ok: true, message: { type: 'vehicleState', vehicleId, ownerId, x, z, yaw } };
    }
    case MSG.clock: {
      if (reader.remaining !== 8) return fail('length');
      const timeOfDay = reader.f32();
      const timeMs = reader.u32();
      if (!Number.isFinite(timeOfDay)) return fail('field');
      return { ok: true, message: { type: 'clock', timeOfDay, timeMs } };
    }
    case MSG.chat: {
      if (!reader.need(13)) return fail('length');
      const rawChannel = reader.u8();
      if (rawChannel > 1) return fail('field');
      const fromId = reader.u16();
      const msgId = reader.u32();
      const timeMs = reader.u32();
      const text = reader.text(2, CHAT_TEXT_MAX * 4);
      if (text === null) return fail('text');
      if (!reader.atEnd) return fail('length');
      const clean = sanitizeText(text);
      if (!isValidChatText(clean)) return fail('text');
      return {
        ok: true,
        message: { type: 'chat', channel: rawChannel === 1 ? 'nearby' : 'session', fromId, msgId, timeMs, text: clean },
      };
    }
    case MSG.playerJoin: {
      if (!reader.need(2 + APPEARANCE_BYTES + 1)) return fail('length');
      const id = reader.u16();
      const appearance = reader.appearance();
      if (!appearance) return fail('length');
      const username = reader.text(1, USERNAME_BYTES_MAX);
      if (username === null) return fail('text');
      if (!reader.atEnd) return fail('length');
      return { ok: true, message: { type: 'playerJoin', player: { id, username, appearance } } };
    }
    case MSG.playerLeave: {
      if (reader.remaining !== 2) return fail('length');
      return { ok: true, message: { type: 'playerLeave', playerId: reader.u16() } };
    }
    case MSG.ping:
    case MSG.pong: {
      if (reader.remaining !== 4) return fail('length');
      const nonce = reader.u32();
      return { ok: true, message: type === MSG.ping ? { type: 'ping', nonce } : { type: 'pong', nonce } };
    }
    default:
      return fail('unknown-type');
  }
}
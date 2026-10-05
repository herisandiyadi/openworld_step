import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// Komponen mengimpor plugin native dan runtime jaringan; test ini hanya menguji logika murni.
vi.mock('../net/nearbyPlugin', () => ({ Nearby: {} }));
vi.mock('../net/netRuntime', () => ({
  connectLocalHost: vi.fn(),
  connectLocalClient: vi.fn(),
  connectOnline: vi.fn(),
  disconnect: vi.fn(),
  roomCode: vi.fn(() => null),
  currentMode: vi.fn(() => null),
}));
vi.mock('../state/netSettings', () => ({ useNetSettings: vi.fn(), isServerConfigured: vi.fn() }));
vi.mock('../state/profile', () => ({ usePlayerProfile: vi.fn(), DEFAULT_APPEARANCE: {} }));
vi.mock('./multiplayerMenu.css', () => ({}));

const {
  MAX_LOCAL_PLAYERS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  applyDeviceEvent,
  formatPing,
  isLocalSessionFull,
  isRoomCode,
  normalizeRoomCode,
  pendingConfirmations,
  roomCodeError,
} = await import('./MultiplayerMenu');
type NearbyDevice = import('./MultiplayerMenu').NearbyDevice;

describe('kode room', () => {
  it('sama persis dengan server/src/room.ts', () => {
    const source = readFileSync(new URL('../../../server/src/room.ts', import.meta.url), 'utf8');
    expect(source).toContain(`ROOM_CODE_ALPHABET = '${ROOM_CODE_ALPHABET}'`);
    expect(source).toContain(`ROOM_CODE_LENGTH = ${ROOM_CODE_LENGTH}`);
  });

  it('alfabet tanpa karakter ambigu', () => {
    for (const char of '0O1IL') expect(ROOM_CODE_ALPHABET).not.toContain(char);
  });

  it('huruf dibesarkan dan karakter tak sah dibuang', () => {
    expect(normalizeRoomCode('abc234')).toBe('ABC234');
    expect(normalizeRoomCode(' a-b c_2 ')).toBe('ABC2');
    expect(normalizeRoomCode('0O1Il')).toBe('');
    expect(normalizeRoomCode('ölñ')).toBe('');
  });

  it('dipotong di 6 karakter', () => {
    expect(normalizeRoomCode('ABCDEFGHJK')).toBe('ABCDEF');
    // Karakter ambigu (0, 1, o, i, l) dibuang sebelum dihitung ke batas 6.
    expect(normalizeRoomCode('a0b1c2o3i4l5')).toBe('ABC234');
    expect(normalizeRoomCode('a0b1c2d3e4f5')).toBe('ABC2D3');
  });

  it('validasi kode lengkap', () => {
    expect(isRoomCode('ABC234')).toBe(true);
    expect(isRoomCode('ABC23')).toBe(false);
    expect(isRoomCode('ABC230')).toBe(false);
    expect(isRoomCode('abc234')).toBe(false);
    expect(roomCodeError('')).toMatch(/Masukkan/);
    expect(roomCodeError('ABC')).toMatch(/6 karakter/);
    expect(roomCodeError('ABC234')).toBeNull();
  });
});

describe('daftar HP terdekat', () => {
  const found = applyDeviceEvent([], { kind: 'found', endpointId: 'e1', name: 'Budi' });

  it('endpointFound menambah, duplikat tidak menggandakan', () => {
    expect(found).toEqual([{ endpointId: 'e1', name: 'Budi', state: 'ditemukan', authDigits: null }]);
    expect(applyDeviceEvent(found, { kind: 'found', endpointId: 'e1', name: 'Budi 2' })).toHaveLength(1);
  });

  it('alur lengkap: minta -> konfirmasi 4 digit -> tersambung', () => {
    let list: NearbyDevice[] = applyDeviceEvent(found, { kind: 'requested', endpointId: 'e1' });
    expect(list[0]?.state).toBe('menyambungkan');
    list = applyDeviceEvent(list, { kind: 'initiated', endpointId: 'e1', name: 'Budi', authDigits: '4821' });
    expect(pendingConfirmations(list)).toEqual([{ endpointId: 'e1', name: 'Budi', state: 'konfirmasi', authDigits: '4821' }]);
    list = applyDeviceEvent(list, { kind: 'connected', endpointId: 'e1', name: 'Budi' });
    expect(list[0]?.state).toBe('tersambung');
    expect(pendingConfirmations(list)).toEqual([]);
  });

  it('host menerima connectionInitiated tanpa endpointFound', () => {
    const list = applyDeviceEvent([], { kind: 'initiated', endpointId: 'k9', name: 'Sari', authDigits: '0007' });
    expect(list).toEqual([{ endpointId: 'k9', name: 'Sari', state: 'konfirmasi', authDigits: '0007' }]);
  });

  it('endpointLost hanya menghapus yang masih sekadar ditemukan', () => {
    expect(applyDeviceEvent(found, { kind: 'lost', endpointId: 'e1' })).toEqual([]);
    const pending = applyDeviceEvent(found, { kind: 'initiated', endpointId: 'e1', name: 'Budi', authDigits: '1234' });
    expect(applyDeviceEvent(pending, { kind: 'lost', endpointId: 'e1' })).toHaveLength(1);
  });

  it('gagal, putus, dan reset mengeluarkan entri', () => {
    const two = applyDeviceEvent(found, { kind: 'found', endpointId: 'e2', name: 'Ani' });
    expect(applyDeviceEvent(two, { kind: 'failed', endpointId: 'e1' }).map((d) => d.endpointId)).toEqual(['e2']);
    expect(applyDeviceEvent(two, { kind: 'disconnected', endpointId: 'e2' }).map((d) => d.endpointId)).toEqual(['e1']);
    expect(applyDeviceEvent(two, { kind: 'reset' })).toEqual([]);
  });

  it('requested untuk endpoint tak dikenal tidak mengubah daftar', () => {
    expect(applyDeviceEvent(found, { kind: 'requested', endpointId: 'zz' })).toEqual(found);
  });

  it('tidak memutasi daftar lama', () => {
    const before = JSON.stringify(found);
    applyDeviceEvent(found, { kind: 'requested', endpointId: 'e1' });
    applyDeviceEvent(found, { kind: 'lost', endpointId: 'e1' });
    expect(JSON.stringify(found)).toBe(before);
  });
});

describe('sesi lokal dan ping', () => {
  it('maksimal 5 pemain termasuk host', () => {
    expect(MAX_LOCAL_PLAYERS).toBe(5);
    expect(isLocalSessionFull(3)).toBe(false);
    expect(isLocalSessionFull(4)).toBe(true);
  });

  it('format ping', () => {
    expect(formatPing(null)).toBe('ping -');
    expect(formatPing(42.6)).toBe('ping 43 ms');
    expect(formatPing(-3)).toBe('ping 0 ms');
  });
});

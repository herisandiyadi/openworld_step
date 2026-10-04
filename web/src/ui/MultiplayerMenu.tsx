import type { PluginListenerHandle } from '@capacitor/core';
import { type FormEvent, type ReactElement, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Nearby, type NearbyEventMap, type NearbyEventName } from '../net/nearbyPlugin';
import { connectLocalClient, connectLocalHost, connectOnline, currentMode, disconnect, roomCode } from '../net/netRuntime';
import { useNetStore } from '../net/netStore';
import { isServerConfigured, useNetSettings } from '../state/netSettings';
import { DEFAULT_APPEARANCE, usePlayerProfile, type Appearance } from '../state/profile';
import './multiplayerMenu.css';

/* ------------------------------------------------------------------------------------------------
 * Logika murni (diuji di multiplayerMenu.test.ts)
 * ---------------------------------------------------------------------------------------------- */

/** Alfabet dan panjang kode room disalin dari server/src/room.ts (tanpa 0, O, 1, I, L). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;
/** Batas pemain sesi lokal: host + 4 klien (MULTIPLAYER.md bagian 1 dan 4). */
export const MAX_LOCAL_PLAYERS = 5;

/**
 * Membersihkan ketikan pemain: huruf dibesarkan, karakter di luar alfabet server dibuang,
 * dan hasilnya dipotong di `ROOM_CODE_LENGTH`. Huruf kecil `l`/`o`/`i` menjadi `L`/`O`/`I`
 * yang tidak ada di alfabet, jadi ikut dibuang.
 */
export function normalizeRoomCode(raw: string): string {
  let code = '';
  for (const char of raw.toUpperCase()) {
    if (!ROOM_CODE_ALPHABET.includes(char)) continue;
    code += char;
    if (code.length === ROOM_CODE_LENGTH) break;
  }
  return code;
}

/** Benar kalau kode sudah lengkap dan semua karakternya sah. */
export const isRoomCode = (value: string): boolean =>
  value.length === ROOM_CODE_LENGTH && [...value].every((char) => ROOM_CODE_ALPHABET.includes(char));

/** Pesan error bahasa Indonesia untuk kode room, atau null kalau kode sah. */
export function roomCodeError(value: string): string | null {
  if (value.length === 0) return 'Masukkan kode room 6 karakter.';
  if (!isRoomCode(value)) return `Kode room harus ${ROOM_CODE_LENGTH} karakter, tanpa angka 0/1 dan huruf O/I/L.`;
  return null;
}

/** Benar kalau sesi lokal sudah penuh (pemain lokal + `remoteCount` pemain lain). */
export const isLocalSessionFull = (remoteCount: number): boolean => remoteCount + 1 >= MAX_LOCAL_PLAYERS;

/** Tahap satu HP terdekat di daftar penemuan. */
export type DeviceState = 'ditemukan' | 'konfirmasi' | 'menyambungkan' | 'tersambung';

export interface NearbyDevice {
  endpointId: string;
  name: string;
  state: DeviceState;
  /** Kode konfirmasi 4 digit dari event `connectionInitiated`; null sebelum itu. */
  authDigits: string | null;
}

/** Event plugin Nearby yang mengubah daftar HP (dipetakan 1:1 dari nama event asli). */
export type DeviceEvent =
  | { kind: 'found'; endpointId: string; name: string }
  | { kind: 'lost'; endpointId: string }
  | { kind: 'requested'; endpointId: string }
  | { kind: 'initiated'; endpointId: string; name: string; authDigits: string }
  | { kind: 'connected'; endpointId: string; name: string }
  | { kind: 'failed'; endpointId: string }
  | { kind: 'disconnected'; endpointId: string }
  | { kind: 'reset' };

const withDevice = (list: readonly NearbyDevice[], device: NearbyDevice): NearbyDevice[] => {
  const index = list.findIndex((entry) => entry.endpointId === device.endpointId);
  if (index < 0) return [...list, device];
  const next = [...list];
  next[index] = device;
  return next;
};

const patchDevice = (
  list: readonly NearbyDevice[],
  endpointId: string,
  patch: (device: NearbyDevice) => NearbyDevice,
): NearbyDevice[] => {
  const index = list.findIndex((entry) => entry.endpointId === endpointId);
  if (index < 0) return [...list];
  const current = list[index];
  if (!current) return [...list];
  const next = [...list];
  next[index] = patch(current);
  return next;
};

/**
 * Transisi daftar HP terdekat, murni supaya bisa diuji tanpa React maupun plugin native.
 *
 * Aturan: `endpointLost` hanya menghapus entri yang masih sekadar "ditemukan" (HP yang sedang
 * dikonfirmasi atau sudah tersambung tidak boleh hilang dari daftar), `connectionInitiated` boleh
 * memunculkan entri baru (host menerima event ini tanpa pernah melihat `endpointFound`), dan
 * koneksi gagal/putus mengeluarkan entri itu dari daftar.
 */
export function applyDeviceEvent(list: readonly NearbyDevice[], event: DeviceEvent): NearbyDevice[] {
  switch (event.kind) {
    case 'found':
      return withDevice(list, { endpointId: event.endpointId, name: event.name, state: 'ditemukan', authDigits: null });
    case 'lost':
      return list.filter((entry) => entry.endpointId !== event.endpointId || entry.state !== 'ditemukan');
    case 'requested':
      return patchDevice(list, event.endpointId, (device) => ({ ...device, state: 'menyambungkan' }));
    case 'initiated':
      return withDevice(list, {
        endpointId: event.endpointId,
        name: event.name,
        state: 'konfirmasi',
        authDigits: event.authDigits,
      });
    case 'connected':
      return withDevice(list, { endpointId: event.endpointId, name: event.name, state: 'tersambung', authDigits: null });
    case 'failed':
    case 'disconnected':
      return list.filter((entry) => entry.endpointId !== event.endpointId);
    case 'reset':
      return [];
  }
}

/** HP yang sedang menunggu pemain membandingkan 4 digit. */
export const pendingConfirmations = (list: readonly NearbyDevice[]): NearbyDevice[] =>
  list.filter((device) => device.state === 'konfirmasi' && device.authDigits !== null);

/** Teks ping untuk indikator; null/negatif berarti belum terukur. */
export const formatPing = (ping: number | null): string => (ping === null ? 'ping -' : `ping ${Math.max(0, Math.round(ping))} ms`);

/* ------------------------------------------------------------------------------------------------
 * Komponen
 * ---------------------------------------------------------------------------------------------- */

export interface MultiplayerMenuProps {
  onBack: () => void;
  onStart: () => void;
  onOpenSettings: () => void;
}

type View = 'menu' | 'host' | 'join' | 'online';

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Menyalin teks ke papan klip; fallback `execCommand` untuk WebView tanpa Clipboard API. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Lanjut ke fallback di bawah.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', 'true');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Menu "Main bersama" (MULTIPLAYER.md bagian 5): buat sesi lokal, gabung sesi lokal dengan
 * konfirmasi 4 digit, atau main online dengan kode room 6 karakter.
 */
export function MultiplayerMenu({ onBack, onStart, onOpenSettings }: MultiplayerMenuProps): ReactElement {
  const status = useNetStore((state) => state.status);
  const netError = useNetStore((state) => state.error);
  const remotes = useNetStore((state) => state.remotes);
  const ping = useNetStore((state) => state.ping);
  const playerId = useNetStore((state) => state.playerId);

  const profile = usePlayerProfile((state) => state.profile);
  const username = profile?.username ?? 'Pemain';
  const appearance: Appearance = profile?.appearance ?? DEFAULT_APPEARANCE;

  const settings = useNetSettings((state) => state.settings);
  const settingsLoaded = useNetSettings((state) => state.loaded);
  const loadSettings = useNetSettings((state) => state.load);

  const [view, setView] = useState<View>('menu');
  const [devices, setDevices] = useState<NearbyDevice[]>([]);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [codeInput, setCodeInput] = useState('');
  const [onlineCode, setOnlineCode] = useState<string | null>(null);
  const [copyNote, setCopyNote] = useState<string | null>(null);

  const handles = useRef<PluginListenerHandle[]>([]);
  const knownRemotes = useRef<Map<number, string>>(new Map());
  const ids = { code: useId(), status: useId(), notices: useId() };

  useEffect(() => {
    if (!settingsLoaded) void loadSettings();
  }, [settingsLoaded, loadSettings]);

  const dropListeners = useCallback((): void => {
    const current = handles.current;
    handles.current = [];
    for (const handle of current) void handle.remove().catch(() => undefined);
  }, []);

  useEffect(() => dropListeners, [dropListeners]);

  // Notifikasi pemain masuk dan keluar (MULTIPLAYER.md bagian 5).
  useEffect(() => {
    const known = knownRemotes.current;
    const seen = new Set<number>();
    const fresh: string[] = [];
    for (const remote of Object.values(remotes)) {
      seen.add(remote.id);
      if (!known.has(remote.id)) {
        known.set(remote.id, remote.username);
        fresh.push(`${remote.username} masuk sesi.`);
      }
    }
    for (const [id, name] of [...known]) {
      if (seen.has(id)) continue;
      known.delete(id);
      fresh.push(`${name} keluar sesi.`);
    }
    if (fresh.length > 0) setNotices((current) => [...current, ...fresh].slice(-4));
  }, [remotes]);

  const listen = useCallback(
    async <E extends NearbyEventName>(name: E, fn: (event: NearbyEventMap[E]) => void): Promise<void> => {
      const handle = await Nearby.addListener(name, fn);
      handles.current.push(handle);
    },
    [],
  );

  /** Izin runtime Nearby; melempar Error berbahasa Indonesia kalau ditolak. */
  const ensurePermissions = useCallback(async (): Promise<void> => {
    let state = await Nearby.checkPermissions();
    if (state.nearby !== 'granted') state = await Nearby.requestPermissions();
    if (state.nearby !== 'granted') throw new Error('Izin Bluetooth dan lokasi belum diberikan, sesi lokal tidak bisa dimulai.');
  }, []);

  const resetSession = useCallback((): void => {
    dropListeners();
    void Nearby.stopAll().catch(() => undefined);
    disconnect();
    knownRemotes.current.clear();
    setDevices([]);
    setNotices([]);
    setOnlineCode(null);
    setCopyNote(null);
    setLocalError(null);
  }, [dropListeners]);

  const startHost = useCallback(async (): Promise<void> => {
    setBusy(true);
    setLocalError(null);
    setView('host');
    try {
      await ensurePermissions();
      await listen('connectionInitiated', (event) =>
        setDevices((list) =>
          applyDeviceEvent(list, { kind: 'initiated', endpointId: event.endpointId, name: event.name, authDigits: event.authDigits }),
        ),
      );
      await listen('connected', (event) =>
        setDevices((list) => applyDeviceEvent(list, { kind: 'connected', endpointId: event.endpointId, name: event.name })),
      );
      await listen('disconnected', (event) =>
        setDevices((list) => applyDeviceEvent(list, { kind: 'disconnected', endpointId: event.endpointId })),
      );
      await listen('connectionFailed', (event) => {
        setDevices((list) => applyDeviceEvent(list, { kind: 'failed', endpointId: event.endpointId }));
        setLocalError(event.message || `Koneksi gagal (status ${event.status}).`);
      });
      await connectLocalHost({ username, appearance });
      await Nearby.startAdvertising({ localName: username });
    } catch (error) {
      setLocalError(errorText(error));
    } finally {
      setBusy(false);
    }
  }, [appearance, ensurePermissions, listen, username]);

  const startJoin = useCallback(async (): Promise<void> => {
    setBusy(true);
    setLocalError(null);
    setView('join');
    try {
      await ensurePermissions();
      await listen('endpointFound', (event) =>
        setDevices((list) => applyDeviceEvent(list, { kind: 'found', endpointId: event.endpointId, name: event.name })),
      );
      await listen('endpointLost', (event) => setDevices((list) => applyDeviceEvent(list, { kind: 'lost', endpointId: event.endpointId })));
      await listen('connectionInitiated', (event) =>
        setDevices((list) =>
          applyDeviceEvent(list, { kind: 'initiated', endpointId: event.endpointId, name: event.name, authDigits: event.authDigits }),
        ),
      );
      await listen('connected', (event) =>
        setDevices((list) => applyDeviceEvent(list, { kind: 'connected', endpointId: event.endpointId, name: event.name })),
      );
      await listen('disconnected', (event) =>
        setDevices((list) => applyDeviceEvent(list, { kind: 'disconnected', endpointId: event.endpointId })),
      );
      await listen('connectionFailed', (event) => {
        setDevices((list) => applyDeviceEvent(list, { kind: 'failed', endpointId: event.endpointId }));
        setLocalError(event.message || `Koneksi gagal (status ${event.status}).`);
      });
      await Nearby.startDiscovery();
    } catch (error) {
      setLocalError(errorText(error));
    } finally {
      setBusy(false);
    }
  }, [ensurePermissions, listen]);

  const requestDevice = useCallback(
    async (endpointId: string): Promise<void> => {
      setLocalError(null);
      setDevices((list) => applyDeviceEvent(list, { kind: 'requested', endpointId }));
      try {
        await Nearby.requestConnection({ endpointId, localName: username });
      } catch (error) {
        setDevices((list) => applyDeviceEvent(list, { kind: 'failed', endpointId }));
        setLocalError(errorText(error));
      }
    },
    [username],
  );

  /** Pemain menyatakan 4 digit di kedua HP sama: terima koneksi. */
  const acceptDevice = useCallback(
    async (endpointId: string): Promise<void> => {
      setLocalError(null);
      try {
        // Klien menyiapkan sesi sebelum menerima, supaya pesan pertama dari host tidak terlewat.
        if (view === 'join') await connectLocalClient({ username, appearance });
        await Nearby.acceptConnection({ endpointId });
        setDevices((list) => applyDeviceEvent(list, { kind: 'requested', endpointId }));
      } catch (error) {
        setLocalError(errorText(error));
      }
    },
    [appearance, username, view],
  );

  const rejectDevice = useCallback(async (endpointId: string): Promise<void> => {
    try {
      await Nearby.rejectConnection({ endpointId });
    } catch (error) {
      setLocalError(errorText(error));
    }
    setDevices((list) => applyDeviceEvent(list, { kind: 'failed', endpointId }));
  }, []);

  const startOnline = useCallback(
    async (code: string | undefined): Promise<void> => {
      setBusy(true);
      setLocalError(null);
      setCopyNote(null);
      try {
        const created = await connectOnline({ serverUrl: settings.serverUrl, roomCode: code, username, appearance });
        setOnlineCode(created);
      } catch (error) {
        setLocalError(errorText(error));
      } finally {
        setBusy(false);
      }
    },
    [appearance, settings.serverUrl, username],
  );

  const onJoinOnline = (event: FormEvent): void => {
    event.preventDefault();
    const invalid = roomCodeError(codeInput);
    if (invalid) {
      setLocalError(invalid);
      return;
    }
    void startOnline(codeInput);
  };

  const onCopy = async (code: string): Promise<void> => {
    const ok = await copyText(code);
    setCopyNote(ok ? 'Kode room disalin.' : 'Gagal menyalin, catat kodenya manual.');
  };

  const leaveSession = (): void => {
    resetSession();
    setView('menu');
  };

  const back = (): void => {
    resetSession();
    onBack();
  };

  const remoteList = Object.values(remotes);
  const connected = status === 'connected';
  const shownCode = onlineCode ?? roomCode();
  const mode = currentMode();
  const modeLabel = mode === 'online' ? 'mode online' : mode === 'local-host' ? 'mode lokal, host' : mode === 'local-client' ? 'mode lokal' : '';
  const statusText =
    status === 'connecting'
      ? 'Menyambungkan...'
      : connected
        ? `Tersambung${modeLabel ? ` (${modeLabel})` : ''}`
        : status === 'error'
          ? `Gagal: ${netError ?? 'koneksi terputus.'}`
          : localError
            ? `Gagal: ${localError}`
            : 'Belum tersambung.';
  const serverReady = isServerConfigured(settings);

  return (
    <main className="menu-screen" aria-labelledby="multiplayer-heading">
      <div className="menu-panel mp-panel">
        <h1 id="multiplayer-heading" className="menu-heading">
          Main bersama
        </h1>

        {view === 'menu' && (
          <>
            <p className="menu-subtitle">Main di satu ruangan tanpa internet, atau lewat server online.</p>
            <div className="menu-buttons">
              <button type="button" className="overlay-button menu-button" disabled={busy} onClick={() => void startHost()}>
                Buat sesi lokal
              </button>
              <button type="button" className="overlay-button menu-button" disabled={busy} onClick={() => void startJoin()}>
                Gabung sesi lokal
              </button>
              <button type="button" className="overlay-button menu-button" disabled={busy} onClick={() => setView('online')}>
                Main online
              </button>
            </div>
          </>
        )}

        {(view === 'host' || view === 'join') && (
          <section className="mp-section" aria-labelledby="mp-local-heading">
            <h2 id="mp-local-heading" className="mp-subheading">
              {view === 'host' ? 'Sesi lokal (kamu host)' : 'Gabung sesi lokal'}
            </h2>

            {view === 'host' && (
              <>
                <p className="mp-note">
                  Pemain: {remoteList.length + 1}/{MAX_LOCAL_PLAYERS}
                  {isLocalSessionFull(remoteList.length) ? ' (penuh)' : ''}
                </p>
                <ul className="mp-list">
                  <li className="mp-item">
                    <span className="mp-item-name">{username}</span>
                    <span className="mp-item-tag">host{playerId !== null ? ` · id ${playerId}` : ''}</span>
                  </li>
                  {remoteList.map((remote) => (
                    <li key={remote.id} className="mp-item">
                      <span className="mp-item-name">{remote.username}</span>
                      <span className="mp-item-tag">tersambung</span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {view === 'join' && (
              <ul className="mp-list">
                {devices.length === 0 && <li className="mp-note">Mencari HP terdekat...</li>}
                {devices.map((device) => (
                  <li key={device.endpointId} className="mp-item">
                    <span className="mp-item-name">{device.name || device.endpointId}</span>
                    {device.state === 'ditemukan' ? (
                      <button
                        type="button"
                        className="overlay-button secondary mp-item-action"
                        onClick={() => void requestDevice(device.endpointId)}
                      >
                        Sambungkan
                      </button>
                    ) : (
                      <span className="mp-item-tag">{device.state}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {pendingConfirmations(devices).map((device) => (
              <div key={device.endpointId} className="mp-confirm">
                <p className="mp-note">Pastikan angka ini sama di kedua HP:</p>
                <p className="mp-digits" aria-label={`Kode konfirmasi ${device.authDigits ?? ''}`}>
                  {device.authDigits}
                </p>
                <div className="mp-row">
                  <button
                    type="button"
                    className="overlay-button"
                    disabled={view === 'host' && isLocalSessionFull(remoteList.length)}
                    onClick={() => void acceptDevice(device.endpointId)}
                  >
                    Angkanya sama
                  </button>
                  <button type="button" className="overlay-button secondary" onClick={() => void rejectDevice(device.endpointId)}>
                    Tidak sama, tolak
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}

        {view === 'online' && (
          <section className="mp-section" aria-labelledby="mp-online-heading">
            <h2 id="mp-online-heading" className="mp-subheading">
              Main online
            </h2>

            {!serverReady ? (
              <>
                <p className="mp-note">Alamat server belum diatur, jadi mode online belum bisa dipakai.</p>
                <button type="button" className="overlay-button menu-button" onClick={onOpenSettings}>
                  Buka Pengaturan
                </button>
              </>
            ) : (
              <>
                <form className="mp-form" onSubmit={onJoinOnline} noValidate>
                  <label className="field" htmlFor={ids.code}>
                    <span>Kode room ({ROOM_CODE_LENGTH} karakter)</span>
                    <input
                      id={ids.code}
                      type="text"
                      inputMode="text"
                      autoCapitalize="characters"
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={ROOM_CODE_LENGTH}
                      placeholder="ABC234"
                      aria-describedby={ids.status}
                      value={codeInput}
                      onChange={(event) => {
                        setCodeInput(normalizeRoomCode(event.target.value));
                        setLocalError(null);
                      }}
                    />
                  </label>
                  <div className="mp-row">
                    <button type="submit" className="overlay-button" disabled={busy || codeInput.length !== ROOM_CODE_LENGTH}>
                      Gabung room
                    </button>
                    <button type="button" className="overlay-button secondary" disabled={busy} onClick={() => void startOnline(undefined)}>
                      Buat room baru
                    </button>
                  </div>
                </form>
                <p className="mp-note">Tanpa 0, O, 1, I, dan L supaya kodenya tidak salah baca.</p>
              </>
            )}

            {shownCode && (
              <div className="mp-code-box">
                <p className="mp-note">Kode room:</p>
                <p className="mp-code" aria-label={`Kode room ${[...shownCode].join(' ')}`}>
                  {shownCode}
                </p>
                <button type="button" className="overlay-button secondary" onClick={() => void onCopy(shownCode)}>
                  Salin kode
                </button>
                {copyNote && <p className="mp-note">{copyNote}</p>}
              </div>
            )}
          </section>
        )}

        {connected && (
          <p className="mp-note mp-ping" aria-label={`Indikator ping: ${formatPing(ping)}`}>
            {formatPing(ping)} · {remoteList.length} pemain lain
          </p>
        )}

        <p id={ids.status} className={`settings-status${status === 'error' || localError ? ' error' : ''}`} role="status" aria-live="polite">
          {statusText}
        </p>

        <ul id={ids.notices} className="mp-notices" aria-live="polite" aria-label="Notifikasi pemain">
          {notices.map((notice, index) => (
            <li key={`${index}-${notice}`}>{notice}</li>
          ))}
        </ul>

        <div className="menu-buttons">
          {connected && (
            <button type="button" className="overlay-button menu-button" onClick={onStart}>
              Mulai main
            </button>
          )}
          {(connected || view === 'host' || view === 'join' || onlineCode) && (
            <button type="button" className="overlay-button secondary menu-button" onClick={leaveSession}>
              Keluar sesi
            </button>
          )}
          <button type="button" className="overlay-button secondary menu-button" onClick={back}>
            Kembali
          </button>
        </div>
      </div>
    </main>
  );
}

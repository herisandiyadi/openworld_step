/**
 * Map update polling: cek geo-generator untuk map pack baru, stage via
 * ContentUpdateManager yang sudah ada, dan kirim notifikasi ke UI.
 *
 * Alur:
 *   1. Poll MAP_LATEST_URL (default /maps/manifest latest.json dari generator, env VITE_MAPS_LATEST_URL).
 *   2. Bila manifest punya worldVersion=3 dan id berbeda dari yang aktif → map baru tersedia.
 *   3. Stage via checkAndStageLatest() (sistem content update yang ada handle download+verify+sign).
 *   4. Status 'staged' → UI notifikasi "Peta baru tersedia, restart untuk menerapkan".
 *   5. Apply di launch berikutnya via activateStagedContentOnLaunch (sudah dipanggil contentBoot).
 */
import { contentUpdatesRuntime } from './contentUpdatesRuntime';
import type { ContentUpdateStatus } from './contentUpdatesRuntime';

export type MapUpdateState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'downloading'; completed?: number; total?: number; bytes?: number }
  | { phase: 'available'; manifestId: string; manifestVersion: string; reason: 'new-map' | 'updated-map' }
  | { phase: 'staged'; manifestId: string; downloadSize: number }
  | { phase: 'up-to-date' }
  | { phase: 'error'; message: string };

type MapUpdateListener = (state: MapUpdateState) => void;

const listeners = new Set<MapUpdateListener>();
let state: MapUpdateState = { phase: 'idle' };
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;

/** Absolute URL: `new URL()` tanpa base gagal untuk path relatif ("Invalid base URL"). */
export const MAP_LATEST_URL: string = new URL(
  (import.meta.env.VITE_MAPS_LATEST_URL as string | undefined) ?? '/maps-manifest/latest.json',
  typeof document !== 'undefined' ? document.baseURI : 'http://localhost/',
).toString();

export const MAP_POLL_INTERVAL_MS: number =
  Number(import.meta.env.VITE_MAPS_POLL_MS ?? 30 * 60 * 1000); // default 30 menit

export function getMapUpdateState(): MapUpdateState {
  return state;
}

export function subscribeMapUpdate(listener: MapUpdateListener): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

function setState(next: MapUpdateState): void {
  state = next;
  for (const listener of listeners) listener(next);
}

/** Bandingkan manifest terbaru dengan yang sedang aktif. */
async function resolveLatest(): Promise<MapUpdateState> {
  const manager = contentUpdatesRuntime.manager;
  if (!manager) return { phase: 'error', message: 'content update manager belum diinisialisasi' };

  const response = await fetch(MAP_LATEST_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const latest = (await response.json()) as { manifestUrl: string; contentBaseUrl?: string };

  // latest.manifestUrl relatif terhadap latest.json (bukan root app). Memakai document.baseURI
  // sebagai base menghasilkan /little_tokyo/manifest.json -> fallback HTML -> JSON parse gagal.
  const manifestUrl = new URL(latest.manifestUrl, MAP_LATEST_URL).toString();
  const manifestResponse = await fetch(manifestUrl, { cache: 'no-store' });
  if (!manifestResponse.ok) throw new Error(`manifest HTTP ${manifestResponse.status}`);
  const manifest = (await manifestResponse.json()) as {
    id: string;
    version: string;
    worldVersion: number;
  };

  const active = await manager.activeManifest();
  if (active.id === manifest.id && active.version === manifest.version) {
    return { phase: 'up-to-date' };
  }
  const reason = active.id === manifest.id ? 'updated-map' : 'new-map';
  return { phase: 'available', manifestId: manifest.id, manifestVersion: manifest.version, reason };
}

/** Cek sekali sekarang; hasilnya jadi state streaming ke subscriber. */
export async function checkMapUpdateOnce(): Promise<MapUpdateState> {
  // Jangan menimpa state saat unduhan berjalan: setState({phase:'checking'}) akan menghapus
  // progress bar di tengah unduh, dan hasil 'available' membuat tombol unduh muncul lagi
  // (memicu unduhan kedua dari nol).
  if (inFlight) return state;
  setState({ phase: 'checking' });
  try {
    const resolved = await resolveLatest();
    if (inFlight) return state;
    setState(resolved);
    return resolved;
  } catch (error) {
    if (inFlight) return state;
    const failure: MapUpdateState = { phase: 'error', message: error instanceof Error ? error.message : String(error) };
    setState(failure);
    return failure;
  }
}

/**
 * Stage map pack lewat ContentUpdateManager.checkAndStageLatest().
 * latestUrl manager harus sudah diarahkan ke endpoint generator (VITE_CONTENT_LATEST_URL),
 * karena verify+download+sign ada di sana.
 */
export async function stageMapUpdate(): Promise<void> {
  // Guard: satu unduhan pada satu waktu. Tanpa ini klik ganda (atau klik setelah tombol
  // muncul ulang karena polling) memulai unduhan kedua yang menghapus staging dan memaksa
  // paket diunduh dari nol -- paket 2.000 file tidak akan pernah selesai.
  if (inFlight) return;
  const manager = contentUpdatesRuntime.manager;
  if (!manager) throw new Error('content update manager belum diinisialisasi');
  inFlight = true;
  stopMapUpdatePolling(); // hentikan polling selama unduh: cegah status saling menimpa
  setState({ phase: 'downloading' });
  // Selama unduh, salin progres dari status runtime ke state peta (UI progress bar).
  const progressTimer = setInterval(() => {
    const runtime = contentUpdatesRuntime.status;
    if (runtime.state === 'downloading' && runtime.completed !== undefined) {
      setState({ phase: 'downloading', completed: runtime.completed, total: runtime.total, bytes: runtime.bytes });
    }
  }, 250);
  try {
    const result = await manager.checkAndStageLatest();
    if (result.status === 'staged') {
      setState({ phase: 'staged', manifestId: result.plan.manifest.id, downloadSize: result.plan.downloadSize });
    } else if (result.status === 'up-to-date') {
      setState({ phase: 'up-to-date' });
    } else if (result.status === 'waiting-for-wifi') {
      setState({ phase: 'error', message: 'Menunggu Wi-Fi untuk unduh peta.' });
    } else {
      setState({ phase: 'error', message: result.reason });
    }
  } finally {
    clearInterval(progressTimer);
    inFlight = false;
    startMapUpdatePolling(); // lanjutkan polling setelah selesai
  }
}

/** Mulai polling periodik. Aman dipanggil ulang (idempotent). */
export function startMapUpdatePolling(): void {
  if (pollTimer) return;
  const tick = async () => {
    // Jangan cek saat unduhan berjalan: cek memakai jaringan yang sama dan statusnya
    // akan menimpa 'downloading', sehingga UI terlihat "kembali ke atas" di tengah unduh.
    if (!inFlight) await checkMapUpdateOnce();
    pollTimer = setTimeout(tick, MAP_POLL_INTERVAL_MS);
  };
  void tick();
}

export function stopMapUpdatePolling(): void {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

export type { ContentUpdateStatus };

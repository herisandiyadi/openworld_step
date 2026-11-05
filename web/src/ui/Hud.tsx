import { useState } from 'react';
import { BigMap } from './BigMap';
import { ChatPanel } from './ChatPanel';
import { currentMode } from '../net/netRuntime';
import { useNetStore } from '../net/netStore';
import { Joystick } from './Joystick';
import { Minimap } from './Minimap';
import { ActionButtons } from './ActionButtons';
import { NpcChat } from './NpcChat';
import { BusMenu } from './BusMenu';
import { leaveBus } from '../game/actions';
import { busDestinations } from '../game/busRoutes';
import { AudioControls } from './AudioControls';
import { type MoveMode, type Quality, useGameStore } from '../state/gameStore';
import { useResidentChats } from '../state/saveGame';
import { DISTRICT_NAMES } from '../world/worldSpec';
import { worldState } from '../world/worldState';
import { useGraphicsSettings } from '../state/graphicsSettings';
import { isDebugOverlayVisible } from '../polish/debugOverlay';
import { useDisplayPreferences } from './useDisplayPreferences';
import { useContentProgress } from '../state/contentProgress';
import { ContentOverlays } from './ContentOverlays';
import { QuestTracker } from './QuestTracker';
import { bagCapacityFor } from '../game/economyActions';
import { openNearbyBag } from '../game/economyActions';
import { bagSlotsUsed } from '../economy/bag';
import type { QuestTrackerEntry } from './QuestTracker';
import { questDefinitions } from '../game/questRuntime';

/** Renderer stats are for developers only; production needs ?debug-overlay. */
const SHOW_DEBUG_OVERLAY =
  typeof window !== 'undefined' && isDebugOverlayVisible({ dev: import.meta.env.DEV, search: window.location.search });

const MODE_LABELS: Record<MoveMode, string> = {
  walk: 'Jalan kaki',
  skate: 'Skateboard',
  bike: 'Sepeda',
  moto: 'Motor',
  car: 'Mobil',
};

const QUALITIES: { id: Quality; label: string }[] = [
  { id: 'low', label: 'Rendah' },
  { id: 'medium', label: 'Sedang' },
  { id: 'high', label: 'Tinggi' },
];

const PHASE_TEXT: Record<string, string> = {
  menunggu: 'Bus menuju haltemu...',
  naik: 'Silakan masuk, pintu terbuka',
  jalan: 'Bus berjalan',
  turun: 'Sampai tujuan, silakan turun',
  selesai: 'Sampai tujuan',
  gagal: 'Bus mengambil jalan pintas',
};

/** Nama area halte (label menu fast travel), supaya HUD menyebut tempat, bukan id teknis. */
function stopLabel(stopId: string): string {
  const stops = worldState.index?.busStops ?? [];
  return busDestinations(stops, null).find((destination) => destination.stop.id === stopId)?.label ?? 'halte berikutnya';
}

/**
 * Indikator perjalanan bus + tombol Turun. Tombolnya selalu aktif supaya pemain tidak pernah
 * terkunci di dalam bus, termasuk kalau rutenya bermasalah.
 */
function BusRidePanel() {
  const ride = useGameStore((state) => state.busRide);
  if (!ride) return null;
  const minutes = Math.floor(ride.eta / 60);
  const seconds = ride.eta % 60;

  return (
    <div className="bus-ride-panel" role="status" aria-live="polite">
      <div className="bus-ride-line">
        <strong>{PHASE_TEXT[ride.phase] ?? 'Naik bus'}</strong>
      </div>
      <div className="bus-ride-line">
        Berikutnya: {stopLabel(ride.nextStopId)} · tujuan {stopLabel(ride.destinationId)}
      </div>
      <div className="bus-ride-bar" aria-hidden="true">
        <div className="bus-ride-fill" style={{ width: `${Math.round(ride.progress * 100)}%` }} />
      </div>
      <div className="bus-ride-line">
        Sisa waktu ± {minutes > 0 ? `${minutes} mnt ` : ''}
        {seconds} dtk
      </div>
      <button type="button" className="bus-ride-exit" onClick={leaveBus}>
        Turun di sini
      </button>
    </div>
  );
}

export function Hud() {
  useDisplayPreferences();
  const setGraphics = useGraphicsSettings((state) => state.update);
  const mode = useGameStore((state) => state.mode);
  const [chatOpen, setChatOpen] = useState(false);
  const [jobBoardOpen, setJobBoardOpen] = useState(false);
  // Lencana hanya menghitung kanal yang belum dibuka pemain.
  const unread = useNetStore((state) => state.unread.session + state.unread.nearby);
  const inSession = currentMode() !== null;
  const chatNpcId = useGameStore((state) => state.chatNpcId);
  const busMenuOpen = useGameStore((state) => state.busMenuOpen);
  const busRide = useGameStore((state) => state.busRide !== null);
  const metCount = useGameStore((state) => state.met.length);
  const talkedCount = useResidentChats((state) => state.talked.length);
  const clock = useGameStore((state) => state.clock);
  const npcTotal = worldState.index?.npcs.length ?? 0;
  const setScreen = useGameStore((state) => state.setScreen);
  const paused = useGameStore((state) => state.paused);
  const setPaused = useGameStore((state) => state.setPaused);
  const mapOpen = useGameStore((state) => state.mapOpen);
  const quality = useGameStore((state) => state.quality);
  const stats = useGameStore((state) => state.stats);
  const stream = useGameStore((state) => state.stream);
  const district = useGameStore((state) => state.district);
  const soakActive = useGameStore((state) => state.soakActive);
  const soakResult = useGameStore((state) => state.soakResult);
  const setSoakActive = useGameStore((state) => state.setSoakActive);
  const setSoakResult = useGameStore((state) => state.setSoakResult);
  const coins = useContentProgress((state) => state.coins);
  const bag = useContentProgress((state) => state.bag);
  const quests = useContentProgress((state) => state.quests);
  const questTracker: QuestTrackerEntry[] = quests.map((quest) => ({
    id: quest.questId,
    title: questDefinitions().find((d) => d.id === quest.questId)?.title ?? quest.questId,
    stepText: questDefinitions().find((d) => d.id === quest.questId)?.steps[quest.step]?.text,
    status: quest.status === 'completed' ? 'completed' : 'active',
  }));
  const bagUsed = bagSlotsUsed(bag.capacity === bagCapacityFor() ? bag : { ...bag, capacity: bagCapacityFor() });

  return (
    <div className="hud">
      <div className="hud-top-left">
        <Minimap />
        <div className="status-panel">
          <div className="hud-currency-row">
            <span className="hud-currency" aria-label={`${coins} koin`}>🪙 {coins}</span>
            <button type="button" className="hud-bag-button" aria-label={`Buka tas, ${bagUsed} dari ${bagCapacityFor()} slot`} onClick={openNearbyBag}>
              🎒 {bagUsed}/{bagCapacityFor()}
            </button>
          </div>
          <div className="stamina" aria-label="Stamina">
            <div className="stamina-fill" style={{ width: '100%' }} />
          </div>
          <div className="quest-line">{district ? DISTRICT_NAMES[district] : 'Jelajahi kota'}</div>
          <div className="quest-line mode-line">
            {/* Saat naik bus pemain tidak jalan kaki; labelnya harus ikut berubah. */}
            {busRide ? 'Naik bus' : MODE_LABELS[mode]} · {clock}
          </div>
          <div className="quest-line quest-progress">
            {npcTotal > 0 && metCount >= npcTotal
              ? 'Quest selesai: semua warga sudah kamu kenal'
              : `Quest: kenalan dengan warga (${metCount}/${npcTotal})`}
          </div>
          <div className="quest-line">Warga diajak ngobrol: {talkedCount}</div>
        </div>
      </div>

      <div className="hud-top-right">
        {SHOW_DEBUG_OVERLAY && (
          <div className="stats" aria-live="off">
            {stats.fps} FPS · {stats.calls} dc · {(stats.triangles / 1000).toFixed(1)}k tri · {stream.chunks} ch
          </div>
        )}
        {/* Tombol chat hanya muncul dalam sesi multiplayer; single-player tidak berubah. */}
        {inSession && (
          <button
            type="button"
            className="hud-button chat-hud-button"
            aria-label={unread > 0 ? `Chat, ${unread} pesan baru` : 'Chat'}
            onClick={() => setChatOpen((open) => !open)}
          >
            💬
            {unread > 0 && !chatOpen && <span className="chat-unread-badge">{unread > 9 ? '9+' : unread}</span>}
          </button>
        )}
        <button type="button" className="hud-button" aria-label="Buka papan pekerjaan" onClick={() => setJobBoardOpen(true)}>
          📋
        </button>
        <button type="button" className="hud-button" aria-label="Jeda" onClick={() => setPaused(true)}>
          II
        </button>
      </div>

      {/* Joystick dan tombol lompat tidak ada gunanya saat duduk di dalam bus. */}
      {!busRide && <Joystick />}

      <ActionButtons />

      <ContentOverlays jobBoardOpen={jobBoardOpen} onCloseJobBoard={() => setJobBoardOpen(false)} />

      {mapOpen && <BigMap />}
      {chatNpcId && <NpcChat key={chatNpcId} />}
      {busMenuOpen && <BusMenu />}
      {chatOpen && inSession && <ChatPanel onClose={() => setChatOpen(false)} />}
      <BusRidePanel />

      {soakResult && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="Hasil uji performa">
          <div className="pause-panel">
            <h2>Hasil uji performa</h2>
            <pre className="soak-result">{soakResult}</pre>
            <button type="button" className="overlay-button" onClick={() => setSoakResult(null)} autoFocus>
              Tutup
            </button>
          </div>
        </div>
      )}

      {paused && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="Menu jeda">
          <div className="pause-panel">
            <h2>Jeda</h2>
            <div className="quality-row" role="group" aria-label="Kualitas grafis">
              {QUALITIES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`mode-button${quality === item.id ? ' active' : ''}`}
                  aria-pressed={quality === item.id}
                  onClick={() => setGraphics({ quality: item.id })}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <AudioControls />
            <QuestTracker quests={questTracker} />
            <button
              type="button"
              className="overlay-button secondary"
              onClick={() => {
                setPaused(false);
                setJobBoardOpen(true);
              }}
            >
              Papan pekerjaan
            </button>
            <button type="button" className="overlay-button" onClick={() => setPaused(false)} autoFocus>
              Lanjutkan
            </button>
            <button
              type="button"
              className="overlay-button secondary"
              disabled={soakActive}
              onClick={() => {
                setSoakResult(null);
                setSoakActive(true);
                setPaused(false);
              }}
            >
              {soakActive ? 'Uji performa berjalan...' : 'Uji performa (keliling peta ~3 menit)'}
            </button>
            <button
              type="button"
              className="overlay-button secondary"
              onClick={() => {
                setPaused(false);
                setScreen('title');
              }}
            >
              Menu utama
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
import { useEffect, useRef, useState } from 'react';
import { useAiSettings } from '../state/aiSettings';
import { useGameStore } from '../state/gameStore';
import { applySave, deleteSave, loadSave, resetGame, type SaveData } from '../state/saveGame';
import { usePlayerProfile } from '../state/profile';
import { contentRuntime } from '../app/contentRuntime';
import { initQuests } from '../game/questRuntime';
import {
  getMapUpdateState,
  startMapUpdatePolling,
  stageMapUpdate,
  subscribeMapUpdate,
  type MapUpdateState,
} from '../app/mapUpdates';

/** First screen after launch: start (or continue) the game, or open the AI settings. */
export function TitleScreen() {
  const setScreen = useGameStore((state) => state.setScreen);
  const settings = useAiSettings((state) => state.settings);
  const loaded = useAiSettings((state) => state.loaded);
  const username = usePlayerProfile((state) => state.profile?.username ?? '');
  const startRef = useRef<HTMLButtonElement>(null);
  const [save, setSave] = useState<SaveData | null | undefined>(undefined);
  const [mapState, setMapState] = useState<MapUpdateState>(getMapUpdateState());

  useEffect(() => {
    const unsubscribe = subscribeMapUpdate(setMapState);
    startMapUpdatePolling();
    return unsubscribe;
  }, []);

  useEffect(() => {
    let active = true;
    void loadSave().then((data) => active && setSave(data));
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => startRef.current?.focus(), [save]);

  const start = (fresh: boolean) => {
    if (fresh || !save) {
      resetGame();
      void deleteSave();
    } else {
      applySave(save);
      // Refresh quest availability from the loaded content pack (quests may unlock via requires chains).
      if (contentRuntime.registry) initQuests(contentRuntime.registry);
    }
    setScreen('game');
  };

  const aiStatus = !loaded ? 'Memuat pengaturan...' : settings.apiKey ? `AI: ${settings.model}` : 'AI belum diatur (API key kosong)';

  return (
    <main className="menu-screen" aria-labelledby="title-heading">
      <div className="menu-panel">
        <h1 id="title-heading" className="menu-title">
          Openworld City
        </h1>
        <p className="menu-subtitle">Halo, {username}! Jelajahi kota, ngobrol dengan warga.</p>
        <div className="menu-buttons">
          <button ref={startRef} type="button" className="overlay-button menu-button" disabled={save === undefined} onClick={() => start(false)}>
            {save ? 'Lanjutkan' : 'Mulai'}
          </button>
          {save && (
            <button type="button" className="overlay-button secondary menu-button" onClick={() => start(true)}>
              Main baru
            </button>
          )}
          <button type="button" className="overlay-button secondary menu-button" onClick={() => setScreen('multiplayer')}>
            Main bersama
          </button>
          <button type="button" className="overlay-button secondary menu-button" onClick={() => setScreen('settings')}>
            Pengaturan
          </button>
          <button type="button" className="overlay-button secondary menu-button" onClick={() => setScreen('profile')}>
            Ganti nama
          </button>
        </div>
        <p className="menu-status" aria-live="polite">
          {aiStatus}
        </p>
        {mapState.phase === 'available' && (
          <div className="menu-status" style={{ color: '#4a9eff' }} aria-live="polite">
            Peta baru tersedia: {mapState.manifestVersion}
            <button
              type="button"
              className="overlay-button secondary menu-button"
              onClick={() => void stageMapUpdate()}
            >
              Unduh peta
            </button>
          </div>
        )}
        {(mapState.phase === 'checking' || mapState.phase === 'downloading') && (
          <div className="menu-status" aria-live="polite" style={{ color: '#4a9eff', width: 'min(320px, 80vw)' }}>
            {mapState.phase === 'checking' ? (
              <p style={{ margin: '0 0 0.4rem 0' }}>Memeriksa peta...</p>
            ) : (
              <>
                <p style={{ margin: '0 0 0.4rem 0' }}>
                  {mapState.total
                    ? `Mengunduh peta... ${mapState.completed ?? 0} / ${mapState.total} file`
                    : 'Mengunduh peta...'}
                </p>
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={
                    mapState.total ? Math.round(((mapState.completed ?? 0) / mapState.total) * 100) : undefined
                  }
                  style={{ height: '8px', background: '#1e293b', borderRadius: '999px', overflow: 'hidden' }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: mapState.total
                        ? `${Math.min(100, ((mapState.completed ?? 0) / mapState.total) * 100)}%`
                        : '12%',
                      background: '#4a9eff',
                      borderRadius: '999px',
                      transition: 'width 200ms linear',
                    }}
                  />
                </div>
                {mapState.bytes !== undefined && (
                  <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>
                    {((mapState.bytes ?? 0) / 1024 / 1024).toFixed(1)} MB terunduh
                  </p>
                )}
              </>
            )}
          </div>
        )}
        {mapState.phase === 'up-to-date' && (
          <div className="menu-status" style={{ color: '#94a3b8' }} aria-live="polite">
            Peta sudah terbaru.
            <button
              type="button"
              className="overlay-button secondary menu-button"
              onClick={() => void stageMapUpdate()}
            >
              Unduh ulang peta
            </button>
          </div>
        )}
        {mapState.phase === 'staged' && (
          <p className="menu-status" aria-live="polite" style={{ color: '#4ade80' }}>
            Peta {((mapState.downloadSize ?? 0) / 1024 / 1024).toFixed(1)} MB siap dipakai pada peluncuran berikutnya.
          </p>
        )}
        {mapState.phase === 'error' && (
          <p className="menu-status" aria-live="polite" style={{ color: '#f87171' }}>
            Cek peta gagal: {mapState.message}
          </p>
        )}
      </div>
    </main>
  );
}
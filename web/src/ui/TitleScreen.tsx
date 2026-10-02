import { useEffect, useRef, useState } from 'react';
import { useAiSettings } from '../state/aiSettings';
import { useGameStore } from '../state/gameStore';
import { applySave, deleteSave, loadSave, resetGame, type SaveData } from '../state/saveGame';
import { usePlayerProfile } from '../state/profile';

/** First screen after launch: start (or continue) the game, or open the AI settings. */
export function TitleScreen() {
  const setScreen = useGameStore((state) => state.setScreen);
  const settings = useAiSettings((state) => state.settings);
  const loaded = useAiSettings((state) => state.loaded);
  const username = usePlayerProfile((state) => state.profile?.username ?? '');
  const startRef = useRef<HTMLButtonElement>(null);
  const [save, setSave] = useState<SaveData | null | undefined>(undefined);

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
      </div>
    </main>
  );
}
import { useEffect } from 'react';
import { writeSave } from '../state/saveGame';
import { useGameStore } from '../state/gameStore';

const AUTOSAVE_MS = 15000;

/** Saves every 15 s, on quest progress, when the app goes to the background, and when leaving the game. */
export function AutoSave() {
  useEffect(() => {
    const save = () => {
      if (useGameStore.getState().soakActive) return;
      writeSave().catch((error: unknown) => console.error('[save]', error));
    };
    const timer = window.setInterval(save, AUTOSAVE_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') save();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const unsubscribe = useGameStore.subscribe((state, previous) => {
      if (state.met.length !== previous.met.length || state.riding !== previous.riding) save();
    });
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      unsubscribe();
      save();
    };
  }, []);
  return null;
}
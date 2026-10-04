import { useEffect } from 'react';
import { useGameStore } from '../state/gameStore';
import { resumeRendererState, useGraphicsSettings } from '../state/graphicsSettings';

/**
 * Applies saved display preferences to the document and renderer quality.
 * Re-applies them when the app returns from background so quality/brightness
 * survive pause, tab switches, and Android app resume.
 */
export function useDisplayPreferences(): void {
  const settings = useGraphicsSettings((state) => state.settings);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--game-brightness', String(settings.brightness));
    root.classList.toggle('reduced-motion', settings.reducedMotion);
    const store = useGameStore.getState();
    if (store.quality !== settings.quality) store.setQuality(settings.quality);
  }, [settings]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const store = useGameStore.getState();
      const resumed = resumeRendererState(useGraphicsSettings.getState().settings, { quality: store.quality });
      if (store.quality !== resumed.quality) store.setQuality(resumed.quality);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
    };
  }, []);
}

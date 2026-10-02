import { audio } from './audioEngine';
import { useAudioSettings } from '../state/audioSettings';

let installed = false;

/**
 * App-wide audio hooks: unlock on the first gesture, a click sound for every UI button (the
 * in-game action buttons play their own sounds), background suspend, and saved volumes.
 */
export function installAudio(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const unlock = () => audio.unlock();
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest('button');
      if (button && !button.classList.contains('action-button')) audio.click();
    },
    true,
  );
  document.addEventListener('visibilitychange', () => audio.onVisibility());
  audio.setVolumes(useAudioSettings.getState().settings);
  useAudioSettings.subscribe((state) => audio.setVolumes(state.settings));
  void useAudioSettings.getState().load();
}
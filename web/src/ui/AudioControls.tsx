import { useId } from 'react';
import { useAudioSettings } from '../state/audioSettings';

/** Music / SFX volume sliders and a mute toggle (pause menu and Settings screen). */
export function AudioControls() {
  const settings = useAudioSettings((state) => state.settings);
  const update = useAudioSettings((state) => state.update);
  const musicId = useId();
  const sfxId = useId();
  const music = Math.round(settings.music * 100);
  const sfx = Math.round(settings.sfx * 100);

  return (
    <div className="audio-controls">
      <label className="audio-row" htmlFor={musicId}>
        <span>Musik</span>
        <input
          id={musicId}
          type="range"
          min={0}
          max={100}
          step={5}
          value={music}
          aria-valuetext={`${music}%`}
          onChange={(event) => update({ music: Number(event.target.value) / 100 })}
        />
        <output htmlFor={musicId}>{music}%</output>
      </label>
      <label className="audio-row" htmlFor={sfxId}>
        <span>Efek suara</span>
        <input
          id={sfxId}
          type="range"
          min={0}
          max={100}
          step={5}
          value={sfx}
          aria-valuetext={`${sfx}%`}
          onChange={(event) => update({ sfx: Number(event.target.value) / 100 })}
        />
        <output htmlFor={sfxId}>{sfx}%</output>
      </label>
      <button
        type="button"
        className={`mode-button audio-mute${settings.muted ? ' active' : ''}`}
        aria-pressed={settings.muted}
        onClick={() => update({ muted: !settings.muted })}
      >
        {settings.muted ? 'Suara: mati' : 'Suara: nyala'}
      </button>
    </div>
  );
}
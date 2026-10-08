import { type FormEvent, useEffect, useId, useState } from 'react';
import {
  type AiSettings,
  type ConnectionResult,
  DEFAULT_AI_SETTINGS,
  testConnection,
  useAiSettings,
  validateSettings,
} from '../state/aiSettings';
import { useGameStore } from '../state/gameStore';
import { BRIGHTNESS_RANGE, DENSITY_LABELS, DENSITY_PRESETS, QUALITY_LABELS, QUALITY_PRESETS, useGraphicsSettings } from '../state/graphicsSettings';
import { ContentUpdatePanel } from './ContentUpdatePanel';
import { AudioControls } from './AudioControls';
import {
  activeContentManifest,
  checkAndStageContentUpdate,
  contentUpdatesRuntime,
  getAllowCellularDownloads,
  rollbackContentToBundled,
  setAllowCellularDownloads,
  subscribeToContentUpdateStatus,
} from '../app/contentUpdatesRuntime';

/** AI endpoint settings (base URL, API key, model), saved on the device with Capacitor Preferences. */
export function SettingsScreen() {
  const setScreen = useGameStore((state) => state.setScreen);
  const controls = useGameStore((state) => state.controls);
  const setControls = useGameStore((state) => state.setControls);
  const density = useGraphicsSettings((state) => state.settings.density);
  const quality = useGraphicsSettings((state) => state.settings.quality);
  const brightness = useGraphicsSettings((state) => state.settings.brightness);
  const reducedMotion = useGraphicsSettings((state) => state.settings.reducedMotion);
  const setGraphics = useGraphicsSettings((state) => state.update);
  const stored = useAiSettings((state) => state.settings);
  const save = useAiSettings((state) => state.save);
  const [form, setForm] = useState<AiSettings>(stored);
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [contentVersion, setContentVersion] = useState('...');
  const [allowCellular, setAllowCellular] = useState(false);
  const [updateStatus, setUpdateStatus] = useState(contentUpdatesRuntime.status);
  const ids = { url: useId(), key: useId(), model: useId(), status: useId(), brightness: useId() };

  useEffect(() => setForm(stored), [stored]);
  useEffect(() => {
    void activeContentManifest().then((manifest) => setContentVersion(manifest.version)).catch(() => setContentVersion('unknown'));
    void getAllowCellularDownloads().then(setAllowCellular).catch(() => undefined);
    return subscribeToContentUpdateStatus(setUpdateStatus);
  }, []);

  const update = (field: keyof AiSettings) => (event: { target: { value: string } }) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setError(null);
    setStatus(null);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const invalid = validateSettings(form);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    try {
      await save(form);
      setScreen('title');
    } catch (saveError) {
      setError(`Gagal menyimpan: ${saveError instanceof Error ? saveError.message : String(saveError)}`);
    } finally {
      setBusy(false);
    }
  };

  const onTest = async () => {
    setBusy(true);
    setStatus({ ok: true, message: 'Menguji koneksi...' });
    setStatus(await testConnection(form));
    setBusy(false);
  };

  return (
    <main className="menu-screen" aria-labelledby="settings-heading">
      <form className="menu-panel settings-panel" onSubmit={onSubmit} noValidate>
        <h1 id="settings-heading" className="menu-heading">
          Pengaturan AI
        </h1>

        <label className="field" htmlFor={ids.url}>
          <span>Base URL</span>
          <input
            id={ids.url}
            type="url"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="https://contoh.com/v1"
            value={form.baseUrl}
            onChange={update('baseUrl')}
            required
          />
        </label>

        <label className="field" htmlFor={ids.key}>
          <span>API key</span>
          <div className="field-row">
            <input
              id={ids.key}
              type={showKey ? 'text' : 'password'}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="sk-..."
              value={form.apiKey}
              onChange={update('apiKey')}
            />
            <button
              type="button"
              className="overlay-button secondary field-toggle"
              aria-pressed={showKey}
              aria-controls={ids.key}
              onClick={() => setShowKey((value) => !value)}
            >
              {showKey ? 'Sembunyikan' : 'Tampilkan'}
            </button>
          </div>
        </label>

        <label className="field" htmlFor={ids.model}>
          <span>Model</span>
          <input
            id={ids.model}
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={DEFAULT_AI_SETTINGS.model}
            value={form.model}
            onChange={update('model')}
            required
          />
        </label>

        <fieldset className="audio-fieldset">
          <legend>Audio</legend>
          <AudioControls />
        </fieldset>

        <fieldset className="audio-fieldset">
          <legend>Kontrol</legend>
          <label className="audio-row">
            <span>Ketuk untuk berjalan</span>
            <input
              type="checkbox"
              checked={controls.tapToMove}
              onChange={(event) => setControls({ tapToMove: event.target.checked })}
            />
          </label>
          <label className="audio-row">
            <span>Minimap ikut arah kamera</span>
            <input
              type="checkbox"
              checked={controls.minimapRotate}
              onChange={(event) => setControls({ minimapRotate: event.target.checked })}
            />
          </label>
        </fieldset>

        <fieldset className="audio-fieldset visual-options">
          <legend>Tampilan</legend>
          <div className="appearance-options">
            {QUALITY_PRESETS.map((preset) => (
              <label key={preset} className={`appearance-option${quality === preset ? ' selected' : ''}`}>
                <input type="radio" name="quality" value={preset} checked={quality === preset} onChange={() => setGraphics({ quality: preset })} />
                <span>{QUALITY_LABELS[preset]}</span>
              </label>
            ))}
          </div>
          <label className="range-field" htmlFor={ids.brightness}>
            <span>Kecerahan</span>
            <input
              id={ids.brightness}
              type="range"
              min={BRIGHTNESS_RANGE.min}
              max={BRIGHTNESS_RANGE.max}
              step="0.05"
              value={brightness}
              aria-valuetext={`${Math.round(brightness * 100)}%`}
              onChange={(event) => setGraphics({ brightness: Number(event.target.value) })}
            />
            <output htmlFor={ids.brightness}>{Math.round(brightness * 100)}%</output>
          </label>
          <label className="audio-row">
            <span>Kurangi gerakan kamera dan efek</span>
            <input type="checkbox" checked={reducedMotion} onChange={(event) => setGraphics({ reducedMotion: event.target.checked })} />
          </label>
        </fieldset>

        <fieldset className="audio-fieldset">
          <legend>Keramaian kota</legend>
          {/* Radio native di dalam fieldset: Tab lalu panah, fokus terlihat, label >= 48 px (.appearance-option). */}
          <div className="appearance-options">
            {DENSITY_PRESETS.map((preset) => (
              <label key={preset} className={`appearance-option${density === preset ? ' selected' : ''}`}>
                <input
                  type="radio"
                  name="density"
                  value={preset}
                  checked={density === preset}
                  onChange={() => setGraphics({ density: preset })}
                />
                <span>{DENSITY_LABELS[preset]}</span>
              </label>
            ))}
          </div>
          <p className="appearance-label">Makin ramai, makin banyak kendaraan dan pejalan kaki (butuh HP lebih kuat).</p>
        </fieldset>

        <fieldset className="audio-fieldset">
          <legend>Pembaruan Konten</legend>
          <ContentUpdatePanel
            activeVersion={contentVersion}
            status={updateStatus}
            allowCellular={allowCellular}
            onCheck={async () => { await checkAndStageContentUpdate(); }}
            onRollback={async () => { await rollbackContentToBundled(); }}
            onToggleCellular={() => {
              const next = !allowCellular;
              setAllowCellular(next);
              void setAllowCellularDownloads(next);
            }}
          />
        </fieldset>

        <p id={ids.status} className={`settings-status${error || (status && !status.ok) ? ' error' : ''}`} role="status" aria-live="polite">
          {error ?? status?.message ?? 'API key disimpan hanya di perangkat ini.'}
        </p>

        <div className="menu-buttons settings-buttons">
          <button type="button" className="overlay-button secondary" onClick={onTest} disabled={busy}>
            Tes koneksi
          </button>
          <button type="button" className="overlay-button secondary" onClick={() => setScreen('title')} disabled={busy}>
            Batal
          </button>
          <button type="submit" className="overlay-button" disabled={busy}>
            Simpan
          </button>
        </div>
      </form>
    </main>
  );
}
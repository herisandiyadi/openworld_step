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

/** AI endpoint settings (base URL, API key, model), saved on the device with Capacitor Preferences. */
export function SettingsScreen() {
  const setScreen = useGameStore((state) => state.setScreen);
  const stored = useAiSettings((state) => state.settings);
  const save = useAiSettings((state) => state.save);
  const [form, setForm] = useState<AiSettings>(stored);
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = { url: useId(), key: useId(), model: useId(), status: useId() };

  useEffect(() => setForm(stored), [stored]);

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
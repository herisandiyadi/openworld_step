import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { USERNAME_MAX, usePlayerProfile, validateUsername } from '../state/profile';
import { useGameStore } from '../state/gameStore';

/** Username form: shown once after install (firstRun) and from the title screen to rename. */
export function ProfileScreen({ firstRun = false }: { firstRun?: boolean }) {
  const profile = usePlayerProfile((state) => state.profile);
  const loadError = usePlayerProfile((state) => state.error);
  const save = usePlayerProfile((state) => state.save);
  const setScreen = useGameStore((state) => state.setScreen);
  const [name, setName] = useState(profile?.username ?? '');
  const [error, setError] = useState<string | null>(loadError);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const hintId = useId();

  useEffect(() => inputRef.current?.focus(), []);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const invalid = validateUsername(name);
    if (invalid) {
      setError(invalid);
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      await save(name);
      setScreen('title');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="menu-screen" aria-labelledby="profile-heading">
      <form className="menu-panel" onSubmit={onSubmit} noValidate>
        <h1 id="profile-heading" className={firstRun ? 'menu-title' : 'menu-heading'}>
          {firstRun ? 'Selamat datang' : 'Ganti nama'}
        </h1>
        {firstRun && <p className="menu-subtitle">Siapa namamu? Warga kota akan memanggilmu dengan nama ini.</p>}

        <label className="field" htmlFor={inputId}>
          <span>Username</span>
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            autoComplete="nickname"
            autoCapitalize="words"
            spellCheck={false}
            maxLength={USERNAME_MAX + 10}
            placeholder="Contoh: Andi"
            value={name}
            aria-invalid={error !== null}
            aria-describedby={hintId}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
            required
          />
        </label>

        <p id={hintId} className={`settings-status${error ? ' error' : ''}`} role="status" aria-live="polite">
          {error ?? `2-${USERNAME_MAX} karakter. Disimpan di database perangkat ini.`}
        </p>

        <div className="menu-buttons settings-buttons">
          {!firstRun && (
            <button type="button" className="overlay-button secondary" onClick={() => setScreen('title')} disabled={busy}>
              Batal
            </button>
          )}
          <button type="submit" className="overlay-button" disabled={busy}>
            {firstRun ? 'Lanjut' : 'Simpan'}
          </button>
        </div>
      </form>
    </main>
  );
}
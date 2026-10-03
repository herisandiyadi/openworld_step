import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { type Appearance, DEFAULT_APPEARANCE, USERNAME_MAX, usePlayerProfile, validateUsername } from '../state/profile';
import { AppearancePicker, randomAppearance } from './AppearancePicker';
import { CharacterPreview } from './CharacterPreview';
import { useGameStore } from '../state/gameStore';

/**
 * Username + penampilan dalam satu layar: muncul sekali setelah instal (firstRun) dan dari layar
 * judul untuk mengubah. Pemain lama (profil v1) melihat layar ini dengan username sudah terisi dan
 * penampilan default.
 */
export function ProfileScreen({ firstRun = false }: { firstRun?: boolean }) {
  const profile = usePlayerProfile((state) => state.profile);
  const loadError = usePlayerProfile((state) => state.error);
  const save = usePlayerProfile((state) => state.save);
  const setScreen = useGameStore((state) => state.setScreen);
  const [name, setName] = useState(profile?.username ?? '');
  const [look, setLook] = useState<Appearance>(profile?.appearance ?? DEFAULT_APPEARANCE);
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
      await save(name, look);
      setScreen('title');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="menu-screen" aria-labelledby="profile-heading">
      <form className="menu-panel profile-panel" onSubmit={onSubmit} noValidate>
        <h1 id="profile-heading" className={firstRun ? 'menu-title' : 'menu-heading'}>
          {firstRun ? 'Selamat datang' : 'Profil'}
        </h1>
        {firstRun && <p className="menu-subtitle">Siapa namamu? Warga kota akan memanggilmu dengan nama ini.</p>}
        <CharacterPreview appearance={look} />

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

        <AppearancePicker value={look} onChange={setLook} />

        <div className="menu-buttons settings-buttons">
          <button type="button" className="overlay-button secondary" onClick={() => setLook(randomAppearance())} disabled={busy}>
            Acak
          </button>
          {!firstRun && (
            <button type="button" className="overlay-button secondary" onClick={() => setScreen('title')} disabled={busy}>
              Batal
            </button>
          )}
          <button type="submit" className="overlay-button" disabled={busy}>
            Simpan
          </button>
        </div>
      </form>
    </main>
  );
}
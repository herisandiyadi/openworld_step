import { useEffect, useState } from 'react';
import { useProgress } from '@react-three/drei';
import { useGameStore } from '../state/gameStore';

/** Initial loading screen only (GLBs + the chunks around the spawn); later streaming never blocks the UI. */
export function LoadingScreen() {
  const { active, progress } = useProgress();
  const worldReady = useGameStore((state) => state.worldReady);
  const chunks = useGameStore((state) => state.stream.chunks);
  const [done, setDone] = useState(false);
  const assetsDone = !active && progress >= 100;

  useEffect(() => {
    if (assetsDone && worldReady) setDone(true);
  }, [assetsDone, worldReady]);

  if (done) return null;
  const percent = Math.round(assetsDone ? 100 : progress);
  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <div className="loading-title">Openworld City</div>
      <div className="loading-bar" aria-hidden="true">
        <div className="loading-fill" style={{ width: `${assetsDone ? 100 : percent}%` }} />
      </div>
      <div>{assetsDone ? `Menyiapkan kota (${chunks} chunk)` : `Memuat aset ${percent}%`}</div>
    </div>
  );
}
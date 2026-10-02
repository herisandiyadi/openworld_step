import { BigMap } from './BigMap';
import { Joystick } from './Joystick';
import { Minimap } from './Minimap';
import { ActionButtons } from './ActionButtons';
import { NpcChat } from './NpcChat';
import { BusMenu } from './BusMenu';
import { type MoveMode, type Quality, useGameStore } from '../state/gameStore';
import { DISTRICT_NAMES } from '../world/worldSpec';
import { worldState } from '../world/worldState';

const MODE_LABELS: Record<MoveMode, string> = {
  walk: 'Jalan kaki',
  skate: 'Skateboard',
  bike: 'Sepeda',
  moto: 'Motor',
  car: 'Mobil',
};

const QUALITIES: { id: Quality; label: string }[] = [
  { id: 'low', label: 'Rendah' },
  { id: 'medium', label: 'Sedang' },
  { id: 'high', label: 'Tinggi' },
];

export function Hud() {
  const mode = useGameStore((state) => state.mode);
  const chatNpcId = useGameStore((state) => state.chatNpcId);
  const busMenuOpen = useGameStore((state) => state.busMenuOpen);
  const metCount = useGameStore((state) => state.met.length);
  const clock = useGameStore((state) => state.clock);
  const npcTotal = worldState.index?.npcs.length ?? 0;
  const setScreen = useGameStore((state) => state.setScreen);
  const paused = useGameStore((state) => state.paused);
  const setPaused = useGameStore((state) => state.setPaused);
  const mapOpen = useGameStore((state) => state.mapOpen);
  const quality = useGameStore((state) => state.quality);
  const setQuality = useGameStore((state) => state.setQuality);
  const stats = useGameStore((state) => state.stats);
  const stream = useGameStore((state) => state.stream);
  const district = useGameStore((state) => state.district);
  const soakActive = useGameStore((state) => state.soakActive);
  const soakResult = useGameStore((state) => state.soakResult);
  const setSoakActive = useGameStore((state) => state.setSoakActive);
  const setSoakResult = useGameStore((state) => state.setSoakResult);

  return (
    <div className="hud">
      <div className="hud-top-left">
        <Minimap />
        <div className="status-panel">
          <div className="stamina" aria-label="Stamina">
            <div className="stamina-fill" style={{ width: '100%' }} />
          </div>
          <div className="quest-line">{district ? DISTRICT_NAMES[district] : 'Jelajahi kota'}</div>
          <div className="quest-line mode-line">
            {MODE_LABELS[mode]} · {clock}
          </div>
          <div className="quest-line quest-progress">
            {npcTotal > 0 && metCount >= npcTotal
              ? 'Quest selesai: semua warga sudah kamu kenal'
              : `Quest: kenalan dengan warga (${metCount}/${npcTotal})`}
          </div>
        </div>
      </div>

      <div className="hud-top-right">
        <div className="stats" aria-live="off">
          {stats.fps} FPS · {stats.calls} dc · {(stats.triangles / 1000).toFixed(1)}k tri · {stream.chunks} ch
        </div>
        <button type="button" className="hud-button" aria-label="Jeda" onClick={() => setPaused(true)}>
          II
        </button>
      </div>

      <Joystick />

      <ActionButtons />

      {mapOpen && <BigMap />}
      {chatNpcId && <NpcChat key={chatNpcId} />}
      {busMenuOpen && <BusMenu />}

      {soakResult && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="Hasil uji performa">
          <div className="pause-panel">
            <h2>Hasil uji performa</h2>
            <pre className="soak-result">{soakResult}</pre>
            <button type="button" className="overlay-button" onClick={() => setSoakResult(null)} autoFocus>
              Tutup
            </button>
          </div>
        </div>
      )}

      {paused && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="Menu jeda">
          <div className="pause-panel">
            <h2>Jeda</h2>
            <div className="quality-row" role="group" aria-label="Kualitas grafis">
              {QUALITIES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`mode-button${quality === item.id ? ' active' : ''}`}
                  aria-pressed={quality === item.id}
                  onClick={() => setQuality(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <button type="button" className="overlay-button" onClick={() => setPaused(false)} autoFocus>
              Lanjutkan
            </button>
            <button
              type="button"
              className="overlay-button secondary"
              disabled={soakActive}
              onClick={() => {
                setSoakResult(null);
                setSoakActive(true);
                setPaused(false);
              }}
            >
              {soakActive ? 'Uji performa berjalan...' : 'Uji performa (keliling peta ~3 menit)'}
            </button>
            <button
              type="button"
              className="overlay-button secondary"
              onClick={() => {
                setPaused(false);
                setScreen('title');
              }}
            >
              Menu utama
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
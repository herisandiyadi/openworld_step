import { useEffect, useRef } from 'react';
import { playerState } from '../game/runtime';
import { useGameStore } from '../state/gameStore';
import { drawBusStop, drawFog, drawNpcDot, drawNpcLabel, drawPlayerArrow, drawRemoteDot, loadMapImage, worldToMap } from './mapRender';
import { exploredRatio } from '../game/exploration';
import { useNetStore } from '../net/netStore';
import { currentMode } from '../net/netRuntime';

/** Saat sesi multiplayer, pemain lain tetap bergerak walau peta terbuka: gambar ulang ~4 Hz. */
const REMOTE_REDRAW_MS = 250;

/** Full-screen city map opened by tapping the minimap. The game loop is paused while it is open. */
export function BigMap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const setMapOpen = useGameStore((state) => state.setMapOpen);
  const inSession = currentMode() !== null;

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    let cancelled = false;
    let frame = 0;
    let lastDraw = 0;

    loadMapImage()
      .then((map) => {
        if (cancelled) return;
        canvas.width = map.image.width;
        canvas.height = map.image.height;
        const marker = map.image.width * 0.012;
        const render = () => {
          context.drawImage(map.image, 0, 0);
          drawFog(context, 0, 0, map.ppm);
          for (const stop of map.busStops) drawBusStop(context, worldToMap(stop.x, map.ppm), worldToMap(stop.z, map.ppm), marker * 0.8);
          for (const npc of map.npcs) {
            const x = worldToMap(npc.x, map.ppm);
            const y = worldToMap(npc.z, map.ppm);
            drawNpcDot(context, x, y, marker);
            drawNpcLabel(context, npc.name, x + marker * 1.6, y, marker * 2.2);
          }
          // Titik biru pemain lain; dibaca langsung dari store (tanpa re-render React per snapshot).
          if (currentMode() !== null) {
            const remotes = useNetStore.getState().remotes;
            for (const id in remotes) {
              const position = remotes[id]?.position;
              if (position) drawRemoteDot(context, worldToMap(position.x, map.ppm), worldToMap(position.z, map.ppm), marker * 1.1);
            }
          }
          drawPlayerArrow(
            context,
            worldToMap(playerState.x, map.ppm),
            worldToMap(playerState.z, map.ppm),
            playerState.heading,
            marker * 1.8,
          );
        };
        render();
        // Single-player: cukup sekali seperti sebelumnya (dunia di-pause).
        if (currentMode() === null) return;
        const loop = (time: number) => {
          frame = requestAnimationFrame(loop);
          if (time - lastDraw < REMOTE_REDRAW_MS) return;
          lastDraw = time;
          render();
        };
        frame = requestAnimationFrame(loop);
      })
      .catch((error: unknown) => console.error('[map]', error));

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMapOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [setMapOpen]);

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Peta kota">
      <div className="map-panel">
        <canvas ref={canvasRef} className="big-map-canvas" />
        <div className="map-legend" aria-label="Keterangan peta">
          <span><i className="legend-dot npc" aria-hidden="true" /> NPC</span>
          <span><i className="legend-dot player" aria-hidden="true" /> Kamu</span>
          {inSession && (
            <span><i className="legend-dot player" aria-hidden="true" /> Pemain lain</span>
          )}
          <span><i className="legend-dot bus" aria-hidden="true" /> Halte bus</span>
          <span>Terjelajahi {Math.round(exploredRatio() * 100)}%</span>
        </div>
        <button type="button" className="overlay-button" onClick={() => setMapOpen(false)} autoFocus>
          Tutup peta
        </button>
      </div>
    </div>
  );
}
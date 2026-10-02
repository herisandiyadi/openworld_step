import { useEffect, useRef } from 'react';
import { playerState } from '../game/runtime';
import { useGameStore } from '../state/gameStore';
import { drawBusStop, drawFog, drawNpcDot, drawNpcLabel, drawPlayerArrow, loadMapImage, worldToMap } from './mapRender';
import { exploredRatio } from '../game/exploration';

/** Full-screen city map opened by tapping the minimap. The game loop is paused while it is open. */
export function BigMap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const setMapOpen = useGameStore((state) => state.setMapOpen);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    let cancelled = false;

    loadMapImage()
      .then((map) => {
        if (cancelled) return;
        canvas.width = map.image.width;
        canvas.height = map.image.height;
        context.drawImage(map.image, 0, 0);
        drawFog(context, 0, 0, map.ppm);
        const marker = map.image.width * 0.012;
        for (const stop of map.busStops) drawBusStop(context, worldToMap(stop.x, map.ppm), worldToMap(stop.z, map.ppm), marker * 0.8);
        for (const npc of map.npcs) {
          const x = worldToMap(npc.x, map.ppm);
          const y = worldToMap(npc.z, map.ppm);
          drawNpcDot(context, x, y, marker);
          drawNpcLabel(context, npc.name, x + marker * 1.6, y, marker * 2.2);
        }
        drawPlayerArrow(
          context,
          worldToMap(playerState.x, map.ppm),
          worldToMap(playerState.z, map.ppm),
          playerState.heading,
          marker * 1.8,
        );
      })
      .catch((error: unknown) => console.error('[map]', error));

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMapOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      cancelled = true;
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
import { useEffect, useRef } from 'react';
import { playerState } from '../game/runtime';
import { useGameStore } from '../state/gameStore';
import { drawFog, drawNpcDot, drawNpcEdgeMarker, drawPlayerArrow, loadMapImage } from './mapRender';
import { HALF_WORLD } from '../world/worldSpec';

const MINIMAP_CSS_SIZE = 132;
const VIEW_METERS = 90;
const REDRAW_INTERVAL_MS = 66;

/**
 * North-up minimap. The city map is baked offline to a PNG; each update (~15 Hz) only blits a
 * cropped window plus markers, so no extra WebGL render pass is needed.
 */
export function Minimap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const setMapOpen = useGameStore((state) => state.setMapOpen);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = MINIMAP_CSS_SIZE * dpr;
    canvas.height = MINIMAP_CSS_SIZE * dpr;
    let frame = 0;
    let lastDraw = 0;
    let cancelled = false;

    loadMapImage()
      .then((map) => {
        if (cancelled) return;
        const sourceSize = VIEW_METERS * map.ppm;
        const draw = (time: number) => {
          frame = requestAnimationFrame(draw);
          if (time - lastDraw < REDRAW_INTERVAL_MS) return;
          lastDraw = time;

          const size = canvas.width;
          const scale = size / VIEW_METERS;
          context.fillStyle = '#6f8f5f';
          context.fillRect(0, 0, size, size);
          const sourceX = (playerState.x + map.image.width / map.ppm / 2) * map.ppm - sourceSize / 2;
          const sourceY = (playerState.z + map.image.height / map.ppm / 2) * map.ppm - sourceSize / 2;
          context.drawImage(map.image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);
          drawFog(context, size / 2 - (playerState.x + HALF_WORLD) * scale, size / 2 - (playerState.z + HALF_WORLD) * scale, scale);
          // The minimap is round: NPCs beyond its radius are pinned to the rim as direction chevrons.
          const rim = size / 2 - 9 * dpr;
          for (const npc of map.npcs) {
            const offsetX = (npc.x - playerState.x) * scale;
            const offsetY = (npc.z - playerState.z) * scale;
            const offset = Math.hypot(offsetX, offsetY);
            if (offset <= rim) {
              drawNpcDot(context, size / 2 + offsetX, size / 2 + offsetY, 4.5 * dpr);
            } else {
              const angle = Math.atan2(offsetY, offsetX);
              drawNpcEdgeMarker(context, size / 2 + Math.cos(angle) * rim, size / 2 + Math.sin(angle) * rim, angle, 6 * dpr);
            }
          }
          drawPlayerArrow(context, size / 2, size / 2, playerState.heading, 7 * dpr);
        };
        frame = requestAnimationFrame(draw);
      })
      .catch((error: unknown) => console.error('[minimap]', error));

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <button type="button" className="minimap" aria-label="Buka peta besar" onClick={() => setMapOpen(true)}>
      <canvas ref={canvasRef} className="minimap-canvas" />
      <span className="minimap-north" aria-hidden="true">
        U
      </span>
    </button>
  );
}
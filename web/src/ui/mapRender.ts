import { FOG_CELL, FOG_GRID, isExplored } from '../game/exploration';
import { type BusStop, HALF_WORLD, type NpcSpawn } from '../world/worldSpec';
import { loadWorldIndex, worldUrl } from '../world/worldState';

export interface MapImage {
  image: HTMLImageElement;
  /** Pixels per metre of the baked image. */
  ppm: number;
  npcs: NpcSpawn[];
  busStops: BusStop[];
}

let mapPromise: Promise<MapImage> | null = null;

/** Loads the map image baked by tools/world once (no per-frame map rendering at runtime). */
export function loadMapImage(): Promise<MapImage> {
  mapPromise ??= loadWorldIndex().then(
    (index) =>
      new Promise<MapImage>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ image, ppm: index.map.pixelsPerMeter, npcs: index.npcs, busStops: index.busStops });
        image.onerror = () => reject(new Error('map image failed to load'));
        image.src = worldUrl(index.map.file);
      }),
  );
  return mapPromise;
}

/** World metres -> map pixels (+X right, +Z down: north-up). */
export const worldToMap = (meters: number, pixelsPerMeter: number) => (meters + HALF_WORLD) * pixelsPerMeter;

/** Yellow NPC/quest marker. */
export function drawNpcDot(context: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fillStyle = '#ffd23f';
  context.strokeStyle = '#3a2e00';
  context.lineWidth = Math.max(1, radius * 0.35);
  context.fill();
  context.stroke();
}

/** Titik biru pemain lain di minimap dan peta besar (MULTIPLAYER.md 5). */
export function drawRemoteDot(context: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fillStyle = '#3fa9f5';
  context.strokeStyle = '#0b2b44';
  context.lineWidth = Math.max(1, radius * 0.35);
  context.fill();
  context.stroke();
}

/** Blue square bus-stop marker on the big map. */
export function drawBusStop(context: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  context.fillStyle = '#3fa9f5';
  context.strokeStyle = '#ffffff';
  context.lineWidth = Math.max(1, size * 0.3);
  context.fillRect(x - size, y - size, size * 2, size * 2);
  context.strokeRect(x - size, y - size, size * 2, size * 2);
}

/** NPC outside the minimap view: a small yellow chevron on the rim pointing toward it. */
export function drawNpcEdgeMarker(context: CanvasRenderingContext2D, x: number, y: number, angle: number, size: number): void {
  context.save();
  context.translate(x, y);
  context.rotate(angle);
  context.beginPath();
  context.moveTo(size, 0);
  context.lineTo(-size * 0.6, size * 0.75);
  context.lineTo(-size * 0.6, -size * 0.75);
  context.closePath();
  context.fillStyle = '#ffd23f';
  context.strokeStyle = '#3a2e00';
  context.lineWidth = Math.max(1, size * 0.25);
  context.fill();
  context.stroke();
  context.restore();
}

/** NPC name next to its dot on the big map. */
export function drawNpcLabel(context: CanvasRenderingContext2D, text: string, x: number, y: number, fontPx: number): void {
  context.font = `700 ${fontPx}px system-ui, sans-serif`;
  context.textBaseline = 'middle';
  context.lineWidth = Math.max(2, fontPx * 0.25);
  context.strokeStyle = 'rgba(0, 0, 0, 0.75)';
  context.fillStyle = '#ffffff';
  context.strokeText(text, x, y);
  context.fillText(text, x, y);
}

/** Draws the player arrow; heading follows PlayerState (forward = -sin, -cos in world XZ). */
export function drawPlayerArrow(context: CanvasRenderingContext2D, x: number, y: number, heading: number, size: number): void {
  context.save();
  context.translate(x, y);
  context.rotate(-heading);
  context.beginPath();
  context.moveTo(0, -size);
  context.lineTo(size * 0.7, size * 0.75);
  context.lineTo(0, size * 0.35);
  context.lineTo(-size * 0.7, size * 0.75);
  context.closePath();
  context.fillStyle = '#2f6fdb';
  context.strokeStyle = '#ffffff';
  context.lineWidth = Math.max(1.5, size * 0.2);
  context.fill();
  context.stroke();
  context.restore();
}
const FOG_COLOR = 'rgba(20, 26, 36, 0.82)';

/**
 * Darkens unexplored fog cells. (originX, originY) is the canvas position of world (-HALF_WORLD, -HALF_WORLD)
 * and `scale` is canvas pixels per metre; only cells inside the canvas are visited.
 */
export function drawFog(context: CanvasRenderingContext2D, originX: number, originY: number, scale: number): void {
  const cell = FOG_CELL * scale;
  const { width, height } = context.canvas;
  const minI = Math.max(0, Math.floor(-originX / cell));
  const maxI = Math.min(FOG_GRID - 1, Math.floor((width - originX) / cell));
  const minJ = Math.max(0, Math.floor(-originY / cell));
  const maxJ = Math.min(FOG_GRID - 1, Math.floor((height - originY) / cell));
  context.fillStyle = FOG_COLOR;
  for (let j = minJ; j <= maxJ; j++) {
    for (let i = minI; i <= maxI; i++) {
      // +1 px overlap avoids hairline seams between cells.
      if (!isExplored(i, j)) context.fillRect(originX + i * cell, originY + j * cell, cell + 1, cell + 1);
    }
  }
}
import { HALF_WORLD, WORLD_SIZE } from '../world/worldSpec';

/** Fog-of-war grid: one cell per FOG_CELL metres, revealed around the player. */
export const FOG_CELL = 8;
export const FOG_GRID = WORLD_SIZE / FOG_CELL;
export const REVEAL_RADIUS = 28;

const cells = new Uint8Array(FOG_GRID * FOG_GRID);

const toCell = (meters: number) => Math.floor((meters + HALF_WORLD) / FOG_CELL);

export function isExplored(i: number, j: number): boolean {
  if (i < 0 || j < 0 || i >= FOG_GRID || j >= FOG_GRID) return true;
  return cells[j * FOG_GRID + i] === 1;
}

/** Reveals cells whose centre is within `radius` of (x, z). Returns true when anything changed. */
export function markExplored(x: number, z: number, radius = REVEAL_RADIUS): boolean {
  let changed = false;
  const minI = Math.max(0, toCell(x - radius));
  const maxI = Math.min(FOG_GRID - 1, toCell(x + radius));
  const minJ = Math.max(0, toCell(z - radius));
  const maxJ = Math.min(FOG_GRID - 1, toCell(z + radius));
  for (let j = minJ; j <= maxJ; j++) {
    for (let i = minI; i <= maxI; i++) {
      const cx = -HALF_WORLD + (i + 0.5) * FOG_CELL;
      const cz = -HALF_WORLD + (j + 0.5) * FOG_CELL;
      const index = j * FOG_GRID + i;
      if (cells[index] === 0 && Math.hypot(cx - x, cz - z) <= radius) {
        cells[index] = 1;
        changed = true;
      }
    }
  }
  return changed;
}

export function clearExplored(): void {
  cells.fill(0);
}

export function exploredRatio(): number {
  let count = 0;
  for (const cell of cells) count += cell;
  return count / cells.length;
}

/** Bit-packed base64 (512 bytes for the 64x64 grid) for the save file. */
export function encodeExplored(): string {
  const bytes = new Uint8Array(cells.length / 8);
  cells.forEach((cell, index) => {
    if (cell) bytes[index >> 3] = (bytes[index >> 3] ?? 0) | (1 << (index & 7));
  });
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeExplored(text: string): void {
  clearExplored();
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    return;
  }
  for (let index = 0; index < cells.length; index++) {
    const byte = binary.charCodeAt(index >> 3) || 0;
    cells[index] = (byte >> (index & 7)) & 1;
  }
}
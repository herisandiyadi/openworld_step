import { getWorldDimensions, halfWorldFor, worldSizeFor } from '../world/worldSpec';

/** Fog-of-war grid: one cell per FOG_CELL metres, revealed around the player. */
export const FOG_CELL = 8;
export const REVEAL_RADIUS = 28;

// Grid dihitung on-demand dari dimensi runtime (bukan saat import), supaya
// ukuran benar setelah index.json map (mis. 32 chunk) di-load.
let cachedWorldChunks = -1;
let cachedGrid = 0;
let cells = new Uint8Array(0);

function ensureFog(): void {
  const worldChunks = getWorldDimensions().worldChunks;
  if (worldChunks === cachedWorldChunks) return;
  cachedWorldChunks = worldChunks;
  cachedGrid = worldSizeFor() / FOG_CELL;
  cells = new Uint8Array(cachedGrid * cachedGrid);
}

export function getFogGrid(): number {
  ensureFog();
  return cachedGrid;
}

const toCell = (meters: number) => Math.floor((meters + halfWorldFor()) / FOG_CELL);

export function isExplored(i: number, j: number): boolean {
  ensureFog();
  if (i < 0 || j < 0 || i >= cachedGrid || j >= cachedGrid) return true;
  return cells[j * cachedGrid + i] === 1;
}

/** Reveals cells whose centre is within `radius` of (x, z). Returns true when anything changed. */
export function markExplored(x: number, z: number, radius = REVEAL_RADIUS): boolean {
  ensureFog();
  let changed = false;
  const minI = Math.max(0, toCell(x - radius));
  const maxI = Math.min(cachedGrid - 1, toCell(x + radius));
  const minJ = Math.max(0, toCell(z - radius));
  const maxJ = Math.min(cachedGrid - 1, toCell(z + radius));
  for (let j = minJ; j <= maxJ; j++) {
    for (let i = minI; i <= maxI; i++) {
      const cx = -halfWorldFor() + (i + 0.5) * FOG_CELL;
      const cz = -halfWorldFor() + (j + 0.5) * FOG_CELL;
      const index = j * cachedGrid + i;
      if (cells[index] === 0 && Math.hypot(cx - x, cz - z) <= radius) {
        cells[index] = 1;
        changed = true;
      }
    }
  }
  return changed;
}

export function clearExplored(): void {
  ensureFog();
  cells.fill(0);
}

export function exploredRatio(): number {
  ensureFog();
  let count = 0;
  for (const cell of cells) count += cell;
  return count / cells.length;
}

/** Bit-packed base64 for the save file. */
export function encodeExplored(): string {
  ensureFog();
  const bytes = new Uint8Array(Math.ceil(cells.length / 8));
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

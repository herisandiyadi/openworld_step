import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SHADOW_HALF_EXTENT } from './remotePlayers';

/**
 * Guard: SHADOW_HALF_EXTENT harus sama dengan shadow-camera-* di PlayerController.tsx.
 * Ini dibaca langsung dari berkas sumber supaya perubahan frustum shadow (misal diperbesar untuk
 * jarak pandang lebih jauh) langsung menggagalkan test — bukan diam-diam membuat pemain yang
 * seharusnya punya bayangan kehilangan bayangan.
 */
describe('SHADOW_HALF_EXTENT sinkron dengan shadow camera PlayerController', () => {
  const source = readFileSync(fileURLToPath(new URL('../game/PlayerController.tsx', import.meta.url)), 'utf8');

  const halfExtents = (): number[] => {
    const found: number[] = [];
    const pattern = /shadow-camera-(?:left|right|top|bottom)=\{(-?\d+(?:\.\d+)?)\}/g;
    for (const match of source.matchAll(pattern)) found.push(Number(match[1]));
    return found;
  };

  it('PlayerController punya empat sisi shadow camera', () => {
    expect(halfExtents()).toHaveLength(4);
  });

  it('keempat sisi berjarak sama dari pusat dan cocok dengan SHADOW_HALF_EXTENT', () => {
    const sides = halfExtents();
    // left/bottom negatif, right/top positif — yang harus sama adalah jaraknya dari pusat.
    expect(sides.map(Math.abs).every((value) => value === SHADOW_HALF_EXTENT)).toBe(true);
  });
});

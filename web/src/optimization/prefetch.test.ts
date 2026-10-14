import { describe, expect, it } from 'vitest';
import { prefetchOrder } from './prefetch';
import { streamingPolicyFor } from './streamingPolicy';
import { CHUNK_SIZE } from '../world/worldSpec';

// x = 0, z = 0 jatuh di chunk 8_8 (dunia 16x16 berpusat di origin). Titik tengah chunk 8_8:
const MID = CHUNK_SIZE / 2;

describe('prefetchOrder', () => {
  it('chunk player selalu pertama, lalu chunk searah gerak', () => {
    const policy = streamingPolicyFor('medium');
    const order = prefetchOrder({ x: MID, z: MID, vx: 10, vz: 0 }, policy);
    expect(order[0]).toBe('8_8');
    expect(order[1]).toBe('9_8');
    // Chunk di depan diambil lebih dulu daripada chunk di belakang dengan jarak sama.
    expect(order.indexOf('9_8')).toBeLessThan(order.indexOf('7_8'));
  });

  it('memperluas radius hanya ke arah gerak (prefetchAhead)', () => {
    const policy = streamingPolicyFor('medium');
    const order = prefetchOrder({ x: MID, z: MID, vx: 10, vz: 0 }, policy);
    // loadRadius 2 + 1 ke depan: 11_8 ikut (3 chunk ahead), 5_8 (di belakang) tidak.
    expect(order).toContain('11_8');
    expect(order).not.toContain('5_8');
  });

  it('deterministik: input sama -> urutan identik', () => {
    const policy = streamingPolicyFor('high');
    const input = { x: 13.7, z: -40.2, vx: -3.3, vz: 7.1 };
    const first = prefetchOrder(input, policy);
    for (let i = 0; i < 5; i++) expect(prefetchOrder(input, policy)).toEqual(first);
  });

  it('kecepatan nol: hanya radius load, tanpa NaN, tanpa duplikat', () => {
    const policy = streamingPolicyFor('low');
    const order = prefetchOrder({ x: MID, z: MID, vx: 0, vz: 0 }, policy);
    expect(order).toHaveLength((policy.loadRadius * 2 + 1) ** 2);
    expect(order[0]).toBe('8_8');
    expect(order.join()).not.toContain('NaN');
    expect(new Set(order).size).toBe(order.length);
  });

  it('input tidak valid (NaN) diperlakukan sebagai diam', () => {
    const policy = streamingPolicyFor('low');
    const order = prefetchOrder({ x: MID, z: MID, vx: Number.NaN, vz: Number.POSITIVE_INFINITY }, policy);
    expect(order).toEqual(prefetchOrder({ x: MID, z: MID, vx: 0, vz: 0 }, policy));
  });

  it('terpotong di tepi dunia', () => {
    const policy = streamingPolicyFor('medium');
    const order = prefetchOrder({ x: -1000, z: -1000, vx: 0, vz: 0 }, policy);
    expect(order).toHaveLength((policy.loadRadius + 1) ** 2);
    expect(order[0]).toBe('0_0');
  });
});

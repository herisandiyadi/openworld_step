import { describe, expect, it } from 'vitest';
import { prefetchOrder } from './prefetch';
import { streamingPolicyFor } from './streamingPolicy';
import { CHUNK_SIZE } from '../world/worldSpec';

// x = 0, z = 0 jatuh di chunk 4_4 (dunia 8x8 berpusat di origin). Titik tengah chunk 4_4:
const MID = CHUNK_SIZE / 2;

describe('prefetchOrder', () => {
  it('chunk player selalu pertama, lalu chunk searah gerak', () => {
    const policy = streamingPolicyFor('medium');
    const order = prefetchOrder({ x: MID, z: MID, vx: 10, vz: 0 }, policy);
    expect(order[0]).toBe('4_4');
    expect(order[1]).toBe('5_4');
    // Chunk di depan diambil lebih dulu daripada chunk di belakang dengan jarak sama.
    expect(order.indexOf('5_4')).toBeLessThan(order.indexOf('3_4'));
  });

  it('memperluas radius hanya ke arah gerak (prefetchAhead)', () => {
    const policy = streamingPolicyFor('medium');
    const order = prefetchOrder({ x: MID, z: MID, vx: 10, vz: 0 }, policy);
    // loadRadius 2 + 1 ke depan: 7_4 ikut, 1_4 (di belakang) tidak.
    expect(order).toContain('7_4');
    expect(order).not.toContain('1_4');
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
    expect(order[0]).toBe('4_4');
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

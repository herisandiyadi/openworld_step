import { describe, expect, it } from 'vitest';
import {
  horizontalDistance,
  isLabelVisible,
  isRemoteVisible,
  LABEL_VISIBLE_DISTANCE,
  MAX_VISIBLE_REMOTES,
  REMOTE_FOG_FAR,
  type RemoteCandidate,
  selectVisibleRemotes,
} from './remotePlayers';

const origin = { x: 0, z: 0 };

describe('horizontalDistance', () => {
  it('mengabaikan y dan memakai jarak xz', () => {
    expect(horizontalDistance({ x: 3, z: 4 }, origin)).toBe(5);
  });
});

describe('isRemoteVisible', () => {
  it('terlihat sampai batas kabut, tidak lewat', () => {
    expect(isRemoteVisible(0)).toBe(true);
    expect(isRemoteVisible(REMOTE_FOG_FAR)).toBe(true);
    expect(isRemoteVisible(REMOTE_FOG_FAR + 0.01)).toBe(false);
  });

  it('menolak jarak tidak sah', () => {
    expect(isRemoteVisible(Number.NaN)).toBe(false);
    expect(isRemoteVisible(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isRemoteVisible(-1)).toBe(false);
  });

  it('label punya batas jarak sendiri', () => {
    expect(isLabelVisible(LABEL_VISIBLE_DISTANCE)).toBe(true);
    expect(isLabelVisible(LABEL_VISIBLE_DISTANCE + 1)).toBe(false);
  });
});

describe('selectVisibleRemotes', () => {
  it('membuang pemain di luar kabut dan mengurutkan terdekat dulu', () => {
    const candidates: RemoteCandidate[] = [
      { id: 1, x: 30, z: 0 },
      { id: 2, x: 200, z: 0 },
      { id: 3, x: 0, z: 5 },
      { id: 4, x: -10, z: 0 },
    ];
    const result = selectVisibleRemotes(candidates, origin);
    expect(result.map((r) => r.id)).toEqual([3, 4, 1]);
    expect(result[0]?.distance).toBe(5);
  });

  it('memotong ke MAX_VISIBLE_REMOTES dari 50 pemain', () => {
    const candidates: RemoteCandidate[] = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, x: 50 - i, z: 0 }));
    const result = selectVisibleRemotes(candidates, origin);
    expect(MAX_VISIBLE_REMOTES).toBe(20);
    expect(result).toHaveLength(MAX_VISIBLE_REMOTES);
    // Terdekat: id 50 (x = 1), lalu 49, ...
    expect(result[0]?.id).toBe(50);
    expect(result[19]?.id).toBe(31);
  });

  it('urutan stabil berdasarkan id saat jaraknya sama', () => {
    const candidates: RemoteCandidate[] = [
      { id: 9, x: 10, z: 0 },
      { id: 2, x: -10, z: 0 },
      { id: 5, x: 0, z: 10 },
    ];
    expect(selectVisibleRemotes(candidates, origin).map((r) => r.id)).toEqual([2, 5, 9]);
  });

  it('menghormati batas kustom dan origin selain nol', () => {
    const candidates: RemoteCandidate[] = [
      { id: 1, x: 100, z: 100 },
      { id: 2, x: 104, z: 100 },
      { id: 3, x: 0, z: 0 },
    ];
    expect(selectVisibleRemotes(candidates, { x: 100, z: 100 }, 1).map((r) => r.id)).toEqual([1]);
    expect(selectVisibleRemotes(candidates, { x: 100, z: 100 }, 10, 3)).toHaveLength(1);
    expect(selectVisibleRemotes(candidates, origin, 0)).toEqual([]);
  });

  it('melewati posisi yang tidak sah', () => {
    const candidates: RemoteCandidate[] = [
      { id: 1, x: Number.NaN, z: 0 },
      { id: 2, x: 1, z: 1 },
    ];
    expect(selectVisibleRemotes(candidates, origin).map((r) => r.id)).toEqual([2]);
  });
});

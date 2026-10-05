import { describe, expect, it } from 'vitest';
import { BENCHMARK_SCENE, benchmarkSceneFor, type BenchmarkEntity } from './benchmarkScene';

describe('benchmarkScene', () => {
  it('menyediakan scene day dan night deterministik', () => {
    expect(benchmarkSceneFor('day')).toEqual(BENCHMARK_SCENE.day);
    expect(benchmarkSceneFor('night')).toEqual(BENCHMARK_SCENE.night);
    expect(benchmarkSceneFor('day')).toEqual(benchmarkSceneFor('day'));
    expect(benchmarkSceneFor('night')).toEqual(benchmarkSceneFor('night'));
  });

  it('day dan night memakai layout yang sama namun waktu/cuaca berbeda', () => {
    const day = benchmarkSceneFor('day');
    const night = benchmarkSceneFor('night');
    expect(day.player).toEqual(night.player);
    expect(day.camera).toEqual(night.camera);
    expect(day.vehicles).toEqual(night.vehicles);
    expect(day.npcs).toEqual(night.npcs);
    expect(day.dayClock).not.toBe(night.dayClock);
    expect(day.weather).not.toBe(night.weather);
  });

  it('nilai scene terkunci sehingga capture bisa dibandingkan antar run', () => {
    expect(benchmarkSceneFor('day')).toEqual({
      variant: 'day',
      player: { position: [12, 0, -18], rotationY: 0.35 },
      camera: { position: [17, 8, -27], target: [12, 1.2, -18] },
      dayClock: 0.32,
      vehicles: [
        { id: 'sedan-01', position: [7, 0, -12], rotationY: 1.57 },
        { id: 'taxi-01', position: [20, 0, -20], rotationY: -1.57 },
      ],
      npcs: [
        { id: 'ped-01', position: [10, 0, -9], rotationY: 2.1 },
        { id: 'ped-02', position: [16, 0, -15], rotationY: -0.8 },
      ],
      props: [
        { id: 'bench-01', position: [3, 0, -16], rotationY: 0 },
        { id: 'lamp-01', position: [22, 0, -11], rotationY: 0 },
        { id: 'tree-01', position: [0, 0, -25], rotationY: 0.4 },
      ],
      weather: 'clear',
    });
    expect(benchmarkSceneFor('night').dayClock).toBe(0.82);
  });

  it('scene beku sehingga konsumen tidak bisa menggeser baseline', () => {
    expect(Object.isFrozen(BENCHMARK_SCENE)).toBe(true);
    expect(Object.isFrozen(benchmarkSceneFor('day'))).toBe(true);
  });

  it('objek bersarang juga beku (deep freeze)', () => {
    const night = benchmarkSceneFor('night');
    expect(Object.isFrozen(night.player.position)).toBe(true);
    expect(Object.isFrozen(night.camera)).toBe(true);
    expect(Object.isFrozen(night.vehicles)).toBe(true);
    expect(night.npcs.every((n: BenchmarkEntity) => Object.isFrozen(n) && Object.isFrozen(n.position))).toBe(true);
  });

  it('serialisasi JSON stabil untuk dua pemanggilan', () => {
    expect(JSON.stringify(benchmarkSceneFor('night'))).toBe(JSON.stringify(benchmarkSceneFor('night')));
  });
});

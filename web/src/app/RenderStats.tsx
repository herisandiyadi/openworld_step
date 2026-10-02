import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGameStore } from '../state/gameStore';

const SAMPLE_SECONDS = 0.5;

/** Publishes FPS, draw calls, and triangles to the HUD twice per second. */
export function RenderStats() {
  const setStats = useGameStore((state) => state.setStats);
  const accumulator = useRef({ time: 0, frames: 0 });

  useFrame(({ gl }, delta) => {
    const sample = accumulator.current;
    sample.time += delta;
    sample.frames += 1;
    if (sample.time < SAMPLE_SECONDS) return;
    setStats({
      fps: Math.round(sample.frames / sample.time),
      calls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
    });
    sample.time = 0;
    sample.frames = 0;
  });

  return null;
}
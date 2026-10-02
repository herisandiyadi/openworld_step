import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { playerState } from '../game/runtime';
import { cameraState, HERO_HIDE_DISTANCE } from '../camera/followCamera';
import { useGameStore } from '../state/gameStore';
import { BLOCK_PITCH, HALF_WORLD } from '../world/worldSpec';
import { worldState } from '../world/worldState';

/** Started from the pause menu, or automatically with `?soak`: drives the player across the whole map and reports metrics. */
export const SOAK_FROM_URL = typeof location !== 'undefined' && new URLSearchParams(location.search).has('soak');

const SPEED = 30;
const LAPS = 2;
const SAMPLE_SECONDS = 2;
const HITCH_MS = 50;
const EDGE = HALF_WORLD - BLOCK_PITCH;

interface Sample {
  t: number;
  lap: number;
  x: number;
  z: number;
  chunks: number;
  geometries: number;
  textures: number;
  heapMb: number | null;
}

/** Serpentine route along road centre lines, ending back at the spawn so lap memory can be compared. */
function buildRoute(): { x: number; z: number }[] {
  const route = [{ x: 0, z: 0 }, { x: 0, z: -EDGE }, { x: -EDGE, z: -EDGE }];
  const rows = [-EDGE, -2 * BLOCK_PITCH, 2 * BLOCK_PITCH, EDGE];
  rows.forEach((z, index) => {
    const fromX = index % 2 === 0 ? -EDGE : EDGE;
    const toX = -fromX;
    route.push({ x: fromX, z }, { x: toX, z });
  });
  route.push({ x: 0, z: EDGE }, { x: 0, z: 0 });
  return route;
}

const heapMb = (): number | null => {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return memory ? Math.round((memory.usedJSHeapSize / 1048576) * 10) / 10 : null;
};

export function SoakTest() {
  const gl = useThree((state) => state.gl);
  const worldReady = useGameStore((state) => state.worldReady);
  const route = useMemo(buildRoute, []);
  const run = useRef({
    started: false,
    done: false,
    lap: 0,
    leg: 0,
    legProgress: 0,
    elapsed: 0,
    sampleTimer: 0,
    frames: 0,
    frameMs: [] as number[],
    hitches: 0,
    /** Frame dengan kamera terdorong di bawah 1.2 m (gedung menghalangi); target: 0. */
    cameraClips: 0,
    minCameraDistance: Infinity,
    maxFrameMs: 0,
    longTasks: [] as number[],
    samples: [] as Sample[],
    lapEnd: [] as Sample[],
    distance: 0,
  });

  useEffect(() => {
    if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes?.includes('longtask')) return;
    const observer = new PerformanceObserver((list) => {
      if (!run.current.started || run.current.done) return;
      for (const entry of list.getEntries()) run.current.longTasks.push(Math.round(entry.duration));
    });
    observer.observe({ type: 'longtask', buffered: false });
    return () => observer.disconnect();
  }, []);

  useFrame((_, delta) => {
    const state = run.current;
    if (!worldReady) {
      state.sampleTimer += delta;
      if (state.sampleTimer >= SAMPLE_SECONDS) {
        state.sampleTimer = 0;
        console.info('[soak:waiting]', JSON.stringify({ chunks: worldState.chunks.size, stream: useGameStore.getState().stream, index: worldState.index !== null }));
      }
      return;
    }
    if (state.done) return;
    const sample = (): Sample => {
      (window as Window & { gc?: () => void }).gc?.();
      return {
        t: Math.round(state.elapsed * 10) / 10,
        lap: state.lap,
        x: Math.round(playerState.x),
        z: Math.round(playerState.z),
        chunks: worldState.chunks.size,
        geometries: gl.info.memory.geometries,
        textures: gl.info.memory.textures,
        heapMb: heapMb(),
      };
    };
    if (!state.started) {
      state.started = true;
      state.lapEnd.push(sample());
      return;
    }

    const frameMs = delta * 1000;
    state.frames += 1;
    state.frameMs.push(frameMs);
    state.maxFrameMs = Math.max(state.maxFrameMs, frameMs);
    if (frameMs > HITCH_MS) state.hitches += 1;
    state.minCameraDistance = Math.min(state.minCameraDistance, cameraState.distance);
    if (cameraState.distance < HERO_HIDE_DISTANCE) state.cameraClips += 1;
    state.elapsed += delta;

    let travel = SPEED * Math.min(delta, 0.1);
    state.distance += travel;
    while (travel > 0) {
      const from = route[state.leg];
      const to = route[state.leg + 1];
      if (!from || !to) {
        state.lap += 1;
        state.leg = 0;
        state.legProgress = 0;
        state.lapEnd.push(sample());
        if (state.lap >= LAPS) {
          finish();
          return;
        }
        continue;
      }
      const length = Math.hypot(to.x - from.x, to.z - from.z);
      const remaining = length - state.legProgress;
      if (travel < remaining) {
        state.legProgress += travel;
        travel = 0;
      } else {
        travel -= remaining;
        state.leg += 1;
        state.legProgress = 0;
        continue;
      }
      const t = state.legProgress / length;
      playerState.x = from.x + (to.x - from.x) * t;
      playerState.z = from.z + (to.z - from.z) * t;
      playerState.heading = Math.atan2(-(to.x - from.x), -(to.z - from.z));
      playerState.target = null;
      playerState.path.length = 0;
    }

    state.sampleTimer += delta;
    if (state.sampleTimer >= SAMPLE_SECONDS) {
      state.sampleTimer = 0;
      const current = sample();
      state.samples.push(current);
      console.info('[soak:progress]', JSON.stringify({ ...current, leg: state.leg, fps: Math.round(1 / Math.max(delta, 1e-3)), hitches: state.hitches }));
    }
  });

  function finish(): void {
    const state = run.current;
    state.done = true;
    const sorted = [...state.frameMs].sort((a, b) => a - b);
    const pct = (p: number) => Math.round((sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0) * 10) / 10;
    const stream = useGameStore.getState().stream;
    const report = {
      userAgent: navigator.userAgent,
      renderer: (() => {
        const context = gl.getContext();
        const info = context.getExtension('WEBGL_debug_renderer_info');
        return info ? String(context.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown';
      })(),
      seconds: Math.round(state.elapsed),
      distanceM: Math.round(state.distance),
      frames: state.frames,
      avgFps: Math.round(state.frames / state.elapsed),
      frameMs: { p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), max: Math.round(state.maxFrameMs) },
      hitchesOver50ms: state.hitches,
      cameraClips: state.cameraClips,
      minCameraDistanceM: Math.round(Math.min(state.minCameraDistance, 99) * 100) / 100,
      longTasks: { count: state.longTasks.length, max: Math.max(0, ...state.longTasks) },
      stream: { ...stream, maxApplyMs: Math.round(stream.applyMs * 10) / 10 },
      lapEnd: state.lapEnd,
      samples: state.samples,
    };
    (window as Window & { __soakReport?: unknown }).__soakReport = report;
    const lapText = state.lapEnd.map((lap) => `  putaran ${lap.lap}: ${lap.chunks} chunk, ${lap.geometries} geometri, heap ${lap.heapMb ?? '-'} MB`).join('\n');
    const store = useGameStore.getState();
    store.setSoakResult(
      [
        `Rata-rata ${report.avgFps} FPS selama ${report.seconds} s (${report.distanceM} m)`,
        `Frame: p50 ${report.frameMs.p50} ms, p95 ${report.frameMs.p95} ms, maks ${report.frameMs.max} ms`,
        `Hitch > 50 ms: ${report.hitchesOver50ms} dari ${report.frames} frame`,
        `Klip kamera (< ${HERO_HIDE_DISTANCE} m): ${report.cameraClips} frame, jarak terdekat ${report.minCameraDistanceM} m`,
        `Pasang chunk (main thread) maks: ${report.stream.maxApplyMs} ms`,
        'Memori per putaran:',
        lapText,
        `GPU: ${report.renderer}`,
      ].join('\n'),
    );
    store.setSoakActive(false);
    console.info('[soak]', JSON.stringify(report));
    fetch('/__soak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(report) }).catch(() => {});
  }

  return null;
}
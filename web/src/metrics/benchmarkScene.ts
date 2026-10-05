export type BenchmarkVariant = 'day' | 'night';

type Vec3 = readonly [number, number, number];

export interface BenchmarkEntity {
  readonly id: string;
  readonly position: Vec3;
  readonly rotationY: number;
}

export interface BenchmarkScene {
  readonly variant: BenchmarkVariant;
  readonly player: { readonly position: Vec3; readonly rotationY: number };
  readonly camera: { readonly position: Vec3; readonly target: Vec3 };
  readonly dayClock: number;
  readonly vehicles: readonly BenchmarkEntity[];
  readonly npcs: readonly BenchmarkEntity[];
  readonly props: readonly BenchmarkEntity[];
  readonly weather: 'clear' | 'overcast';
}

/** Freeze rekursif: baseline benchmark tidak boleh tergeser oleh konsumen. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const player = { position: [12, 0, -18] as Vec3, rotationY: 0.35 };
const camera = { position: [17, 8, -27] as Vec3, target: [12, 1.2, -18] as Vec3 };
const vehicles: readonly BenchmarkEntity[] = [
  { id: 'sedan-01', position: [7, 0, -12], rotationY: 1.57 },
  { id: 'taxi-01', position: [20, 0, -20], rotationY: -1.57 },
];
const npcs: readonly BenchmarkEntity[] = [
  { id: 'ped-01', position: [10, 0, -9], rotationY: 2.1 },
  { id: 'ped-02', position: [16, 0, -15], rotationY: -0.8 },
];
const props: readonly BenchmarkEntity[] = [
  { id: 'bench-01', position: [3, 0, -16], rotationY: 0 },
  { id: 'lamp-01', position: [22, 0, -11], rotationY: 0 },
  { id: 'tree-01', position: [0, 0, -25], rotationY: 0.4 },
];

export const BENCHMARK_SCENE: Readonly<Record<BenchmarkVariant, BenchmarkScene>> = deepFreeze({
  day: { variant: 'day', player, camera, dayClock: 0.32, vehicles, npcs, props, weather: 'clear' },
  night: { variant: 'night', player, camera, dayClock: 0.82, vehicles, npcs, props, weather: 'overcast' },
});

/** Mengambil snapshot benchmark tetap; tidak membaca waktu atau random. */
export function benchmarkSceneFor(variant: BenchmarkVariant): BenchmarkScene {
  return BENCHMARK_SCENE[variant];
}

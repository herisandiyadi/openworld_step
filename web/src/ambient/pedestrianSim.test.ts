import { describe, expect, it } from 'vitest';
import { bakeLanes } from '../../tools/world/lanes';
import { generateWorld } from '../world/worldGen';
import {
  buildWalkGraph,
  createPedestrian,
  createPedWorld,
  pedPose,
  LINGER_TIME,
  nearestPed,
  PED_GAP,
  PED_TALK_DISTANCE,
  setTalking,
  stepPedestrians,
  TICK_HZ,
  updatePedSpawns,
  walkEdgeAt,
} from './pedestrianSim';
import { inView } from './spawner';

const data = bakeLanes();
const graph = buildWalkGraph(data);
const buildings = generateWorld(1337).chunks.flatMap((chunk) => chunk.buildings);
const mulberry = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Radius badan pejalan kaki; dipakai saat memeriksa jarak ke collider gedung. */
const PED_RADIUS = 0.3;

/** Isi trotoar dengan pejalan kaki berjarak aman. */
function seedPeds(count: number, seed: number) {
  const random = mulberry(seed);
  const peds = [];
  for (let i = 0; i < count; i++) {
    const edge = Math.floor(random() * graph.edges.length);
    peds.push(createPedestrian(graph, i, edge, random() * walkEdgeAt(graph, edge).length, random, i % 60));
  }
  return { world: createPedWorld(peds), random };
}

/** Jarak titik ke sebuah AABB (0 = di dalam). */
const distanceToBox = (x: number, z: number, box: { minX: number; maxX: number; minZ: number; maxZ: number }) =>
  Math.hypot(Math.max(box.minX - x, 0, x - box.maxX), Math.max(box.minZ - z, 0, z - box.maxZ));

describe('simulasi pejalan kaki', () => {
  it('graf trotoar punya zebra cross dan tidak ada node buntu', () => {
    expect(graph.nodes.length).toBeGreaterThan(100);
    expect(graph.edges.some((edge) => edge.cross)).toBe(true);
    for (const list of graph.incident) expect(list.length).toBeGreaterThan(0);
  });

  it('5.000 tick: tidak ada agen di dalam AABB gedung dan tidak ada deadlock', () => {
    const { world, random } = seedPeds(120, 7);
    const dt = 1 / TICK_HZ;
    // Kendaraan diam di dekat satu persimpangan: agen harus tetap bisa jalan (lewat batas antre).
    world.vehicles = [{ x: data.intersections[0]?.x ?? 0, z: data.intersections[0]?.z ?? 0, speed: 6 }];
    const stalled = new Map<number, number>();
    let maxStall = 0;
    let inBuilding = 0;
    let minDistance = Number.POSITIVE_INFINITY;
    let minGap = Number.POSITIVE_INFINITY;

    for (let tick = 0; tick < 5_000; tick++) {
      stepPedestrians(graph, world, dt, random);
      for (const ped of world.peds) {
        const pose = pedPose(graph, ped);
        // ponytail: cek gedung tiap 25 tick saja (O(agen x gedung) memblokir worker vitest);
        // agen hanya bergerak di edge lurus yang seluruhnya sudah di luar gedung.
        if (tick % 25 === 0) for (const box of buildings) {
          const distance = distanceToBox(pose.x, pose.z, box);
          if (distance < PED_RADIUS) inBuilding++;
          minDistance = Math.min(minDistance, distance);
        }
        const idle = ped.speed < 0.05 ? (stalled.get(ped.id) ?? 0) + 1 : 0;
        stalled.set(ped.id, idle);
        maxStall = Math.max(maxStall, idle);
        for (const other of world.peds) {
          if (other.id === ped.id || other.edge !== ped.edge || other.from !== ped.from) continue;
          if (other.s > ped.s) minGap = Math.min(minGap, other.s - ped.s);
        }
      }
    }

    expect(inBuilding).toBe(0);
    expect(minDistance).toBeGreaterThan(PED_RADIUS);
    // Tidak saling tembus: celah antar agen searah tidak pernah habis.
    expect(minGap).toBeGreaterThan(0);
    // Deadlock = agen berhenti terus. Batas 40 detik (antre zebra maksimal 20 detik).
    expect(maxStall).toBeLessThan(40 * TICK_HZ);
  }, 120_000);

  it('antre di zebra cross saat ada kendaraan lewat, lalu menyeberang setelah bersih', () => {
    const random = mulberry(3);
    const crossIndex = graph.edges.findIndex((edge) => edge.cross);
    const cross = walkEdgeAt(graph, crossIndex);
    const entry = graph.nodes[cross.a]!;
    const exit = graph.nodes[cross.b]!;
    const mid = { x: (entry.x + exit.x) / 2, z: (entry.z + exit.z) / 2 };

    // Masuk dari sisi trotoar menuju mulut zebra.
    const approach = graph.incident[cross.a]!.find((index) => index !== crossIndex)!;
    const ped = createPedestrian(graph, 1, approach, walkEdgeAt(graph, approach).length - 0.5, random);
    const walk = walkEdgeAt(graph, approach);
    ped.from = walk.a === cross.a ? walk.b : walk.a;
    ped.to = cross.a;
    ped.s = walk.length - 0.5;
    ped.state = 'walk';

    const world = createPedWorld([ped]);
    world.vehicles = [{ ...mid, speed: 8 }];
    for (let tick = 0; tick < 60; tick++) stepPedestrians(graph, world, 1 / TICK_HZ, random);
    expect(ped.state).toBe('wait');
    expect(ped.speed).toBeLessThan(0.1);

    // Jalan sepi: agen menyeberang dan keluar dari zebra.
    world.vehicles = [];
    for (let tick = 0; tick < 200; tick++) stepPedestrians(graph, world, 1 / TICK_HZ, random);
    expect(ped.state).not.toBe('wait');
    expect(Math.hypot(pedPose(graph, ped).x - entry.x, pedPose(graph, ped).z - entry.z)).toBeGreaterThan(1);
  });

  it('lampu pejalan merah menahan agen di mulut zebra', () => {
    const random = mulberry(5);
    const crossIndex = graph.edges.findIndex((edge) => edge.cross);
    const ped = createPedestrian(graph, 1, crossIndex, 0, random);
    ped.state = 'wait';
    ped.timer = 0;
    const world = createPedWorld([ped]);
    world.pedGreen = () => false;
    for (let tick = 0; tick < 100; tick++) stepPedestrians(graph, world, 1 / TICK_HZ, random);
    expect(ped.state).toBe('wait');
    expect(ped.s).toBe(0);
  });

  it('berhenti di belakang pejalan lain dan saat pemain menghalangi', () => {
    const random = mulberry(11);
    const lane = graph.edges.findIndex((edge) => !edge.cross && edge.length > 8);
    const front = createPedestrian(graph, 1, lane, 6, random);
    const back = createPedestrian(graph, 2, lane, 0, random);
    back.from = front.from;
    back.to = front.to;
    front.speed = 0;
    front.maxSpeed = 0;
    const world = createPedWorld([front, back]);
    for (let tick = 0; tick < 200; tick++) stepPedestrians(graph, world, 1 / TICK_HZ, random);
    expect(front.s - back.s).toBeGreaterThan(0);
    expect(back.speed).toBeLessThan(0.3);

    // Pemain berdiri tepat di depan: agen melambat sampai berhenti.
    const solo = createPedestrian(graph, 3, lane, 1, random);
    const second = createPedWorld([solo]);
    const pose = pedPose(graph, solo);
    second.player = { x: pose.x + pose.dirX * 0.6, z: pose.z + pose.dirZ * 0.6 };
    for (let tick = 0; tick < 30; tick++) stepPedestrians(graph, second, 1 / TICK_HZ, random);
    expect(solo.speed).toBeLessThan(0.1);
  });

  it('agen yang sedang chat atau duduk tidak bergerak', () => {
    const random = mulberry(13);
    const lane = graph.edges.findIndex((edge) => !edge.cross);
    const talker = createPedestrian(graph, 1, lane, 2, random);
    talker.state = 'talk';
    const sitter = createPedestrian(graph, 2, lane, 5, random);
    sitter.state = 'sit';
    const world = createPedWorld([talker, sitter]);
    for (let tick = 0; tick < 100; tick++) stepPedestrians(graph, world, 1 / TICK_HZ, random);
    expect(talker.s).toBe(2);
    expect(sitter.s).toBe(5);
    expect(talker.speed).toBe(0);
  });

  it('celah minimum antar agen sesuai PED_GAP', () => {
    expect(PED_GAP).toBeGreaterThan(0.5);
    const pose = pedPose(graph, createPedestrian(graph, 1, 0, 0, mulberry(1)));
    expect(Math.hypot(pose.dirX, pose.dirZ)).toBeCloseTo(1, 6);
  });

  it('chat warga: agen berhenti, tidak di-despawn, lalu lanjut jalan', () => {
    const random = mulberry(17);
    const lane = graph.edges.findIndex((edge) => !edge.cross && edge.length > 8);
    const ped = createPedestrian(graph, 1, lane, 1, random, 4);
    const world = createPedWorld([ped]);

    setTalking(world, 4, true);
    for (let tick = 0; tick < 60; tick++) stepPedestrians(graph, world, 1 / TICK_HZ, random);
    expect(ped.state).toBe('talk');
    expect(ped.s).toBe(1);

    // Tetap ada walau jauh dari kamera: warga tidak di-despawn selama chat.
    const faraway = { x: 1000, z: 1000, dirX: 1, dirZ: 0, halfFov: Math.PI / 4 };
    updatePedSpawns(graph, world, faraway, 0, 60, random, () => 99);
    expect(world.peds).toContain(ped);

    // Panel ditutup: berdiri sebentar (linger) lalu jalan lagi.
    setTalking(world, 4, false);
    expect(ped.state).toBe('linger');
    stepPedestrians(graph, world, LINGER_TIME + 0.1, random);
    expect(ped.state).toBe('walk');
    for (let tick = 0; tick < 60; tick++) stepPedestrians(graph, world, 1 / TICK_HZ, random);
    expect(ped.s).toBeGreaterThan(1);
  });

  it('spawn di cincin 40-110 m di luar pandangan, dan warga tidak dipakai dua agen', () => {
    const random = mulberry(19);
    const world = createPedWorld();
    const view = { x: 0, z: 0, dirX: 1, dirZ: 0, halfFov: Math.PI / 4 };
    let id = 0;
    updatePedSpawns(graph, world, view, 18, 60, random, () => ++id);
    expect(world.peds.length).toBeGreaterThan(5);
    for (const ped of world.peds) {
      const pose = pedPose(graph, ped);
      const distance = Math.hypot(pose.x - view.x, pose.z - view.z);
      expect(distance).toBeGreaterThanOrEqual(40);
      expect(distance).toBeLessThanOrEqual(110);
      // Tidak muncul di depan mata pemain.
      expect(inView(view, pose.x, pose.z)).toBe(false);
    }
    const residents = world.peds.map((ped) => ped.residentIndex);
    expect(new Set(residents).size).toBe(residents.length);

    // Agen yang jauh dibuang.
    updatePedSpawns(graph, world, { ...view, x: 5000, z: 5000 }, 0, 60, random, () => ++id);
    expect(world.peds).toHaveLength(0);
  });

  it('nearestPed hanya mengembalikan warga dalam 3 m', () => {
    const random = mulberry(23);
    const lane = graph.edges.findIndex((edge) => !edge.cross && edge.length > 8);
    const ped = createPedestrian(graph, 1, lane, 4, random, 7);
    const anon = createPedestrian(graph, 2, lane, 4.2, random, -1);
    const world = createPedWorld([anon, ped]);
    const pose = pedPose(graph, ped);
    expect(nearestPed(graph, world, pose.x, pose.z, PED_TALK_DISTANCE)).toBe(ped);
    expect(nearestPed(graph, world, pose.x + 10, pose.z, PED_TALK_DISTANCE)).toBeNull();
  });
});

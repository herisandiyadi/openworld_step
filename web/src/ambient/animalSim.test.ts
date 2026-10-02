import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../world/worldGen';
import { type Animal, createAnimal, type Species, stepAnimal } from './animalSim';

const home = { x: 0, z: 0 };
const far = { x: 100, z: 100 };
const fixed = (value: number) => () => value;

function make(species: Species, state: Animal['state'] = 'idle'): Animal {
  return { ...createAnimal(species, home, fixed(0.5)), state, timer: 5 };
}

describe('simulasi hewan', () => {
  it('idle -> wander -> istirahat dalam radius 10-20 m', () => {
    const random = mulberry32(7);
    const cat = createAnimal('cat', home, random);
    expect(cat.radius).toBeGreaterThanOrEqual(10);
    expect(cat.radius).toBeLessThanOrEqual(20);
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      stepAnimal(cat, 0.1, far, random);
      seen.add(cat.state);
      expect(Math.hypot(cat.x, cat.z)).toBeLessThanOrEqual(cat.radius + 0.01);
    }
    expect(seen).toContain('wander');
    expect([...seen].some((state) => state === 'sit' || state === 'groom')).toBe(true);
  });

  it('kucing kabur saat pemain < 3 m, lalu kembali tenang', () => {
    const cat = make('cat', 'sit');
    stepAnimal(cat, 0.1, { x: 3.5, z: 0 }, fixed(0.5));
    expect(cat.state).toBe('sit');
    stepAnimal(cat, 0.1, { x: 2.5, z: 0 }, fixed(0.5));
    expect(cat.state).toBe('flee');
    const before = cat.x;
    stepAnimal(cat, 0.5, { x: 2.5, z: 0 }, fixed(0.5));
    expect(cat.x).toBeLessThan(before);
    for (let i = 0; i < 40; i++) stepAnimal(cat, 0.1, far, fixed(0.5));
    expect(cat.state).not.toBe('flee');
  });

  it('merpati peck -> fly saat pemain < 5 m -> land -> peck', () => {
    const pigeon = make('pigeon', 'peck');
    stepAnimal(pigeon, 0.1, { x: 4.5, z: 0 }, fixed(0.5));
    expect(pigeon.state).toBe('fly');
    for (let i = 0; i < 31; i++) stepAnimal(pigeon, 0.1, far, fixed(0.5));
    expect(pigeon.state).toBe('land');
    for (let i = 0; i < 11; i++) stepAnimal(pigeon, 0.1, far, fixed(0.5));
    expect(pigeon.state).toBe('peck');
  });

  it('anjing mengikuti pemain < 4 m dengan peluang 30%, sekali undi per pendekatan', () => {
    const lucky = make('dog');
    stepAnimal(lucky, 0.1, { x: 3, z: 0 }, fixed(0.29));
    expect(lucky.state).toBe('follow');
    expect(lucky.timer).toBeGreaterThanOrEqual(5);
    expect(lucky.timer).toBeLessThanOrEqual(8);

    const unlucky = make('dog');
    stepAnimal(unlucky, 0.1, { x: 3, z: 0 }, fixed(0.31));
    expect(unlucky.state).toBe('idle');
    stepAnimal(unlucky, 0.1, { x: 3, z: 0 }, fixed(0));
    expect(unlucky.state).toBe('idle');
    stepAnimal(unlucky, 0.1, far, fixed(0.5));
    stepAnimal(unlucky, 0.1, { x: 3, z: 0 }, fixed(0));
    expect(unlucky.state).toBe('follow');
  });

  it('peluang ikut anjing mendekati 30%', () => {
    const random = mulberry32(42);
    let follows = 0;
    for (let i = 0; i < 2000; i++) {
      const dog = make('dog');
      stepAnimal(dog, 0.1, { x: 3, z: 0 }, random);
      if (dog.state === 'follow') follows++;
    }
    expect(follows / 2000).toBeGreaterThan(0.25);
    expect(follows / 2000).toBeLessThan(0.35);
  });

  it('anjing berhenti mengikuti setelah waktunya habis lalu kembali ke wilayah', () => {
    const dog = make('dog');
    stepAnimal(dog, 0.1, { x: 3, z: 0 }, fixed(0));
    for (let i = 0; i < 60; i++) stepAnimal(dog, 0.1, { x: 3, z: 0 }, fixed(0));
    expect(dog.state).toBe('wander');
  });
});

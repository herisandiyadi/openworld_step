import { describe, expect, it } from 'vitest';
import { chordForBar, enginePitch, melodyChance, melodyNote, midiToFreq, musicTempo, PENTATONIC, PROGRESSION, strideLength } from './musicTheory';

describe('music theory', () => {
  it('converts MIDI notes to Hz', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 6);
    expect(midiToFreq(57)).toBeCloseTo(220, 6);
  });

  it('cycles the progression every 8 bars, two bars per chord', () => {
    expect(chordForBar(0)).toBe(PROGRESSION[0]);
    expect(chordForBar(1)).toBe(PROGRESSION[0]);
    expect(chordForBar(2)).toBe(PROGRESSION[1]);
    expect(chordForBar(8)).toBe(PROGRESSION[0]);
  });

  it('picks melody notes from the chord (octave up) or the pentatonic scale', () => {
    const chord = chordForBar(0);
    for (let step = 0; step < 20; step++) {
      const pick = step / 20;
      expect(chord.map((note) => note + 12)).toContain(melodyNote(chord, pick, 0.1));
      expect(PENTATONIC).toContain(melodyNote(chord, pick, 0.9));
    }
  });

  it('is calmer at night', () => {
    expect(musicTempo(1)).toBeGreaterThan(musicTempo(0));
    expect(melodyChance(1, 0)).toBeGreaterThan(melodyChance(0, 0));
    expect(melodyChance(1, 1)).toBeLessThan(melodyChance(1, 0));
  });

  it('idles at low speed and revs up within a gear', () => {
    expect(enginePitch(0, 'car')).toBe(38);
    expect(enginePitch(3, 'car')).toBeGreaterThan(enginePitch(1, 'car'));
    expect(enginePitch(15, 'moto')).toBeLessThan(55 + 120 * 1.6);
  });

  it('keeps strides in a sane range', () => {
    expect(strideLength(0)).toBe(0.9);
    expect(strideLength(4.5)).toBeCloseTo(1.7, 6);
    expect(strideLength(20)).toBe(1.8);
  });
});
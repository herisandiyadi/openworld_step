export type FishingSfxName = 'cast' | 'splash' | 'bite' | 'reel' | 'line-break' | 'catch';

export interface FishingSfxPlayer {
  readonly play: (sound: FishingSfxName, intensity?: number) => void;
  readonly dispose: () => void;
}

/**
 * Lightweight procedural fishing SFX. It accepts an existing AudioContext and
 * destination bus, so it shares the game's lifecycle/volume graph and never
 * creates an extra context. Returns a no-op player when Web Audio is unavailable.
 */
export function createFishingSfx(
  context: AudioContext | null,
  destination?: AudioNode,
  random: () => number = Math.random,
): FishingSfxPlayer {
  if (!context) return { play: () => undefined, dispose: () => undefined };
  let disposed = false;
  const active = new Set<AudioScheduledSourceNode>();

  const attach = (source: AudioScheduledSourceNode): void => {
    active.add(source);
    source.addEventListener('ended', () => active.delete(source), { once: true });
  };

  const gainEnvelope = (start: number, peak: number, duration: number): GainNode => {
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    gain.connect(destination ?? context.destination);
    return gain;
  };

  const tone = (frequency: number, duration: number, volume: number, type: OscillatorType = 'sine', slideTo?: number): void => {
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    if (slideTo !== undefined) oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), now + duration);
    oscillator.connect(gainEnvelope(now, volume, duration));
    attach(oscillator);
    oscillator.start(now);
    oscillator.stop(now + duration);
  };

  const noise = (duration: number, volume: number, frequency: number): void => {
    const now = context.currentTime;
    const length = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = random() * 2 - 1;
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = 0.8;
    source.connect(filter).connect(gainEnvelope(now, volume, duration));
    attach(source);
    source.start(now);
    source.stop(now + duration);
  };

  return {
    play(sound, intensity = 1) {
      if (disposed || context.state === 'closed') return;
      const amount = Math.max(0, Math.min(1, intensity));
      switch (sound) {
        case 'cast':
          noise(0.13, 0.08 * amount, 1100);
          break;
        case 'splash':
          noise(0.25, 0.12 * amount, 500);
          tone(150, 0.18, 0.035 * amount, 'sine', 70);
          break;
        case 'bite':
          tone(720, 0.09, 0.12 * amount, 'square', 980);
          break;
        case 'reel':
          tone(150 + random() * 35, 0.055, 0.025 * amount, 'sawtooth', 220);
          break;
        case 'line-break':
          noise(0.18, 0.1 * amount, 2500);
          tone(380, 0.12, 0.05 * amount, 'square', 80);
          break;
        case 'catch':
          tone(440, 0.12, 0.06 * amount, 'sine', 660);
          tone(660, 0.2, 0.045 * amount, 'sine', 880);
          break;
      }
    },
    dispose() {
      disposed = true;
      for (const source of active) {
        try {
          source.stop();
        } catch {
          // Source may already have stopped between iteration and stop().
        }
      }
      active.clear();
    },
  };
}

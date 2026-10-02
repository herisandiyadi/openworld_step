import { daylightAt } from '../game/dayCycle';
import { dayClock } from '../game/runtime';
import type { VehicleKind } from '../game/vehicles';
import type { MoveMode } from '../state/gameStore';
import { DEFAULT_AUDIO, type AudioSettings } from '../state/audioSettings';
import { chordForBar, enginePitch, melodyChance, melodyNote, midiToFreq, musicTempo, strideLength } from './musicTheory';

/**
 * Fully procedural audio (Web Audio API, no audio files): generative background music that follows the
 * day/night cycle, one-shot SFX, and two continuous loops (wheel roll noise, engine) driven by speed.
 * The context is created on the first user gesture (required by Android WebView / browsers).
 */

const MUSIC_LEVEL = 0.5;
const DUCK_LEVEL = 0.35;
const LOOKAHEAD_S = 0.8;
const SCHEDULER_MS = 200;
const SILENT = 0.0001;

interface Loops {
  rollGain: GainNode;
  rollFilter: BiquadFilterNode;
  engineGain: GainNode;
  engineFilter: BiquadFilterNode;
  engineMain: OscillatorNode;
  engineSub: OscillatorNode;
}

interface Graph {
  ctx: AudioContext;
  master: GainNode;
  musicBus: GainNode;
  musicFilter: BiquadFilterNode;
  delaySend: GainNode;
  sfxBus: GainNode;
  noise: AudioBuffer;
  loops: Loops;
}

function createGraph(ctx: AudioContext): Graph {
  const master = ctx.createGain();
  master.connect(ctx.destination);

  const musicFilter = ctx.createBiquadFilter();
  musicFilter.type = 'lowpass';
  musicFilter.frequency.value = 2000;
  musicFilter.connect(master);
  const musicBus = ctx.createGain();
  musicBus.gain.value = 0;
  musicBus.connect(musicFilter);

  // Simple feedback echo for the melody.
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.36;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.3;
  const wet = ctx.createGain();
  wet.gain.value = 0.4;
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(wet);
  wet.connect(musicBus);
  const delaySend = ctx.createGain();
  delaySend.connect(delay);

  const sfxBus = ctx.createGain();
  sfxBus.connect(master);

  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const samples = noise.getChannelData(0);
  for (let index = 0; index < samples.length; index++) samples[index] = Math.random() * 2 - 1;

  const roll = ctx.createBufferSource();
  roll.buffer = noise;
  roll.loop = true;
  const rollFilter = ctx.createBiquadFilter();
  rollFilter.type = 'bandpass';
  rollFilter.frequency.value = 700;
  rollFilter.Q.value = 0.8;
  const rollGain = ctx.createGain();
  rollGain.gain.value = 0;
  roll.connect(rollFilter).connect(rollGain).connect(sfxBus);
  roll.start();

  const engineFilter = ctx.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 900;
  const engineGain = ctx.createGain();
  engineGain.gain.value = 0;
  const engineMain = ctx.createOscillator();
  engineMain.type = 'sawtooth';
  engineMain.frequency.value = 50;
  const engineSub = ctx.createOscillator();
  engineSub.type = 'square';
  engineSub.frequency.value = 25;
  const subLevel = ctx.createGain();
  subLevel.gain.value = 0.5;
  engineMain.connect(engineFilter);
  engineSub.connect(subLevel).connect(engineFilter);
  engineFilter.connect(engineGain).connect(sfxBus);
  engineMain.start();
  engineSub.start();

  return {
    ctx,
    master,
    musicBus,
    musicFilter,
    delaySend,
    sfxBus,
    noise,
    loops: { rollGain, rollFilter, engineGain, engineFilter, engineMain, engineSub },
  };
}

class AudioEngine {
  private graph: Graph | null = null;
  private volumes: AudioSettings = DEFAULT_AUDIO;
  private ducked = false;
  private musicOn = false;
  private loopsActive = false;
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private nextBeat = 0;
  private beat = 0;
  private stepDistance = 0;

  /** Creates/resumes the AudioContext; call from a user gesture. */
  unlock(): void {
    if (!this.graph) {
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.graph = createGraph(new Ctor());
      } catch (error) {
        console.error('[audio] init', error);
        return;
      }
      this.applyVolumes();
    }
    const { ctx } = this.graph;
    if (ctx.state === 'suspended' && document.visibilityState === 'visible') ctx.resume().catch(() => undefined);
  }

  /** Suspend in the background (saves battery), resume when visible again. */
  onVisibility(): void {
    const ctx = this.graph?.ctx;
    if (!ctx) return;
    if (document.visibilityState === 'hidden') ctx.suspend().catch(() => undefined);
    else ctx.resume().catch(() => undefined);
  }

  setVolumes(volumes: AudioSettings): void {
    this.volumes = volumes;
    this.applyVolumes();
  }

  /** Lowers the music while a menu, chat, or map is open. */
  setDucked(ducked: boolean): void {
    if (ducked === this.ducked) return;
    this.ducked = ducked;
    this.applyVolumes();
  }

  /** Motion loops only run while the game loop runs (they would otherwise hang at the last speed). */
  setLoopsActive(active: boolean): void {
    this.loopsActive = active;
    if (active || !this.graph) return;
    const { ctx, loops } = this.graph;
    loops.rollGain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    loops.engineGain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    this.stepDistance = 0;
  }

  startMusic(): void {
    this.musicOn = true;
    this.applyVolumes();
    if (this.musicTimer !== null) return;
    this.nextBeat = 0;
    this.musicTimer = setInterval(() => this.schedule(), SCHEDULER_MS);
  }

  stopMusic(): void {
    this.musicOn = false;
    this.applyVolumes();
    if (this.musicTimer !== null) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  /** Called every frame with the player's smoothed speed (m/s). */
  updateMotion(mode: MoveMode, speed: number, dt: number, airborne: boolean): void {
    const graph = this.graph;
    if (!graph || !this.loopsActive || graph.ctx.state !== 'running') return;
    const { ctx, loops } = graph;
    const time = ctx.currentTime;
    let roll = 0;
    let rollFreq = 700;
    let engine = 0;

    if (mode === 'walk') {
      if (!airborne && speed > 0.5) {
        this.stepDistance += speed * dt;
        const stride = strideLength(speed);
        if (this.stepDistance >= stride) {
          this.stepDistance -= stride;
          this.footstep(speed > 3);
        }
      } else {
        this.stepDistance = 0;
      }
    } else if (mode === 'skate') {
      roll = airborne ? 0 : Math.min(0.45, speed * 0.055);
      rollFreq = 450 + speed * 70;
    } else if (mode === 'bike') {
      roll = Math.min(0.12, speed * 0.011);
      rollFreq = 2600;
    } else {
      engine = 0.1 + Math.min(0.12, speed * 0.008);
      const pitch = enginePitch(speed, mode);
      loops.engineMain.frequency.setTargetAtTime(pitch, time, 0.1);
      loops.engineSub.frequency.setTargetAtTime(pitch / 2, time, 0.1);
      loops.engineFilter.frequency.setTargetAtTime(500 + pitch * 6, time, 0.1);
    }
    loops.rollGain.gain.setTargetAtTime(roll, time, 0.08);
    loops.rollFilter.frequency.setTargetAtTime(rollFreq, time, 0.1);
    loops.engineGain.gain.setTargetAtTime(engine, time, 0.15);
  }

  // ---------- one-shot SFX ----------

  jump(): void {
    this.tone(300, 620, 0.16, 'square', 0.08);
    this.noiseBurst(0.08, 'highpass', 2500, 0.08);
  }

  land(): void {
    this.noiseBurst(0.12, 'lowpass', 420, 0.35);
    this.tone(120, 60, 0.12, 'sine', 0.2);
  }

  mount(kind: VehicleKind): void {
    if (kind === 'car') {
      this.noiseBurst(0.14, 'lowpass', 300, 0.4);
      this.tone(55, 110, 0.6, 'sawtooth', 0.09, 0.15);
    } else if (kind === 'moto') {
      this.tone(70, 180, 0.45, 'sawtooth', 0.1);
      this.tone(180, 90, 0.3, 'sawtooth', 0.07, 0.45);
    } else if (kind === 'bike') {
      this.tone(1800, 1800, 0.45, 'sine', 0.1);
      this.tone(2400, 2400, 0.35, 'sine', 0.05);
    } else {
      this.noiseBurst(0.05, 'highpass', 2000, 0.3);
      this.tone(220, 160, 0.06, 'square', 0.06);
    }
  }

  dismount(): void {
    this.tone(400, 250, 0.12, 'triangle', 0.1);
    this.noiseBurst(0.08, 'lowpass', 500, 0.2, 0.05);
  }

  click(): void {
    this.tone(900, 900, 0.04, 'triangle', 0.07);
  }

  send(): void {
    this.tone(660, 880, 0.08, 'sine', 0.08);
  }

  message(): void {
    this.tone(880, 880, 0.18, 'sine', 0.08);
    this.tone(1320, 1320, 0.25, 'sine', 0.07, 0.12);
  }

  bus(): void {
    this.tone(233, 233, 0.5, 'square', 0.05);
    this.tone(294, 294, 0.5, 'square', 0.05);
    this.noiseBurst(0.45, 'highpass', 3000, 0.12, 0.55);
  }

  quest(): void {
    [72, 76, 79, 84].forEach((note, index) => this.tone(midiToFreq(note), midiToFreq(note), 0.3, 'triangle', 0.09, index * 0.1));
  }

  private footstep(running: boolean): void {
    this.noiseBurst(0.06, 'lowpass', 500 + Math.random() * 300, running ? 0.26 : 0.18);
  }

  // ---------- synthesis helpers ----------

  private tone(freq: number, endFreq: number, duration: number, type: OscillatorType, level: number, delay = 0): void {
    const graph = this.graph;
    if (!graph || graph.ctx.state !== 'running') return;
    const { ctx } = graph;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (endFreq !== freq) osc.frequency.exponentialRampToValueAtTime(endFreq, start + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(SILENT, start);
    gain.gain.exponentialRampToValueAtTime(level, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(SILENT, start + duration);
    osc.connect(gain).connect(graph.sfxBus);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  private noiseBurst(duration: number, type: BiquadFilterType, freq: number, level: number, delay = 0): void {
    const graph = this.graph;
    if (!graph || graph.ctx.state !== 'running') return;
    const { ctx } = graph;
    const start = ctx.currentTime + delay;
    const source = ctx.createBufferSource();
    source.buffer = graph.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, start);
    gain.gain.exponentialRampToValueAtTime(SILENT, start + duration);
    source.connect(filter).connect(gain).connect(graph.sfxBus);
    source.start(start, Math.random() * 1.5, duration + 0.05);
  }

  /** Scheduled music voice with an attack / hold / release envelope. */
  private voice(freq: number, start: number, attack: number, hold: number, release: number, type: OscillatorType, level: number, echo: boolean): void {
    const graph = this.graph;
    if (!graph) return;
    const { ctx } = graph;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    const end = start + attack + Math.max(0, hold) + release;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(level, start + attack);
    gain.gain.setValueAtTime(level, start + attack + Math.max(0, hold));
    gain.gain.linearRampToValueAtTime(0, end);
    osc.connect(gain);
    gain.connect(graph.musicBus);
    if (echo) gain.connect(graph.delaySend);
    osc.start(start);
    osc.stop(end + 0.05);
  }

  // ---------- music scheduler (look-ahead) ----------

  private schedule(): void {
    const graph = this.graph;
    if (!graph || !this.musicOn || graph.ctx.state !== 'running') return;
    const { ctx } = graph;
    const { daylight } = daylightAt(dayClock.t);
    const beatSeconds = 60 / musicTempo(daylight);
    graph.musicFilter.frequency.setTargetAtTime(600 + 2000 * daylight, ctx.currentTime, 2);
    // After a stall (timer throttled, context resumed) restart slightly ahead instead of catching up.
    if (this.nextBeat < ctx.currentTime - 0.1) this.nextBeat = ctx.currentTime + 0.05;
    while (this.nextBeat < ctx.currentTime + LOOKAHEAD_S) {
      this.playBeat(this.beat, this.nextBeat, beatSeconds, daylight);
      this.nextBeat += beatSeconds;
      this.beat++;
    }
  }

  private playBeat(index: number, time: number, beatSeconds: number, daylight: number): void {
    const chord = chordForBar(Math.floor(index / 4));
    if (index % 8 === 0) {
      for (const note of chord) this.voice(midiToFreq(note), time, 1.2, beatSeconds * 8 - 1.2, 1.8, 'triangle', 0.045, false);
    }
    if (index % 4 === 0) {
      this.voice(midiToFreq((chord[0] ?? 60) - 24), time, 0.05, beatSeconds * 2.5, 0.8, 'sine', 0.14, false);
    }
    if (Math.random() < melodyChance(daylight, index % 4)) {
      this.voice(midiToFreq(melodyNote(chord, Math.random(), Math.random())), time, 0.01, 0.05, 1.1, 'sine', 0.07, true);
    }
  }

  private applyVolumes(): void {
    const graph = this.graph;
    if (!graph) return;
    const time = graph.ctx.currentTime;
    graph.master.gain.setTargetAtTime(this.volumes.muted ? 0 : 1, time, 0.05);
    const music = this.musicOn ? this.volumes.music * MUSIC_LEVEL * (this.ducked ? DUCK_LEVEL : 1) : 0;
    graph.musicBus.gain.setTargetAtTime(music, time, 0.4);
    graph.sfxBus.gain.setTargetAtTime(this.volumes.sfx, time, 0.05);
  }
}

export const audio = new AudioEngine();
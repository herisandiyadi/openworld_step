/**
 * Audio ambient kota (NEXT_FEATURES 3.6): bed hum lalu lintas, gumam kerumunan, dan burung,
 * ditambah bunyi sekali jalan (klakson, mesin lewat, meong, gonggong, kepak sayap).
 * Semua dibangkitkan prosedural dengan Web Audio, tanpa file audio dan tanpa dependensi baru.
 *
 * Bagian hitungan (gain, pan, doppler, pemilihan bunyi) murni dan diuji; kelas `AmbientAudio`
 * hanya membungkusnya ke Web Audio dan tidak aktif saat tidak ada `window` (unit test, SSR).
 */
import type { DistrictId } from '../world/worldSpec';
import { hourOf, isNight } from '../ambient/density';
import { audio } from './audioEngine';
import { ambientRuntime, type AmbientAgent } from '../ambient/ambientRuntime';

/** Maksimum bunyi ambient sekali jalan yang berbunyi bersamaan (NEXT_FEATURES 3.6). */
export const MAX_VOICES = 6;
/** Jarak pendengaran bunyi ambient (m). Di luar ini gain 0. */
export const AUDIBLE_RANGE = 60;
/** Kecepatan suara (m/s) untuk doppler sederhana. */
const SOUND_SPEED = 343;

export type CueKind = 'horn' | 'pass' | 'meow' | 'bark' | 'wings';

export interface Listener {
  x: number;
  z: number;
  /** Arah pandang kamera (tidak perlu unit). */
  dirX: number;
  dirZ: number;
}

/** Gain jarak (1 di telinga, 0 di AUDIBLE_RANGE) dan pan stereo (-1 kiri, +1 kanan). */
export function spatial(listener: Listener, x: number, z: number): { gain: number; pan: number } {
  const dx = x - listener.x;
  const dz = z - listener.z;
  const distance = Math.hypot(dx, dz);
  if (distance >= AUDIBLE_RANGE) return { gain: 0, pan: 0 };
  // Peluruhan 1/(1+d/8) dipotong halus ke 0 di tepi jangkauan supaya tidak ada klik.
  const near = 1 / (1 + distance / 8);
  const gain = near * (1 - distance / AUDIBLE_RANGE);
  const length = Math.hypot(listener.dirX, listener.dirZ) || 1;
  // Vektor kanan untuk arah pandang (dirX, dirZ) dengan Y ke atas = (-dirZ, dirX).
  const right = (-listener.dirZ * dx + listener.dirX * dz) / length;
  const pan = distance < 1e-6 ? 0 : Math.max(-1, Math.min(1, right / distance));
  return { gain, pan };
}

/** Doppler sederhana: sumber mendekat (radialSpeed < 0) naik pitch, menjauh turun. */
export function dopplerPitch(baseFreq: number, radialSpeed: number): number {
  const ratio = SOUND_SPEED / Math.max(1, SOUND_SPEED + Math.max(-60, Math.min(60, radialSpeed)));
  return baseFreq * ratio;
}

export interface BedLevels {
  traffic: number;
  crowd: number;
  birds: number;
}

/** Tingkat bed per kawasan dan jam. Malam: lalu lintas dan kerumunan turun, burung hampir diam. */
export function bedLevels(district: DistrictId | null, t: number): BedLevels {
  const base: Record<DistrictId, BedLevels> = {
    downtown: { traffic: 1, crowd: 1, birds: 0.5 },
    residential: { traffic: 0.35, crowd: 0.4, birds: 1 },
    industrial: { traffic: 0.7, crowd: 0.1, birds: 0.2 },
  };
  const level = district ? base[district] : { traffic: 0.3, crowd: 0.2, birds: 0.4 };
  const hour = hourOf(t);
  const night = isNight(t);
  // Jam sibuk pagi (7-9) dan sore (16-18) menambah lalu lintas.
  const rush = (hour >= 7 && hour < 9) || (hour >= 16 && hour < 19) ? 1.25 : 1;
  // Burung paling ramai pagi 5-9, diam saat malam.
  const birdTime = night ? 0.05 : hour >= 5 && hour < 9 ? 1 : 0.5;
  return {
    traffic: level.traffic * rush * (night ? 0.35 : 1),
    crowd: level.crowd * (night ? 0.25 : 1),
    birds: level.birds * birdTime,
  };
}

/** Peluang per detik tiap bunyi sekali jalan muncul, per kawasan dan jam. */
export function cueChance(district: DistrictId | null, t: number): Record<CueKind, number> {
  const levels = bedLevels(district, t);
  const residential = district === 'residential';
  return {
    horn: 0.25 * levels.traffic,
    pass: 0.5 * levels.traffic,
    meow: residential ? 0.08 : 0.03,
    bark: residential ? 0.1 : 0.02,
    wings: 0.2 * levels.birds,
  };
}

/** Pilih satu bunyi sekali jalan untuk selang `dt` detik, atau undefined kalau hening. */
export function pickCue(district: DistrictId | null, t: number, dt: number, random: () => number): CueKind | undefined {
  const chance = cueChance(district, t);
  for (const kind of Object.keys(chance) as CueKind[]) {
    if (random() < (chance[kind] ?? 0) * dt) return kind;
  }
  return undefined;
}

/**
 * Posisi cue dari agen nyata: klakson/mesin dari kendaraan, sisanya dari pejalan kaki.
 * Dipilih acak di antara agen yang terdengar (reservoir, tanpa alokasi). Undefined kalau tidak ada.
 */
export function cueSource(
  kind: CueKind,
  listener: Listener,
  vehicles: readonly AmbientAgent[],
  peds: readonly AmbientAgent[],
  random: () => number,
): { gain: number; pan: number } | undefined {
  const traffic = kind === 'horn' || kind === 'pass';
  let picked: { gain: number; pan: number } | undefined;
  let audible = 0;
  for (const agent of traffic ? vehicles : peds) {
    const s = spatial(listener, agent.x, agent.z);
    if (s.gain > 0 && random() * ++audible < 1) picked = s;
  }
  if (picked || traffic) return picked;
  // ponytail: belum ada agen hewan, jadi meong/gonggong/kepak tanpa pejalan terdekat jatuh ke
  // cincin acak 10-50 m. Ganti dengan daftar hewan di ambientRuntime saat lapisan hewan ada.
  const angle = random() * Math.PI * 2;
  const distance = 10 + random() * 40;
  return spatial(listener, listener.x + Math.cos(angle) * distance, listener.z + Math.sin(angle) * distance);
}

// ---------- pembungkus Web Audio ----------

interface Bed {
  traffic: GainNode;
  crowd: GainNode;
  birds: GainNode;
}

const SILENT = 0.0001;
/** Skala akhir supaya bed tidak menutupi musik dan SFX pemain. */
const BED_LEVEL = 0.12;
const CUE_LEVEL = 0.35;

/** Node ambient menumpang AudioContext dan sfxBus audioEngine: volume SFX, mute, dan suspend latar belakang ikut dari sana. */
class AmbientAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bed: Bed | null = null;
  private noise: AudioBuffer | null = null;
  private voices = 0;
  private cueTimer = 0;

  /** Menunggu audioEngine dibuka gestur pengguna; aman dipanggil berulang. */
  private ensure(): boolean {
    if (!this.ctx) {
      const out = audio.output;
      if (!out) return false;
      this.ctx = out.ctx;
      this.noise = out.noise;
      this.master = out.ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(out.sfxBus);
      this.bed = {
        traffic: this.loop(out.noise, 'lowpass', 220, 0.9),
        crowd: this.loop(out.noise, 'bandpass', 620, 1.4),
        birds: this.loop(out.noise, 'highpass', 3600, 0.7),
      };
    }
    return this.ctx.state === 'running';
  }

  private loop(noise: AudioBuffer, type: BiquadFilterType, freq: number, q: number): GainNode {
    const ctx = this.ctx as AudioContext;
    const source = ctx.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(filter).connect(gain).connect(this.master as GainNode);
    source.start();
    return gain;
  }

  /** Dipanggil tiap frame: setel bed sesuai kawasan/jam dan kadang bunyikan satu cue. */
  update(district: DistrictId | null, t: number, dt: number, active: boolean, listener?: Listener): void {
    if (!this.ensure() || !this.ctx || !this.master || !this.bed) return;
    const time = this.ctx.currentTime;
    // Hanya fade aktif/jeda; volume SFX dan mute sudah diterapkan sfxBus/master audioEngine.
    this.master.gain.setTargetAtTime(active ? 1 : 0, time, 0.4);
    if (!active) return;
    const levels = bedLevels(district, t);
    this.bed.traffic.gain.setTargetAtTime(levels.traffic * BED_LEVEL, time, 1.5);
    this.bed.crowd.gain.setTargetAtTime(levels.crowd * BED_LEVEL * 0.7, time, 1.5);
    this.bed.birds.gain.setTargetAtTime(levels.birds * BED_LEVEL * 0.25, time, 1.5);

    // Cue dicoba 4x per detik supaya peluang per detik di cueChance tetap akurat.
    this.cueTimer += dt;
    if (this.cueTimer < 0.25) return;
    const step = this.cueTimer;
    this.cueTimer = 0;
    const kind = pickCue(district, t, step, Math.random);
    if (!kind || !listener) return;
    // ponytail: AmbientAgent hanya punya laju skalar (tanpa arah), jadi doppler radial dilewati (0).
    const source = cueSource(kind, listener, ambientRuntime.vehicles, ambientRuntime.peds, Math.random);
    if (source) this.playCue(kind, source.gain, source.pan);
  }

  /** Bunyi sekali jalan di posisi stereo tertentu; dibatasi MAX_VOICES suara bersamaan. */
  playCue(kind: CueKind, gain: number, pan: number, radialSpeed = 0): void {
    if (!this.ensure() || !this.ctx || this.voices >= MAX_VOICES || gain <= 0) return;
    const ctx = this.ctx;
    const panner = ctx.createStereoPanner?.();
    const out = ctx.createGain();
    out.gain.value = Math.min(1, gain) * CUE_LEVEL;
    if (panner) {
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      out.connect(panner).connect(this.master as GainNode);
    } else {
      out.connect(this.master as GainNode);
    }
    this.voices++;
    const release = (duration: number) => {
      window.setTimeout(() => {
        this.voices = Math.max(0, this.voices - 1);
        out.disconnect();
        panner?.disconnect();
      }, (duration + 0.2) * 1000);
    };

    if (kind === 'horn') {
      this.tone(out, dopplerPitch(420, radialSpeed), 0.35, 'square', 0.5);
      this.tone(out, dopplerPitch(560, radialSpeed), 0.35, 'square', 0.3);
      release(0.4);
    } else if (kind === 'pass') {
      // Mesin lewat: noise lowpass naik lalu turun, pitch mengikuti doppler.
      this.sweep(out, dopplerPitch(300, -8), dopplerPitch(180, 8), 1.4);
      release(1.4);
    } else if (kind === 'meow') {
      this.tone(out, 700, 0.18, 'sawtooth', 0.25, 900);
      release(0.3);
    } else if (kind === 'bark') {
      this.tone(out, 220, 0.12, 'square', 0.4, 120);
      this.tone(out, 240, 0.1, 'square', 0.3, 130, 0.22);
      release(0.4);
    } else {
      // Kepak sayap: tiga semburan noise pendek.
      for (let i = 0; i < 3; i++) this.burst(out, 0.07, 1200, 0.5, i * 0.12);
      release(0.4);
    }
  }

  private tone(out: GainNode, freq: number, duration: number, type: OscillatorType, level: number, endFreq = freq, delay = 0): void {
    const ctx = this.ctx as AudioContext;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (endFreq !== freq) osc.frequency.exponentialRampToValueAtTime(endFreq, start + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(SILENT, start);
    gain.gain.exponentialRampToValueAtTime(level, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(SILENT, start + duration);
    osc.connect(gain).connect(out);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  private burst(out: GainNode, duration: number, freq: number, level: number, delay = 0): void {
    const ctx = this.ctx as AudioContext;
    if (!this.noise) return;
    const start = ctx.currentTime + delay;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, start);
    gain.gain.exponentialRampToValueAtTime(SILENT, start + duration);
    source.connect(filter).connect(gain).connect(out);
    source.start(start, Math.random() * 1.5, duration + 0.05);
  }

  private sweep(out: GainNode, fromFreq: number, toFreq: number, duration: number): void {
    const ctx = this.ctx as AudioContext;
    if (!this.noise) return;
    const start = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(fromFreq, start);
    filter.frequency.linearRampToValueAtTime(toFreq, start + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(SILENT, start);
    gain.gain.linearRampToValueAtTime(0.6, start + duration * 0.4);
    gain.gain.exponentialRampToValueAtTime(SILENT, start + duration);
    source.connect(filter).connect(gain).connect(out);
    source.start(start, Math.random() * 1.5);
    source.stop(start + duration + 0.05);
  }
}

export const ambientAudio = new AmbientAudio();

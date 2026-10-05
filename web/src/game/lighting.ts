/**
 * Satu konfigurasi lighting untuk siang, dusk, dan malam — VISUAL_UPGRADE_TASKS §2-§4.
 * Modul murni (tanpa three/WebGL) supaya bisa diuji tanpa GPU.
 */
import { daylightAt } from './dayCycle';

export type LightingState = 'day' | 'dusk' | 'night';

export interface LightingProfile {
  /** Intensitas key light (matahari siang / bulan malam). */
  sunIntensity: number;
  /** Hemisphere fill supaya shadow-side tidak jadi hitam. */
  hemisphereIntensity: number;
  /** Warna langit untuk hemisphere light. */
  skyColor: string;
  /** Warna pantulan tanah untuk hemisphere light. */
  groundColor: string;
  /** Warna key light. */
  sunColor: string;
  /** Intensitas pool lampu jalan (0 = mati). */
  streetLightIntensity: number;
  /** Warm amber untuk lampu jalan. */
  streetLightColor: string;
  /** Budget keras: hanya satu light yang cast shadow. */
  shadowCasters: 1;
}

/** Ambang elevasi matahari: dusk adalah pita sempit di sekitar horizon. */
const DUSK_BAND = 0.18;
const DAY_EDGE = 0.1;

/** t dalam [0,1): 0 = tengah malam, 0.25 = matahari terbit, 0.5 = siang. */
export function timeState(t: number): LightingState {
  const elevation = Math.sin(2 * Math.PI * (((t % 1) + 1) % 1 - 0.25));
  if (elevation > DUSK_BAND) return 'day';
  if (elevation > -DAY_EDGE) return 'dusk';
  return 'night';
}

const PROFILES: Readonly<Record<LightingState, LightingProfile>> = {
  day: {
    sunIntensity: 2.2,
    hemisphereIntensity: 0.9,
    skyColor: '#cfe4f7',
    groundColor: '#8a8f78',
    sunColor: '#fff4e2',
    streetLightIntensity: 0,
    streetLightColor: '#ffb45c',
    shadowCasters: 1,
  },
  dusk: {
    sunIntensity: 1.1,
    hemisphereIntensity: 0.6,
    skyColor: '#f2b183',
    groundColor: '#54504f',
    sunColor: '#ff9f5a',
    streetLightIntensity: 0.9,
    streetLightColor: '#ffb45c',
    shadowCasters: 1,
  },
  night: {
    // Moon/key fill keeps the player and road readable at midnight without flattening daylight contrast.
    sunIntensity: 0.55,
    hemisphereIntensity: 1.05,
    skyColor: '#2a3a63',
    groundColor: '#12161f',
    sunColor: '#9fb6e8',
    streetLightIntensity: 1.6,
    streetLightColor: '#ffb45c',
    shadowCasters: 1,
  },
};

export function lightingFor(state: LightingState): LightingProfile {
  return PROFILES[state];
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Minimum readable key-light intensity used for player/road visibility at night. */
export function keyLightIntensity(daylight: number): number {
  const normalized = Number.isFinite(daylight) ? Math.min(1, Math.max(0, daylight)) : 0;
  return mix(PROFILES.night.sunIntensity, PROFILES.day.sunIntensity, normalized);
}

/** Nilai lighting yang sudah diblend — dipakai per frame supaya transisi tidak pop. */
export interface LightingSample {
  state: LightingState;
  sunIntensity: number;
  hemisphereIntensity: number;
  /** Intensitas pool lampu jalan / emissive praktis. */
  streetLight: number;
  /** 0 = malam total, 1 = siang penuh. */
  daylight: number;
  /** Bobot warna dusk (0..1). */
  dusk: number;
}

/**
 * Blend profil day/dusk/night mengikuti elevasi matahari.
 * Semua nilai kontinu terhadap t, jadi tidak ada lompatan saat state berganti.
 */
export function lightingAt(t: number): LightingSample {
  // Satu kurva siang/malam untuk seluruh game: sama dengan HUD/audio (dayCycle).
  const { daylight, dusk } = daylightAt((((t % 1) + 1) % 1));
  const day = PROFILES.day;
  const night = PROFILES.night;
  return {
    state: timeState(t),
    sunIntensity: mix(night.sunIntensity, day.sunIntensity, daylight),
    hemisphereIntensity: mix(night.hemisphereIntensity, day.hemisphereIntensity, daylight),
    // Lampu jalan padam penuh begitu siang, menyala penuh saat gelap.
    streetLight: mix(night.streetLightIntensity, 0, daylight),
    daylight,
    dusk,
  };
}

export interface ShadowFitInput {
  /** Setengah lebar area gameplay aktif (m) yang harus masuk shadow map. */
  radius: number;
  /** Resolusi shadow map (px). */
  mapSize: number;
  focusX: number;
  focusZ: number;
}

export interface ShadowFit {
  halfExtent: number;
  near: number;
  far: number;
  /** Pusat shadow camera, di-snap ke grid texel supaya tepi shadow tidak bergetar. */
  focusX: number;
  focusZ: number;
}

/** Fit shadow camera ke area aktif saja; frustum besar membuang resolusi shadow map. */
export function fitShadowCamera({ radius, mapSize, focusX, focusZ }: ShadowFitInput): ShadowFit {
  const texel = (2 * radius) / Math.max(1, mapSize);
  const snap = (value: number) => Math.round(value / texel) * texel;
  return {
    halfExtent: radius,
    near: 1,
    // Cukup untuk ketinggian light + kedalaman area, jauh di bawah far kamera (220 m).
    far: Math.min(100, radius * 4 + 20),
    focusX: snap(focusX),
    focusZ: snap(focusZ),
  };
}

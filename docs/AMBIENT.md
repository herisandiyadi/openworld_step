# Sistem Ambient Kota

Catatan teknis untuk sistem yang membuat kota terasa hidup: lalu lintas, pejalan kaki, hewan, audio
ambient, suasana malam, dan sapaan warga. Semua jam mengikuti satu sumber: `dayClock.t` di
`src/game/runtime.ts` (0 = tengah malam, 0.5 = tengah hari), dimajukan oleh `src/game/DayNight.tsx`.

## Modul

| Modul | Isi |
| --- | --- |
| `src/ambient/laneGraph.ts` | Graf lajur hasil bake (`public/world/lanes.json`): simpul, edge lajur, dan persimpangan. |
| `src/ambient/trafficSim.ts` | Kendaraan mengikuti edge, jaga jarak, reservasi persimpangan. |
| `src/ambient/spawner.ts` | Cincin spawn 40-110 m di luar frustum, despawn di luar 130 m, pool per preset. |
| `src/ambient/density.ts` | `DENSITY` per kawasan, `densityAt(district, kind, t)`, `isNight`, `NIGHT_FACTOR`. |
| `src/ambient/residents.ts` | 60 warga tetap deterministik, persona, dan `residentActivity(resident, t)`. |
| `src/ambient/animalSim.ts` | Mesin keadaan kucing, anjing, dan merpati. |
| `src/ambient/greetings.ts` | Pemilihan teks sapaan (murni, deterministik). |
| `src/ambient/GreetingBubbles.tsx` | Gelembung sapaan di atas warga terdekat. |
| `src/audio/ambientAudio.ts` | Bed ambient + bunyi sekali jalan, prosedural (tanpa file audio). |
| `src/state/graphicsSettings.ts` | Preset kepadatan yang dipilih pemain, disimpan di perangkat. |

## Preset kepadatan

Pengaturan → "Keramaian kota". Nilainya adalah `GraphicsPreset` dari `spawner.ts`, jadi langsung
dipakai `updateSpawns`. Disimpan di Capacitor Preferences dengan kunci `graphics_settings_v1`;
nilai tidak sah jatuh ke `medium` (`normalizeGraphics`).

| Preset | Label UI | Kendaraan (`VEHICLE_POOL`) |
| --- | --- | --- |
| `low` | Sepi | 8 |
| `medium` | Normal | 14 |
| `high` | Ramai | 20 |

Target pool pejalan kaki, hewan, dan merpati ada di `NEXT_FEATURES.md` 3.4. Preset ini terpisah dari
preset grafis `quality` di `gameStore.ts` (DPR dan bayangan).

## Audio ambient

Dibangkitkan dengan Web Audio, gaya sama seperti `audioEngine.ts`: tidak ada file audio dan tidak ada
dependensi baru. Dua lapis:

- **Bed** (loop noise terfilter): `traffic` lowpass 220 Hz, `crowd` bandpass 620 Hz, `birds` highpass
  3.6 kHz. Tingkatnya dari `bedLevels(district, t)`: Pusat Kota paling ramai, Perumahan paling
  banyak burung, Kawasan Industri hampir tanpa kerumunan. Jam sibuk 7-9 dan 16-19 menambah lalu
  lintas 25%; malam (lihat `isNight`) menurunkan lalu lintas ke 35%, kerumunan ke 25%, burung ke 5%.
- **Bunyi sekali jalan**: `horn`, `pass` (mesin lewat dengan doppler), `meow`, `bark`, `wings`.
  Peluang per detik dari `cueChance`; `pickCue` diundi 4x per detik. Maksimum `MAX_VOICES` = 6 suara
  bersamaan. `spatial(listener, x, z)` memberi gain (1 di telinga, 0 di `AUDIBLE_RANGE` = 60 m) dan
  pan stereo; `dopplerPitch(freq, radialSpeed)` menaikkan pitch saat sumber mendekat.

Volume mengikuti `audioSettings.ts` (`muted` dan `sfx`); bed dibungkam saat peta terbuka dan
`AudioContext` disuspend saat aplikasi ke latar belakang.

## Suasana malam

`DayNight.tsx` memakai `daylightAt(dayClock.t)`. Selain warna langit/fog (fase A, 60-140 m, tidak
diubah):

- Material bohlam (emissive putih/kuning pucat `PALETTE.lamp`: lampu jalan, lampu kendaraan)
  dinaikkan `emissiveIntensity` ke `LAMP_NIGHT` = 2.2 saat gelap total. Node `lamp_*` lampu lalu
  lintas dilewati karena emissive-nya milik pengendali lampu lalu lintas.
- Material gedung diberi emissive hangat `#ffd9a0` sebesar `WINDOW_NIGHT` = 0.22 saat malam.
- Scene dipindai ulang tiap 2 detik karena chunk baru terus di-stream masuk.

## Sapaan warga

Murni di `greetings.ts`, tanpa AI dan tanpa permintaan jaringan:

- Teks dipilih per jendela waktu (`timeBand`: pagi 5-10, siang 10-15, sore 15-18, malam 18-5) plus
  sapaan netral. Warga `pendiam`/`lelah` menyapa lebih singkat; sapaan "Mas" jadi "Mbak" kalau
  pemain perempuan.
- Deterministik: seed dari id warga + nomor slot (`floor(now / GREET_COOLDOWN)`), jadi teks stabil
  selama gelembung tampil.
- Syarat: jarak <= `GREET_DISTANCE` 6 m, cooldown `GREET_COOLDOWN` 25 detik per warga, peluang
  `GREET_CHANCE` 0.35, maksimum `MAX_BUBBLES` 3 gelembung, tampil `GREET_SECONDS` 2.5 detik.
- Aksesibilitas: teks yang sama diumumkan di live region `aria-live="polite"`, jadi gelembung bukan
  satu-satunya kanal.

## Tombol penyetelan

| Knob | Lokasi | Pengaruh |
| --- | --- | --- |
| `VEHICLE_POOL` | `spawner.ts` | Jumlah kendaraan hidup per preset. |
| `SPAWN_MIN` / `SPAWN_MAX` / `DESPAWN` | `spawner.ts` | Lebar cincin agen. |
| `DENSITY`, `NIGHT_FACTOR` | `density.ts` | Agen per chunk per kawasan dan penurunan malam. |
| `bedLevels`, `cueChance` | `ambientAudio.ts` | Ciri suara tiap kawasan dan kerapatan bunyi. |
| `MAX_VOICES`, `AUDIBLE_RANGE` | `ambientAudio.ts` | Batas suara bersamaan dan jangkauan dengar. |
| `LAMP_NIGHT`, `WINDOW_NIGHT` | `DayNight.tsx` | Terang lampu jalan dan jendela saat malam. |
| `GREET_*`, `MAX_BUBBLES` | `greetings.ts` | Kerapatan dan lama sapaan. |

## Anggaran performa

Dari `prompt.md` dan `NEXT_FEATURES.md`: ambient <= 30 draw call, <= 40k segitiga, simulasi <= 1.5 ms
per frame di perangkat mid-range. Pengukuran per preset di HP adalah tugas D5 (butuh perangkat fisik,
belum dijalankan).

## Uji

`npx vitest run` di `web/`. Berkas uji yang relevan: `ambient/density.test.ts`,
`ambient/greetings.test.ts`, `ambient/spawner.test.ts`, `ambient/trafficSim.test.ts`,
`ambient/residents.test.ts`, `ambient/animalSim.test.ts`, `audio/ambientAudio.test.ts`,
`state/graphicsSettings.test.ts`.

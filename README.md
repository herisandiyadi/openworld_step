# Openworld City

Game 3D open world kota untuk Android, dibangun dengan three.js (React Three Fiber) dan dibungkus Capacitor.
Satu pemain, tanpa musuh. Pemain menjelajah kota, naik kendaraan, dan ngobrol bebas dengan warga (NPC)
yang dijawab oleh model AI melalui endpoint yang kompatibel dengan OpenAI.

Kode game ada di folder [`web/`](web/). Folder `scenes/`, `scripts/`, dan `project.godot` adalah prototipe
Godot lama dan tidak dipakai lagi.

## Fitur

- Kota 512 x 512 m dengan tiga kawasan: Pusat Kota, Perumahan, dan Kawasan Industri.
- Chunk streaming (64 m per chunk) lewat web worker, terrain heightmap, prop instanced, dan navmesh Recast.
- Kontrol gaya MOBA: kamera isometrik, tap-to-move dengan pathfinding, dan joystick virtual.
- Tombol aksi kanan bawah: Lompat (selalu ada), lalu Naik/Turun, Tanya, dan Bus yang muncul sesuai konteks.
- Defaultnya jalan kaki. Skateboard, sepeda, motor, dan mobil bisa dipakai kalau ada di dekat pemain.
- Halte bus untuk fast travel ke lima area kota.
- Username diminta sekali setelah install dan disimpan di database SQLite perangkat (`openworld.db`, plugin native `PlayerDbPlugin`).
  NPC memanggil pemain dengan nama itu. Bisa diganti lewat "Ganti nama" di menu awal.
- Chat teks bebas dengan 5 NPC yang punya persona masing-masing. Balasan di-stream (SSE).
- Quest "kenalan dengan warga", fog of war di minimap dan peta besar, serta siklus siang-malam.
- Save/load otomatis (posisi, kendaraan, quest, area terjelajahi, jam) via Capacitor Preferences.
- Audio prosedural (Web Audio API, tanpa file audio): BGM generatif yang lebih tenang di malam hari, langkah kaki,
  suara roda skateboard/sepeda, mesin motor/mobil yang ikut kecepatan, serta SFX lompat, naik/turun, chat, bus, dan quest.
  Volume musik dan efek serta tombol bisu ada di menu jeda dan Pengaturan.
- Menu awal (Mulai/Lanjutkan, Main baru, Pengaturan), menu jeda, preset grafis, dan uji performa bawaan.

## Kontrol

| Aksi | Layar sentuh | Keyboard (dev) |
| --- | --- | --- |
| Gerak | Joystick kiri atau tap di tanah | WASD / panah, klik |
| Lompat | Tombol besar Lompat | Space |
| Naik / turun kendaraan | Tombol Naik / Turun | E |
| Tanya NPC | Tombol Tanya | Q |
| Naik bus | Tombol Bus (di halte) | B |
| Peta besar | Tap minimap | - |

## Pengaturan AI

Isi di menu **Pengaturan** sebelum masuk game:

- Base URL, misalnya `http://host:port/v1` (OpenAI-compatible, memakai `/chat/completions` dan `/models`)
- API key (Bearer)
- Model, misalnya `cbai`

API key hanya disimpan di perangkat dan tidak ada di repo atau APK. Di Android, request dikirim lewat
kode native (`AiStreamPlugin` untuk streaming, `CapacitorHttp` untuk tes koneksi), jadi tidak terkena
CORS preflight. Aplikasi mengizinkan HTTP biasa (cleartext) supaya bisa memakai endpoint di LAN, tapi
dengan begitu API key terkirim tanpa enkripsi. Pakai HTTPS untuk endpoint di luar jaringan internal.

## Menjalankan

Syarat: Node 20+, dan untuk Android: Android SDK serta JDK 21 (bisa dari Android Studio).

```
cd web
npm install
npm run assets   # generate GLB prosedural ke public/assets
npm run world    # generate chunk, navmesh, dan peta ke public/world (+ cek jalur navmesh)
npm run dev      # buka di browser
npm test         # unit test (vitest)
npm run build    # typecheck + bundle ke dist/
npx cap sync android
cd android && gradlew assembleDebug
```

Data `public/assets` dan `public/world` sudah ikut di repo, jadi `npm run assets` dan `npm run world`
cukup dijalankan kalau generatornya diubah.

### APK release

Signing dibaca dari environment variable supaya password tidak tersimpan di repo:

```
$env:OW_KEYSTORE_FILE = '<path>\openworld-release.keystore'
$env:OW_KEY_ALIAS = 'openworld'
$env:OW_KEYSTORE_PASSWORD = '<password>'
cd web\android; .\gradlew.bat assembleRelease
```

Uninstall APK debug dulu sebelum memasang release karena signature-nya berbeda.

## Struktur `web/src`

- `app/`: root App (gating layar), preload aset, statistik render, uji performa
- `game/`: pemain, kendaraan, NPC, aksi, proximity, siang-malam, fog of war, autosave
- `world/`: spesifikasi data dunia, generator offline, chunk streamer + worker, terrain, navmesh
- `ui/`: HUD, joystick, tombol aksi, minimap, peta besar, chat NPC, menu bus, title, settings
- `ai/`: klien chat (persona NPC, parser SSE)
- `audio/`: mesin audio prosedural (musik, SFX, loop gerak)
- `state/`: store Zustand, pengaturan AI, save game
- `web/tools/`: generator aset GLB dan bake dunia
- `web/android/`: proyek Capacitor Android (termasuk plugin native `AiStreamPlugin`)

## Status dan catatan

- Semua aset dibuat prosedural (low-poly, CC0, buatan sendiri).
- FPS dan hitch di perangkat Android belum diukur. Jalankan "Uji performa" dari menu jeda di HP.
- Bundle JS sekitar 1.3 MB (gzip ~370 KB) dan navmesh sekitar 4 MB.
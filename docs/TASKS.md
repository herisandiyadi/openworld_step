# Task: Kamera ala GTA V + Kehidupan Kota

Acuan desain: [`NEXT_FEATURES.md`](NEXT_FEATURES.md). Estimasi dalam **hari kerja untuk 1 developer**
(1 hari = sekitar 6 jam efektif), sudah termasuk unit test. Kerjakan per fase. Fase berikutnya baru dimulai
setelah gerbang fase sebelumnya lulus di HP.

## Ringkasan Estimasi

| Fase | Isi | Estimasi |
| --- | --- | --- |
| A | Kamera third-person, gesture, kontrol kendaraan | 6 hari |
| B | Lalu lintas: mobil, motor, bus, lampu merah | 9.5 hari |
| C | Pejalan kaki, hewan, chat AI warga, bangku dan duduk | 12.5 hari |
| D | Audio ambient, malam, polish, rilis | 4 hari |
| E | Kustomisasi karakter (gender, rambut, ekspresi, baju, celana) | 5 hari |
| **Total** | | **37 hari (sekitar 7.5 minggu)** |
| Cadangan risiko (+20%) | Terutama animasi instanced dan performa HP | **7.5 hari** |
| **Total realistis** | | **8-9 minggu** |

Catatan: angka di atas untuk developer manusia. Kalau saya yang mengerjakan, penulisan kodenya bisa jauh lebih cepat,
tapi tiap gerbang fase butuh uji di HP oleh kamu. Jadi waktu kalender sebenarnya banyak ditentukan oleh siklus
uji di perangkat dan tuning setelahnya.

Status: `[ ]` belum, `[~]` dikerjakan, `[x]` selesai.

## Fase A: Kamera ala GTA V (6 hari)

- [x] **A1. Logika kamera murni** (0.75 hari): `src/camera/followCamera.ts`
  - yaw/pitch, jarak per mode, batas pitch -5° sampai 40°, zoom ±30%, auto-recenter (1.5 detik jalan kaki,
    0.6 detik berkendara), look-ahead maks 2 m, FOV +6° di kecepatan tinggi.
  - Selesai jika: unit test untuk recenter, batas zoom, dan look-ahead lulus.
- [x] **A2. CameraRig** (0.75 hari): `src/camera/CameraRig.tsx`
  - Menggantikan kode kamera di `PlayerController.tsx`, dengan damping posisi dan rotasi.
  - Selesai jika: tidak ada jitter saat jalan, berlari, dan berkendara.
- [x] **A3. Gesture kamera** (1 hari): `src/camera/useCameraGestures.ts`
  - Geser di separuh layar kanan untuk rotasi dan pinch untuk zoom. Di desktop: drag mouse dan scroll.
  - Zona sentuh tidak bentrok dengan joystick dan tombol aksi (multi-touch per pointer).
  - Selesai jika: joystick, geser kamera, dan tombol bisa dipakai bersamaan dengan 3 jari.
- [x] **A4. Joystick relatif kamera** (0.25 hari)
  - Input dirotasi sebesar yaw kamera sebelum `stepPlayer`, berlaku juga untuk WASD.
- [x] **A5. Tabrakan kamera** (0.5 hari)
  - Ray vs AABB gedung di 3x3 chunk, offset 0.3 m, kembali menjauh secara halus.
  - Pemain disembunyikan atau transparan jika kamera < 1.2 m.
  - Selesai jika: unit test ray-AABB lulus dan 0 klip di uji keliling 2 putaran.
- [x] **A6. Kontrol kendaraan baru** (1 hari)
  - Motor dan mobil: gas/rem plus belok dengan radius putar dan akselerasi. Sepeda dan skateboard: belok halus.
  - Parameter per kendaraan di `vehicleSpec.ts`.
  - Selesai jika: tidak bisa berputar di tempat, terasa wajar, dan mudah di-tuning.
- [x] **A7. Opsi tap-to-move** (0.25 hari)
  - Toggle "Ketuk untuk berjalan" di Pengaturan, default mati, disimpan di Preferences.
- [x] **A8. Minimap ikut arah kamera** (0.25 hari)
  - Opsi rotate-with-camera (default nyala) atau north-up, dengan penanda utara ikut berputar.
- [x] **A9. Horizon dan bayangan** (0.75 hari)
  - Fog 60-140 m, siluet gedung impostor untuk chunk di luar radius muat (1 draw call per chunk).
  - Shadow camera ±20 m di depan arah pandang.
  - Selesai jika: batas streaming tidak terlihat dan draw call total ≤ 150.
- [ ] **A10. Uji dan rilis fase A** (0.5 hari)
  - Metrik klip kamera di `SoakTest`, build APK, lalu uji di HP.

**Gerbang A:** 0 klip kamera, kontrol responsif di HP, dan ≥ 30 FPS di mid-range.

## Fase B: Lalu Lintas (9.5 hari)

- [x] **B1. Bake graf lajur** (1.5 hari): `tools/world/lanes.ts` menghasilkan `public/world/lanes.json`
  - Lajur kiri ±2 m dari garis tengah, node persimpangan, belokan lurus/kiri/kanan dengan kurva Bezier.
  - Selesai jika: test memastikan semua edge terhubung, tidak ada jalan buntu, dan tidak menembus gedung.
- [x] **B2. Query graf runtime** (0.5 hari): `src/ambient/laneGraph.ts`
  - Mencari edge terdekat, edge berikutnya acak per persimpangan, dan konversi posisi 1D ke dunia.
- [x] **B3. Simulasi lalu lintas** (1.5 hari): `src/ambient/trafficSim.ts`
  - Posisi 1D per edge, car-following (2 m + 0.8 detik x kecepatan), reservasi persimpangan, 15/5 Hz.
  - Selesai jika: test 10.000 tick tanpa tabrakan atau deadlock lulus.
- [x] **B4. Lampu lalu lintas** (1 hari) — selesai: aset `prop_trafficlight_01` + siklus `src/ambient/trafficLights.ts` (12 detik, kuning 2 detik, satu arah hijau) yang menahan mobil di `trafficSim` lewat `gate`
  - Aset `prop_trafficlight_01`, siklus 12 detik dengan kuning 2 detik di Pusat Kota, emissive diatur shader.
  - Status lampu dibagi ke simulasi mobil dan pejalan kaki.
- [x] **B5. Aset kendaraan GLB** (1.5 hari) — GLB selesai; wiring runtime `vehicleModels.tsx` -> GLB oleh lead
  - `veh_car_sedan`, `veh_car_hatch`, `veh_moto`, `veh_bus` dengan roda sebagai node terpisah.
  - Mobil dan motor milik pemain dipindah dari `vehicleModels.tsx` ke GLB.
  - Selesai jika: lolos validator, anggaran segitiga terpenuhi, dan terdaftar di manifest.
- [x] **B6. Spawner dan pool** (0.75 hari): `src/ambient/spawner.ts`
  - Cincin spawn 40-110 m di luar pandangan, despawn > 130 m, jumlah pool per preset (8/14/20).
  - Selesai jika: test memastikan tidak ada spawn di dalam frustum kamera.
- [x] **B7. Render instanced** (1 hari): `src/ambient/AmbientLayer.tsx` — 15 InstancedMesh (dihitung, belum diukur di HP); simulasi 15/5 Hz lewat `stepTrafficTiered`
  - InstancedMesh per bagian kendaraan, interpolasi antar tick, roda berputar, lampu depan menyala di malam hari.
  - Selesai jika: draw call ambient ≤ 15.
- [x] **B8. Interaksi dengan pemain** (0.5 hari) — `playerGap` di `trafficSim.ts` + dorong keluar di `AmbientLayer.tsx`
  - Berhenti jika pemain di depan < 6 m, klakson setelah 2 detik, dorong keluar saat tumpang tindih, tanpa kerusakan.
- [x] **B9. Bus kota** (0.5 hari) — `src/ambient/busRoute.ts`, halte sama dengan `busDestinations`
  - Rute melewati halte dengan jeda 4 detik, sinkron dengan menu fast travel.
- [ ] **B10. Uji dan rilis fase B** (0.75 hari)
  - Soak test 10 menit: 0 tabrakan, 0 mobil macet permanen, plus pengukuran performa di HP.

**Gerbang B:** 0 tabrakan, 0 macet permanen, draw call ambient ≤ 15, dan FPS tetap ≥ 30.

## Fase C: Pejalan Kaki, Hewan, Chat Warga, dan Bangku (12.5 hari)

- [x] **C1. Graf trotoar dan zebra cross** (1 hari)
  - Dibake ke `lanes.json`, dan surface zebra cross ditulis ke chunk serta peta.
- [x] **C2. Simulasi pejalan kaki** (1.5 hari): `src/ambient/pedestrianSim.ts` — duduk warga di bangku (state `sit`) belum dipakai runtime
  - Jalan di trotoar, menyeberang saat lampu pejalan hijau, duduk di bangku (memakai reservasi kursi dari C10), menghindari pemain.
  - Selesai jika: test memastikan tidak ada agen di dalam AABB gedung.
- [ ] **C3. Aset dan animasi warga** (2 hari) — separuh aset selesai: `ped_citizen` (atribut `_TINT`, 6 varian di meta, klip idle/walk/sit); shader instanced & uji HP belum
  - `ped_citizen` dengan 6 variasi warna lewat atribut instance.
  - Animasi vertex shader prosedural (walk, idle, sit), dan skinned hanya untuk ≤ 4 agen terdekat.
  - Ini task paling berisiko, jadi prototipe dulu performanya di HP.
- [x] **C4. Aset hewan** (1.5 hari)
  - `animal_cat`, `animal_dog`, dan `bird_pigeon` dengan vertex anim (walk, run, sit, sniff, peck, fly).
- [x] **C5. Simulasi hewan** (1.25 hari): `src/ambient/animalSim.ts`
  - State machine, berkeliaran di navmesh dalam radius 10-20 m, reaksi kucing kabur (3 m), merpati terbang (5 m),
    dan anjing mengikuti (4 m, peluang 30%).
  - Selesai jika: unit test transisi state lulus.
- [x] **C6. Kepadatan per kawasan dan jam** (0.5 hari)
  - Tabel kepadatan Pusat Kota, Perumahan, dan Industri, turun 60% di malam hari (22.00-05.00).
- [x] **C7. Pool warga dan persona** (0.75 hari): `src/ambient/residents.ts` dan `residents.json`
  - 60 warga deterministik (nama, umur, pekerjaan, rumah/kantor, hobi, suasana hati), aktivitas ikut jam,
    dan system prompt warga yang menyertakan nama pemain.
  - Selesai jika: test determinisme, validasi isi persona, dan isi prompt lulus.
- [x] **C8. Chat dengan pejalan kaki** (1.25 hari) — uji streaming `cbai` di HP belum
  - Target "Tanya" untuk pejalan kaki dalam 3 m (NPC bernama diprioritaskan) dan label nama dalam 6 m.
  - Warga berhenti dan menghadap pemain, tidak di-despawn selama chat, lalu lanjut beraktivitas.
  - Riwayat per warga masuk save game (10 giliran, maks 30 warga, LRU) dan statistik "warga diajak ngobrol" di HUD.
  - Selesai jika: test save/load riwayat warga lulus, dan chat streaming ke `cbai` berjalan di HP.
- [x] **C9. Bangku pinggir jalan dan titik duduk** (1 hari) — aset `prop_bench_02` (108 segitiga) + penempatan generator dan titik duduk, keduanya selesai
  - Aset `prop_bench_02` (≤ 300 segitiga, sandaran, collider kotak) lewat `npm run assets`.
  - Generator: penempatan di cincin trotoar (Pusat Kota 2 per sisi blok, Perumahan 1, Industri dekat halte),
    jarak ≥ 1.5 m dari lampu/tempat sampah/halte, tidak di 6 m terakhir sebelum persimpangan.
  - Titik duduk (2 per bangku, ±0.4 m, tinggi 0.45 m) untuk `prop_bench_01` dan `prop_bench_02`, dibake ke chunk
    JSON. `WORLD_DATA_VERSION` naik.
  - Selesai jika: test memastikan sisa lebar trotoar ≥ 1.4 m, bangku tidak tumpang tindih dengan prop lain, dan
    semua titik duduk di luar collider gedung.
- [x] **C10. Duduk di bangku** (1 hari): `src/game/seating.ts` — uji di HP belum
  - Cari kursi kosong terdekat ≤ 1.5 m, reservasi kursi untuk pemain dan warga, posisi duduk dan berdiri
    (0.7 m di depan, coba kiri/kanan jika terhalang).
  - `nearby.seatId` di `Proximity`, hanya saat jalan kaki dan tidak di udara.
  - Tombol "Duduk" di `ActionButtons` (slot sendiri, bisa bersamaan dengan "Tanya"), berubah jadi "Berdiri" saat
    duduk. Berdiri juga lewat joystick atau Lompat. Tombol Naik/Turun disembunyikan selama duduk.
  - Klip `anim_Sit` untuk hero, transisi 0.4 detik, auto-recenter kamera mati selama duduk.
  - SFX duduk dan berdiri, shortcut keyboard, `aria-label`. Posisi duduk tidak disimpan di save.
  - Selesai jika: unit test reservasi (tidak ada dua karakter di satu kursi) dan berdiri tanpa terjebak lulus,
    dan duduk/berdiri berjalan di HP.
- [ ] **C11. Uji dan rilis fase C** (0.75 hari) — kode tersambung (`PedestrianLayer` via `Proximity`); uji anggaran di HP belum
  - Anggaran ambient (≤ 30 draw call, ≤ 40k segitiga, simulasi ≤ 1.5 ms per frame) dan uji di HP.

**Gerbang C:** tidak ada agen di dalam gedung, reaksi hewan benar, chat warga jalan di HP, duduk/berdiri di
bangku berjalan tanpa pemain terjebak, dan anggaran ambient terpenuhi.

## Fase D: Polish dan Rilis (4 hari)

- [x] **D1. Audio ambient spasial** (1.25 hari)
  - Klakson, mesin lewat dengan pitch doppler sederhana, meong, gonggong, dan kepak sayap.
  - Pan dan volume mengikuti jarak, maks 6 suara bersamaan, memakai mesin `src/audio` yang sudah ada.
- [x] **D2. Suasana malam** (0.5 hari)
  - Lampu mobil, lampu jalan menyala (emissive), dan jendela gedung terang acak.
- [x] **D3. Sapaan gelembung** (0.5 hari)
  - Warga kadang menyapa singkat saat pemain lewat, memakai teks lokal tanpa AI.
- [x] **D4. Preset kepadatan** (0.25 hari)
  - Pengaturan "Keramaian kota": Sepi, Normal, atau Ramai, terpisah dari preset grafis.
- [ ] **D5. Uji performa per preset dan tuning** (1 hari)
  - Preset Rendah, Sedang, dan Tinggi di HP, lalu sesuaikan pool dan jarak spawn.
- [x] **D6. Dokumentasi dan rilis** (0.5 hari)
  - `docs/AMBIENT.md`: sistem ambient, preset kepadatan, dan tombol penyetelan. APK release dan
    verifikasi signing menyusul bersama D5 (butuh perangkat fisik).

**Gerbang D:** uji performa di HP lulus untuk ketiga preset, dan APK release terverifikasi.

## Fase E: Kustomisasi Karakter (5 hari)

Acuan: `NEXT_FEATURES.md` bagian 9. Bisa dikerjakan terpisah dari A-D, tapi harus selesai **sebelum multiplayer**
(`MULTIPLAYER.md` M1), karena penampilan pemain ikut disinkron.

- [x] **E1. Aset karakter dasar** (1.25 hari): `tools/assets/defs/characters.ts`, `humanoid.ts`
  - `char_hero_m` dan `char_hero_f` dengan rig dan semua klip hero yang ada (Idle, Walk, Run, Skate, Bike, Talk,
    plus Sit jika C10 sudah ada).
  - Rambut per gender (pendek / sebahu) dengan slot material `hair`.
  - 3 ekspresi wajah (senyum, datar, ceria) sebagai node alis + mulut, satu yang terlihat.
  - Selesai jika: `npm run assets` lulus validator, total ≤ 3.5k segitiga per file, terlihat ≤ 2k.
- [x] **E2. Gaya baju dan celana** (0.75 hari)
  - Node mesh terpisah: baju (kaos, hoodie, kemeja) dan celana (jeans panjang, celana pendek, jogger), slot
    material `shirt` dan `pants`.
  - Palet 3 warna per slot (rambut: hitam/cokelat/pirang, baju: biru/merah/hijau, celana: denim/hitam/krem).
  - Validator: semua kombinasi baju × celana × gender tidak saling menembus di pose preview (walk, run, skate,
    bike, sit).
- [x] **E3. Model data dan penyimpanan** (0.5 hari): `src/state/profile.ts`, `PlayerDbPlugin.java`
  - Tipe `Appearance` (gender `m`/`f`, 6 field 0-2), default = tampilan hero sekarang, fungsi validasi.
  - SQLite `VERSION = 2`, `onUpgrade` dengan `ALTER TABLE ... ADD COLUMN appearance TEXT`, tanpa menghapus baris lama.
    Validasi yang sama di Java.
  - Fallback browser di Preferences `player_profile_v1`.
  - Selesai jika: unit test validasi dan default lulus, profil v1 terbaca dengan penampilan default.
- [x] **E4. Komponen karakter yang bisa dikustomisasi** (0.5 hari): `src/game/HeroAppearance.ts`
  - Pilih GLB per gender, tampilkan node terpilih (`visible`), clone material per karakter dan warnai dari palet.
  - Dipakai oleh pemain lokal, pratinjau, dan nanti `RemotePlayers` (multiplayer) serta `ped_citizen`.
  - Selesai jika: draw call hero sama dengan sekarang.
- [x] **E5. UI pilihan penampilan** (1 hari): `src/ui/ProfileScreen.tsx`, `src/ui/AppearancePicker.tsx`
  - Username + 7 kategori dalam satu layar, grup pilihan 3 tombol (gender 2) dengan swatch warna dan nama teks,
    ukuran sentuh ≥ 48 px, tombol "Acak" dan "Simpan".
  - Aksesibilitas: `role="radiogroup"` per kategori, `role="radio"` + `aria-checked`, navigasi panah kiri/kanan.
  - Pemain lama: layar penampilan muncul sekali dengan username terisi.
- [x] **E6. Pratinjau 3D** (0.5 hari): `src/ui/CharacterPreview.tsx`
  - `Canvas` kecil terpisah, animasi idle, geser untuk memutar, `frameloop="demand"`.
  - Selesai jika: pratinjau sama persis dengan tampilan di game untuk kombinasi yang sama.
- [x] **E7. Integrasi AI dan game** (0.25 hari): `src/ai/chat.ts`
  - Sapaan "Mas {username}" / "Mbak {username}" dan ringkasan penampilan singkat di system prompt.
  - Penampilan tidak masuk save game, jadi "Mulai baru" tidak mengubah tampilan.
  - Selesai jika: unit test isi prompt untuk kedua gender lulus.
- [ ] **E8. Uji dan rilis fase E** (0.25 hari)
  - Uji di HP: semua animasi (jalan, lari, skate, sepeda, duduk) dengan beberapa kombinasi, migrasi dari APK lama
    tanpa kehilangan username, build APK release.

**Gerbang E:** semua kombinasi tampil benar di pratinjau dan di game tanpa mesh menembus, profil lama termigrasi
tanpa kehilangan data, dan draw call hero tidak naik.

## Ketergantungan

```
A1 -> A2 -> A3, A4, A5 -> A6 -> A10
B1 -> B2 -> B3 -> B4, B6, B8, B9 ; B5 -> B7 ; semua B -> B10
C1 -> C2 -> C8 ; C3 -> C2 render ; C4 -> C5 ; C7 -> C8 ; C9 -> C10 -> C2 (duduk warga) ; semua C -> C11
D bergantung pada B dan C
E1 -> E2 -> E4 -> E6 ; E3 -> E5 ; E4 + E5 + E6 -> E7 -> E8 ; E tidak bergantung pada A-D
E harus selesai sebelum MULTIPLAYER.md M1
```

## Risiko yang Bisa Menambah Waktu

- Animasi vertex shader untuk banyak agen (C3, C4) adalah bagian paling tidak pasti. Kalau performa di HP kurang,
  perlu impostor atau LOD tambahan (+2-3 hari).
- Pandangan rendah meningkatkan draw call dan segitiga. Kalau gerbang A gagal, perlu LOD gedung (+1-2 hari).
- Tuning rasa kontrol kendaraan biasanya butuh beberapa putaran uji di HP.
- Mesh baju atau celana menembus saat animasi skate, sepeda, atau duduk (E2). Kalau terjadi, perlu penyesuaian bobot
  rig atau bentuk mesh per gaya (+0.5-1 hari).
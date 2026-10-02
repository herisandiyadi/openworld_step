# Fitur Berikutnya: Kamera ala GTA V + Kehidupan Kota Otomatis

Status: rencana (belum dikerjakan). Dokumen ini jadi acuan implementasi, mengikuti aturan `prompt.md`:
satu fase dikerjakan, diuji, lalu lanjut. Tetap dengan anggaran performa mobile dan aset Mode B (prosedural).

## 1. Ringkasan

| Fitur | Sekarang | Target |
| --- | --- | --- |
| Kamera | Isometrik MOBA, pitch 55°, jarak 30 m, selalu menghadap utara | Third-person di belakang pemain seperti GTA V, jarak dekat (5-9 m), bisa diputar |
| Kontrol gerak | Joystick arah dunia (atas = utara), tap-to-move | Joystick relatif kamera, geser layar kanan untuk memutar kamera |
| Kota | Statis, hanya 5 NPC diam | Mobil, motor, bus, pejalan kaki, kucing, anjing, dan burung bergerak otomatis |
| Karakter pemain | Hanya input username, model hero tetap (hoodie, jeans) | Username + pilih gender, warna rambut, ekspresi wajah, warna dan gaya baju, warna dan gaya celana (lihat 9) |
| Bangku | Bangku taman (`prop_bench_01`) hanya dekorasi, tidak bisa diduduki | Bangku taman + bangku pinggir jalan, pemain dan warga bisa duduk (tombol "Duduk" muncul saat dekat bangku) |

## 2. Kamera Third-Person (ala GTA V)

### 2.1 Perilaku

- Kamera mengikuti dari belakang dan sedikit di atas bahu pemain, menghadap ke arah hadap pemain.
- Zoom out tidak terlalu jauh. Jarak per mode:

| Mode | Jarak (m) | Tinggi target (m) | Pitch default | FOV |
| --- | --- | --- | --- | --- |
| Jalan kaki | 5.5 | 1.6 | 12° | 55° |
| Skateboard / sepeda | 6.5 | 1.5 | 12° | 58° |
| Motor | 7.5 | 1.4 | 10° | 60° |
| Mobil | 9 | 1.3 | 10° | 60° |

- Pinch dua jari untuk zoom terbatas: ±30% dari jarak default (jalan kaki 4-7 m). Tidak ada mode top-down jauh.
- Geser jari di separuh layar kanan (di luar tombol aksi) untuk memutar yaw (bebas) dan pitch (-5° sampai 40°).
- Auto-recenter: 1.5 detik setelah jari dilepas dan pemain bergerak, kamera pelan-pelan kembali ke belakang pemain.
  Saat berkendara, recenter lebih cepat (0.6 detik).
- Look-ahead saat berkendara: target kamera digeser sedikit ke depan sesuai kecepatan (maks 2 m), dan FOV naik
  sampai +6° di kecepatan tinggi untuk kesan cepat.
- Smoothing posisi dan rotasi (damping eksponensial, seperti `CAMERA_SMOOTHING` sekarang) supaya tidak bergetar.

### 2.2 Tabrakan kamera

- Kamera tidak boleh menembus gedung. Tiap frame, sinar dari target kamera ke posisi kamera diuji terhadap
  collider AABB gedung di 3x3 chunk sekitar (`worldState.collision.boxes`, sudah ada).
  Uji analitik ray-vs-AABB lebih murah daripada raycast mesh.
- Kalau kena, kamera maju ke titik tabrakan dikurangi 0.3 m. Kalau terlalu dekat (< 1.2 m), model pemain
  dibuat transparan atau disembunyikan.
- Saat kembali menjauh, gerak kamera di-smooth (kembali lebih lambat daripada saat maju) agar tidak "melompat".

### 2.3 Kontrol

- Joystick kiri menjadi relatif kamera: maju = arah pandang kamera (diproyeksikan ke tanah).
  Ubah di `PlayerController.tsx` dengan merotasi `input` sebesar yaw kamera sebelum `stepPlayer`.
- Kendaraan (motor, mobil): joystick maju/mundur = gas/rem, kiri/kanan = belok. Model kendaraan sederhana
  dengan kecepatan dan sudut belok terbatas, tidak bisa berputar di tempat seperti sekarang.
- Tap-to-move: dimatikan secara default karena bentrok dengan geser kamera dan pandangan rendah sulit dipakai
  untuk memilih titik. Tetap tersedia sebagai opsi di Pengaturan ("Ketuk untuk berjalan").
- Desktop: mouse drag (atau pointer lock) untuk memutar kamera, scroll untuk zoom.

### 2.4 Dampak ke sistem lain

- Minimap: tambah opsi "ikut arah kamera" (rotasi mengikuti yaw) dan jadikan default untuk mode ini.
  Opsi north-up tetap ada.
- Pandangan horizon: dengan pitch rendah pemain melihat jauh ke depan.
  - Fog didekatkan dan dibuat lebih tebal (sekitar 60-140 m) agar batas streaming (radius 2 chunk = 128 m)
    tidak terlihat.
  - Tambah siluet gedung murah (impostor kotak tanpa detail, 1 draw call per chunk) untuk chunk di luar
    radius muat.
- Bayangan: shadow camera dipindah ke depan arah pandang dan diperkecil (±20 m), map tetap ≤ 1024.
- HUD: area geser kamera tidak boleh menutupi tombol aksi. Event pointer di tombol berhenti di tombol
  (`stopPropagation`), sisanya untuk kamera.
- Label nama NPC dan penanda kuning tetap ada, ukurannya disesuaikan dengan jarak kamera yang lebih dekat.

## 3. Kehidupan Kota Otomatis (Ambient)

Semua agen ambient bersifat dekorasi: tidak ada musuh, tidak ada damage. Mereka menghindari pemain, bukan
menyerang. Pejalan kaki acak juga bisa diajak chat AI (lihat 3.7). 5 NPC bernama tetap punya persona khusus dan quest.

### 3.1 Jenis agen

| Agen | Perilaku | Lokasi |
| --- | --- | --- |
| Mobil (3-4 warna, 2 bentuk: sedan, hatchback) | Mengikuti lajur, belok acak di persimpangan, berhenti di lampu merah, mengerem jika ada mobil/pemain di depan | Jalan |
| Motor | Sama seperti mobil, lebih cepat dan sering menyalip pelan | Jalan |
| Bus kota | Rute tetap melewati halte, berhenti 4 detik di tiap halte (sinkron dengan fitur fast travel) | Jalan utama |
| Pejalan kaki (variasi warna baju dan tinggi) | Jalan di trotoar, menyeberang di zebra cross saat lampu hijau pejalan, kadang berhenti/duduk di bangku | Trotoar, plaza, taman |
| Kucing | Berkeliaran pelan, duduk, lari menjauh jika pemain mendekat < 3 m | Perumahan, gang, taman |
| Anjing | Berjalan bersama pemilik (pejalan kaki) atau berkeliaran; kadang mengikuti pemain sebentar lalu kembali | Perumahan, taman |
| Burung merpati | Kawanan mematuk di tanah, terbang menjauh saat pemain/mobil lewat, mendarat lagi | Plaza, taman |

Kepadatan mengikuti kawasan dan jam (pakai `dayClock` yang sudah ada):

- Pusat Kota: lalu lintas dan pejalan kaki paling ramai, banyak merpati.
- Perumahan: lalu lintas sepi, lebih banyak kucing dan anjing.
- Kawasan Industri: lebih banyak motor/mobil, sedikit pejalan kaki.
- Malam (22.00-05.00): pejalan kaki dan kendaraan turun sekitar 60%, mobil menyalakan lampu depan (emissive).

### 3.2 Lalu lintas

- Jalan sudah berpola grid: garis tengah jalan di kelipatan 32 m, lebar 8 m (`BLOCK_PITCH`, `ROAD_WIDTH`).
- Lajur dua arah, masing-masing di ±2 m dari garis tengah. Default lajur kiri (lalu lintas Indonesia).
- Graf lajur dibuat offline oleh `tools/world/build.ts` dan disimpan ke `public/world/lanes.json`.
  - Node: titik masuk dan keluar tiap persimpangan.
  - Edge: segmen lajur dan belokan (kurva Bezier pendek untuk lurus, kiri, dan kanan).
- Persimpangan:
  - Pusat Kota: lampu lalu lintas siklus 12 detik per arah, ditambah lampu kuning 2 detik.
    Model lampu baru `prop_trafficlight_01`.
  - Kawasan lain: aturan "siapa duluan masuk" dengan reservasi persimpangan.
- Car-following: tiap kendaraan menjaga jarak aman (2 m + 0.8 detik x kecepatan) dari kendaraan di depan pada
  lajur yang sama. Tanpa fisika, cukup posisi 1D di sepanjang edge.
- Pemain: kendaraan berhenti jika pemain berada di depannya < 6 m pada lajurnya, membunyikan klakson setelah
  2 detik, lalu menunggu. Kalau pemain menabrak mobil ambient dengan mobilnya, keduanya berhenti dan didorong
  keluar dari tumpang tindih. Tidak ada kerusakan.

### 3.3 Pejalan kaki dan hewan

- Pejalan kaki mengikuti graf trotoar (cincin trotoar tiap blok, sudah ada di generator) dan zebra cross di
  persimpangan. Juga dibake ke `lanes.json`.
- Hewan memakai navmesh yang sudah ada (`navigation.ts`) dengan tujuan acak radius 10-20 m. Area terbatas
  per hewan agar tetap di sekitar lingkungannya.
- Perilaku sederhana dengan state machine: `idle -> wander -> flee/follow -> idle`. Kucing: `sit`, `groom`.
  Anjing: `sniff`, `follow`. Merpati: `peck -> fly -> land`.
- Jarak kesadaran ke pemain: kucing 3 m (kabur), merpati 5 m (terbang), anjing 4 m (mengikuti 5-8 detik, peluang 30%).

### 3.4 Spawn, despawn, dan pooling

- Agen hanya hidup di cincin sekitar pemain. Spawn 40-110 m di luar pandangan kamera, despawn di luar 130 m.
  Tidak pernah spawn di depan mata pemain.
- Object pool dengan jumlah tetap per preset grafis (tidak ada alokasi saat main):

| Preset | Kendaraan | Pejalan kaki | Hewan | Merpati |
| --- | --- | --- | --- | --- |
| Rendah | 8 | 10 | 4 | 12 |
| Sedang | 14 | 18 | 6 | 20 |
| Tinggi | 20 | 26 | 8 | 30 |

- Simulasi jalan di 15 Hz dengan interpolasi posisi di frame render. Agen di luar 60 m disimulasikan di 5 Hz.
- Anggaran CPU simulasi ambient: ≤ 1.5 ms per frame di perangkat mid-range (diukur di uji performa).

### 3.5 Rendering

- Semua agen sejenis digambar dengan `InstancedMesh` per bagian mesh (body, kaca, roda), jadi draw call tidak
  naik per jumlah agen.
- Pejalan kaki dan hewan:
  - Animasi rangka per instance terlalu mahal. Pakai animasi vertex shader prosedural (ayunan kaki, langkah,
    kepakan sayap) di atas mesh low-poly yang di-instance.
  - Sebagai fallback, `SkinnedMesh` hanya untuk ≤ 4 agen terdekat.
- Anggaran ambient: ≤ 30 draw call dan ≤ 40k segitiga terlihat. Total game tetap ≤ 150 draw call dan ≤ 300k segitiga.
- Bayangan: hanya mobil dan agen ≤ 15 m yang ikut shadow map. Sisanya blob shadow (quad gelap di tanah, instanced).

### 3.6 Audio (memakai mesin prosedural yang sudah ada)

- Klakson, suara mesin kendaraan lewat (doppler sederhana dengan pitch naik/turun berdasarkan jarak), meong
  kucing, gonggong anjing, kepak sayap merpati.
- Suara spasial: volume dan pan berdasarkan jarak dan sudut ke kamera, maks 6 suara ambient bersamaan.

### 3.7 Chat AI dengan pejalan kaki

- Kota punya pool 60 warga tetap (`public/world/residents.json`, dibake bersama dunia, deterministik). Tiap pejalan
  kaki yang di-spawn mengambil warga yang sedang tidak aktif dari pool. Jadi warga yang sama bisa ditemui lagi.
- Persona warga dibuat dari seed: nama Indonesia, umur, pekerjaan sesuai kawasan, rumah/kantor, hobi, dan suasana
  hati. Aktivitas saat ini mengikuti jam (berangkat kerja, makan siang, pulang). Persona masuk ke system prompt
  bersama nama pemain dan fakta kota, dengan aturan yang sama: singkat, tetap dalam karakter, seputar kota.
- Tombol "Tanya" muncul untuk pejalan kaki dalam 3 m. Kalau NPC bernama juga dekat, NPC bernama diprioritaskan.
  Nama warga tampil di atas pejalan kaki terdekat (≤ 6 m) supaya pemain tahu dia bisa diajak bicara.
- Saat chat: warga berhenti, menghadap pemain, dan tidak di-despawn. Setelah panel ditutup dia melanjutkan aktivitasnya.
- Riwayat percakapan disimpan per warga di save game (10 giliran terakhir, maks 30 warga, LRU), jadi warga
  "ingat" pemain saat bertemu lagi.
- Beban endpoint: request hanya saat pemain mengirim pesan, satu chat aktif pada satu waktu, `max_tokens` tetap 400.
- Quest "kenalan dengan warga" tetap untuk 5 NPC bernama. Tambah statistik "warga yang sudah diajak ngobrol".

### 3.8 Bangku dan Duduk

**Jenis bangku**

| Aset | Lokasi | Kursi | Catatan |
| --- | --- | --- | --- |
| `prop_bench_01` (bangku taman, sudah ada) | Blok taman, 4 bangku menghadap tengah | 2 | Tetap, ditambah titik duduk |
| `prop_bench_02` (bangku pinggir jalan, baru) | Trotoar, menempel ke sisi kavling, menghadap jalan | 2 | Ada sandaran, ≤ 300 segitiga |

- **Penempatan bangku pinggir jalan** di cincin trotoar (generator `worldGen.ts`, bagian street furniture):
  - Pusat Kota: 2 per sisi blok. Perumahan: 1 per sisi blok. Kawasan Industri: hanya dekat halte.
  - Jarak minimal 1.5 m dari lampu jalan, tempat sampah, dan halte. Tidak di 6 m terakhir sebelum persimpangan.
  - Trotoar lebarnya 2 m dan bangku 0.6 m, jadi ruang jalan kaki yang tersisa minimal 1.4 m. Pejalan kaki dan
    pemain tetap bisa lewat.
- **Titik duduk (seat anchor):** tiap bangku punya 2 kursi di offset lokal ±0.4 m, tinggi duduk 0.45 m, menghadap
  depan bangku. Titik duduk dibake ke chunk JSON (`seats: [{ id, x, y, z, yaw }]`) oleh `npm run world`, jadi
  runtime tidak menghitung ulang. `WORLD_DATA_VERSION` naik.

**Interaksi pemain**

- Tombol **"Duduk"** muncul di kluster tombol aksi (gaya MOBA yang sudah ada) hanya jika:
  - pemain sedang jalan kaki (tidak naik kendaraan),
  - ada kursi kosong dalam 1.5 m (dicari di `Proximity`, sama seperti kendaraan dan NPC: `nearby.seatId`),
  - pemain tidak sedang di udara (lompat).
- Tombol memakai slot sendiri, jadi bisa tampil bersamaan dengan "Tanya" kalau ada NPC atau warga dekat bangku.
- Tekan "Duduk": karakter berjalan/diarahkan ke titik duduk dalam 0.4 detik (interpolasi posisi dan arah), lalu
  animasi `anim_Sit` berulang. Kursi direservasi untuk pemain.
- Saat duduk:
  - Tombol berubah jadi **"Berdiri"**. Menggerakkan joystick, menekan Lompat, atau tombol Berdiri membuat pemain
    berdiri.
  - Tombol "Tanya" tetap bisa dipakai. Chat dengan NPC atau warga di dekat bangku bisa sambil duduk.
  - Kamera tetap bisa diputar dan di-zoom. Auto-recenter dimatikan selama duduk.
  - Tombol Naik/Turun kendaraan disembunyikan.
- Berdiri: pemain ditempatkan 0.7 m di depan kursi. Kalau titik itu terhalang (misal ada warga), dicoba kiri dan
  kanan bangku, supaya pemain tidak pernah terjebak di dalam collider bangku.
- Collider bangku tetap ada. Selama duduk, collider bangku yang sedang dipakai diabaikan untuk pemain.
- Save: posisi duduk tidak disimpan. Saat load, pemain berdiri di depan bangku.
- Audio: SFX pendek duduk dan berdiri dari mesin audio prosedural yang sudah ada.
- Aksesibilitas: label tombol "Duduk di bangku" dan "Berdiri" (`aria-label`), plus shortcut keyboard di
  `useKeyboardInput`.

**Warga ambient**

- Pejalan kaki (3.3) memakai **reservasi kursi yang sama**. Kursi yang diduduki warga tidak ditawarkan ke pemain, dan
  sebaliknya. Warga bisa duduk di kursi sebelah pemain.
- Warga duduk 20-90 detik lalu melanjutkan jalan. Malam hari lebih jarang duduk.
- Warga yang sedang duduk tetap bisa diajak chat (3.7). Dia tetap duduk selama chat.
## 4. Aset Baru (Mode B, prosedural)

| ID | Segitiga | Rig / animasi | Catatan |
| --- | --- | --- | --- |
| `veh_car_sedan`, `veh_car_hatch` | ≤ 1.2k | Roda node terpisah | Pindahkan mobil dari kode (`vehicleModels.tsx`) ke GLB |
| `veh_moto` | ≤ 800 | Roda node terpisah | Sama, dipakai pemain dan ambient |
| `veh_bus` | ≤ 1.5k | Roda, pintu | Rute ambient |
| `ped_citizen` | ≤ 1.5k | Vertex anim (walk, idle, sit) + rig ≤ 20 tulang untuk dekat | 6 variasi warna lewat atribut instance |
| `animal_cat` | ≤ 600 | Vertex anim (walk, run, sit) | 3 warna |
| `animal_dog` | ≤ 800 | Vertex anim (walk, run, sit, sniff) | 2 ukuran, 3 warna |
| `bird_pigeon` | ≤ 150 | Vertex anim (peck, fly) | Dirender sebagai kawanan instanced |
| `prop_trafficlight_01` | ≤ 300 | Lampu emissive diatur shader | Pusat Kota |
| `prop_zebra_cross` | Decal / vertex color | - | Dibake ke surface jalan |
| `prop_bench_02` | ≤ 300 | - | Bangku pinggir jalan dengan sandaran, collider kotak seperti `prop_bench_01` |
| `hero` (update) | - | Tambah klip `anim_Sit` (loop) | Masuk `requiredAnimations` di `tools/assets/defs/characters.ts` |
| `char_hero_m`, `char_hero_f` | ≤ 3.5k (semua varian di satu file) | Rig hero yang sama, semua klip | Pengganti `char_hero`, berisi node gaya baju/celana/rambut dan ekspresi (lihat 9.3) |

Semua aset lewat pipeline finalisasi yang sudah ada (validator, optimasi meshopt, `manifest.json`, CC0).

## 5. Struktur Kode

```
web/src/camera/
  followCamera.ts        logika kamera murni (yaw/pitch, jarak, recenter, collision ray-vs-AABB) + test
  CameraRig.tsx          komponen R3F, menggantikan kode kamera di PlayerController
  useCameraGestures.ts   geser layar kanan, pinch zoom, mouse
web/src/ambient/
  laneGraph.ts           tipe + query graf lajur/trotoar (data dari lanes.json) + test
  trafficSim.ts          posisi 1D per edge, car-following, persimpangan, lampu merah + test
  pedestrianSim.ts       trotoar, zebra cross, bangku + test
  residents.ts           pool 60 warga + persona deterministik + prompt + test
  animalSim.ts           state machine kucing/anjing/merpati + test
  spawner.ts             cincin spawn/despawn, pool per preset + test
  AmbientLayer.tsx       InstancedMesh per jenis, interpolasi, blob shadow
web/src/game/seating.ts  cari kursi kosong terdekat, reservasi kursi (pemain + warga), posisi duduk/berdiri + test
web/tools/world/lanes.ts bake graf lajur & trotoar dari generator kota
```

Logika simulasi dibuat murni (tanpa three.js) supaya bisa di-unit-test dan nanti dipindah ke web worker
kalau anggaran CPU terlampaui.

## 6. Fase dan Gerbang Validasi

**Fase A: Kamera.** Kamera third-person, gesture, joystick relatif kamera, collision kamera, kontrol kendaraan
baru, minimap ikut arah, penyesuaian fog dan bayangan.
Gerbang:
- Tidak ada klip kamera menembus gedung pada uji jalan keliling 2 putaran.
- Kontrol terasa responsif di HP.
- ≥ 30 FPS di perangkat mid-range.

**Fase B: Lalu lintas.** Graf lajur, mobil, motor, bus, dan lampu lalu lintas.
Gerbang:
- 0 tabrakan antar mobil ambient dan 0 mobil macet permanen dalam soak test 10 menit.
- Draw call ambient ≤ 15.

**Fase C: Pejalan kaki, hewan, chat warga, dan bangku.** Trotoar, zebra cross, kucing, anjing, merpati, chat AI dengan warga, bangku pinggir jalan, duduk di bangku (pemain dan warga), plus variasi siang-malam dan kawasan.
Gerbang:
- Agen tidak masuk gedung.
- Respons pemain sesuai (kabur, terbang, mengikuti).
- Duduk dan berdiri berhasil di semua jenis bangku, tidak ada pemain terjebak, dan tidak ada dua karakter di kursi yang sama.
- Total anggaran ambient terpenuhi.

**Fase E: Kustomisasi karakter (bagian 9).** Bisa dikerjakan terpisah dari A-D, dan sebaiknya **sebelum
multiplayer** karena penampilan pemain ikut disinkron (`MULTIPLAYER.md`).
Gerbang:
- Semua kombinasi pilihan tampil benar di pratinjau dan di game, tanpa klip mesh saat animasi jalan, lari,
  skate, sepeda, dan duduk.
- Profil lama (hanya username) termigrasi tanpa kehilangan data.
- Draw call hero tidak naik dibanding sekarang.

**Fase D: Polish.** Audio spasial, lampu mobil di malam hari, sapaan gelembung singkat saat pemain lewat, preset kepadatan di Pengaturan.
Gerbang: uji performa di HP lulus untuk preset Rendah, Sedang, dan Tinggi.

Uji performa (`SoakTest`) ditambah metrik: jumlah agen aktif, waktu simulasi ambient per frame, dan jumlah klip kamera.

## 7. Risiko

- Pandangan rendah memperlihatkan jauh ke depan, jadi draw call dan segitiga naik.
  Mitigasi: fog lebih dekat, impostor siluet, dan preset kepadatan.
- Animasi banyak agen di HP mid-range. Mitigasi: vertex animation di shader, skinned hanya untuk yang terdekat,
  dan simulasi 15/5 Hz.
- Gesture kamera bentrok dengan tombol aksi dan joystick. Mitigasi: zona sentuh terpisah dan multi-touch per pointer
  (pola `setPointerCapture` sudah dipakai di `Joystick.tsx`).
- Kontrol kendaraan baru terasa berbeda dari sekarang. Mitigasi: parameter kecepatan dan belok dibuat mudah di-tuning.

## 8. Keputusan (dikonfirmasi 2026-10-02)

1. Lalu lintas lajur kiri seperti di Indonesia: **ya**.
2. Tap-to-move: **tetap ada sebagai opsi di Pengaturan, default mati**.
3. Pejalan kaki acak: **bisa diajak chat AI** (bagian 3.7).

## 9. Kustomisasi Karakter (Profil Pemain)

Sekarang layar profil (`ProfileScreen.tsx`) hanya meminta username, disimpan di SQLite `openworld.db` lewat
`PlayerDbPlugin.java`, dan semua pemain memakai model `char_hero` yang sama. Fitur ini menambah pilihan
penampilan di layar yang sama.

### 9.1 Pilihan

Setiap kategori punya **3 opsi**, kecuali gender (2 opsi).

| Kategori | Opsi | Catatan |
| --- | --- | --- |
| Gender | Laki-laki, Perempuan | Menentukan model dasar (`char_hero_m` / `char_hero_f`) dan bentuk rambut bawaan |
| Warna rambut | Hitam, Cokelat, Pirang | Bentuk rambut mengikuti gender (pendek / sebahu) |
| Ekspresi wajah | Senyum, Datar (cool), Ceria (tertawa) | Ekspresi diam saat idle dan jalan. Saat chat dengan NPC, mulut bergerak ringan (`anim_Talk`) |
| Warna baju | Biru, Merah, Hijau | Berlaku untuk semua gaya baju |
| Gaya baju | Kaos, Hoodie, Kemeja | Hoodie = tampilan hero sekarang |
| Warna celana | Denim biru, Hitam, Krem | Berlaku untuk semua gaya celana |
| Gaya celana | Jeans panjang, Celana pendek, Jogger | Untuk perempuan, opsi kedua bisa diganti rok selutut jika diputuskan nanti |

- Total kombinasi: 2 × 3⁶ = 1.458 tampilan berbeda.
- Warna kulit dan sepatu tetap (bisa jadi kategori tambahan di v2, atau barang toko di `CONTENT_UPDATES.md`).
- Barang kosmetik dari toko (topi, tas, helm) di `CONTENT_UPDATES.md` dipasang **di atas** pilihan ini.

### 9.2 Alur dan UI

- **Instal baru:** layar profil berisi username + pilihan penampilan dalam satu alur:
  1. Username (validasi yang sudah ada, 2-20 karakter).
  2. Penampilan: pratinjau 3D karakter yang berputar pelan di atas, daftar kategori di bawah.
  3. Tombol **"Simpan"**. Tombol **"Acak"** untuk mengisi semua kategori sekaligus.
- **Pemain lama** (profil hanya berisi username): saat pertama kali membuka versi baru, layar penampilan muncul
  sekali dengan username yang sudah terisi dan default = tampilan hero sekarang (laki-laki, hoodie biru, jeans).
- **Ubah kapan saja** dari tombol **Profil** di layar judul. Perubahan berlaku saat game dimulai berikutnya.
- **Kontrol pilihan:** tiap kategori adalah grup tombol pilihan (3 tombol, warna ditampilkan sebagai swatch
  dengan nama teks). Ukuran sentuh ≥ 48 px.
- **Pratinjau:** satu `Canvas` kecil terpisah dengan model hero, animasi idle, bisa diputar dengan geser jari.
  Dirender `frameloop="demand"` supaya hemat baterai, dan hanya digambar ulang saat pilihan berubah atau diputar.
- **Aksesibilitas:** setiap grup memakai `role="radiogroup"` dengan label kategori, setiap opsi
  `role="radio"` + `aria-checked` dan nama opsi dalam teks (warna tidak hanya dibedakan lewat warna). Bisa
  dipakai dengan keyboard (panah kiri/kanan).

### 9.3 Aset dan Render

- **Dua GLB dasar** `char_hero_m` dan `char_hero_f`, dibuat lewat pipeline Mode B yang sudah ada
  (`tools/assets/defs/characters.ts`, `humanoid.ts`). Rig dan semua klip animasi sama dengan hero sekarang
  (Idle, Walk, Run, Skate, Bike, ditambah Sit dari 3.8 dan klip memancing di `FISHING.md`).
- **Gaya baju, celana, dan rambut** dibuat sebagai node mesh terpisah di GLB yang sama (3 baju + 3 celana +
  1 rambut per gender). Runtime hanya menampilkan node terpilih (`visible`), jadi tidak perlu 1.458 file.
- **Warna** diterapkan lewat material per slot (`hair`, `shirt`, `pants`) yang di-clone per karakter dan diberi
  warna dari palet. Warna disimpan sebagai **id opsi**, bukan kode warna bebas, supaya palet bisa disesuaikan
  tanpa merusak profil.
- **Ekspresi wajah** sebagai 3 node kecil (alis + mulut, vertex color) di kepala, satu yang terlihat. Mata tetap.
- **Budget:** total segitiga semua varian di satu file ≤ 3.5k, yang terlihat ≤ 2k (hero sekarang tetap di
  budget). Draw call tetap sama karena slot material sama, hanya node yang berganti.
- Validator aset menambah cek: tiap kombinasi gaya baju × celana tidak saling menembus pada pose preview
  (walk, run, skate, bike, sit).

### 9.4 Penyimpanan

- `PlayerProfile` di `profile.ts` ditambah field `appearance`:

```ts
interface Appearance {
  gender: 'm' | 'f';
  hairColor: 0 | 1 | 2;
  expression: 0 | 1 | 2;
  shirtColor: 0 | 1 | 2;
  shirtStyle: 0 | 1 | 2;
  pantsColor: 0 | 1 | 2;
  pantsStyle: 0 | 1 | 2;
}
```

- **SQLite:** `PlayerDbPlugin.java` naik ke `VERSION = 2`. `onUpgrade` menjalankan
  `ALTER TABLE ... ADD COLUMN appearance TEXT` (JSON), tanpa menghapus baris lama. Nilai kosong berarti
  default (tampilan hero sekarang). Plugin memvalidasi semua field (gender `m`/`f`, angka 0-2) sama seperti
  validasi username.
- Fallback browser (`npm run dev`): field yang sama di Preferences `player_profile_v1`.
- `appearance` **tidak** masuk save game (`saveGame.ts`). Save hanya berisi progres, sedangkan penampilan milik
  profil, jadi "Mulai baru" tidak mengubah tampilan.

### 9.5 Integrasi dengan sistem lain

- **NPC AI:** system prompt menyebut sapaan sesuai gender, misalnya **"Mas {username}"** atau
  **"Mbak {username}"** (sapaan umum di Indonesia), dan ringkasan penampilan singkat ("memakai hoodie merah")
  supaya NPC bisa berkomentar natural. Aturan konteks kota di `chat.ts` tetap berlaku.
- **Multiplayer:** pemain lain melihat penampilan ini. Format dan sinkronnya di `MULTIPLAYER.md` bagian 3.1.
- **Pejalan kaki ambient** (`ped_citizen`, 3.5) bisa memakai GLB dan opsi yang sama dengan pilihan acak dari seed
  warga, jadi kota lebih beragam tanpa aset tambahan.

### 9.6 Estimasi

| Tugas | Estimasi |
| --- | --- |
| Aset `char_hero_m`/`char_hero_f` + 3 gaya baju, 3 celana, rambut, 3 ekspresi, validasi kombinasi | 2 hari |
| UI pilihan + pratinjau 3D + aksesibilitas + tombol Acak | 1.5 hari |
| `Appearance` di `profile.ts`, migrasi SQLite v2, fallback browser, unit test | 0.5 hari |
| Terapkan di game (node + material), sapaan Mas/Mbak di prompt AI | 0.5 hari |
| Uji di HP (semua animasi, migrasi profil lama), build APK | 0.5 hari |
| **Total Fase E** | **5 hari** |
Rincian tugas dan estimasi waktu ada di [`TASKS.md`](TASKS.md).
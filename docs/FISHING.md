# Fitur Baru: Memancing, Tas Terbatas, Tempat Sampah, dan Jual Ikan

Status: implementasi tahap F3 berjalan; dokumen ini satu-satunya rujukan untuk fitur memancing. Bergantung
pada **toko dan ekonomi** (koin, `wallet.ts`, `inventory.ts`) di [`CONTENT_UPDATES.md`](CONTENT_UPDATES.md)
bagian 6 / tahap U2b. Mini-game utama kini **gauge timing horizontal**; seluruh bahasa "bar pancing vertikal /
meter gulungan" dari versi rencana lama **ditarik** dan digantikan oleh bagian 3.1 (lihat juga 12.5).

## 1. Ringkasan

| Bagian | Isi |
| --- | --- |
| Danau | Danau baru di peta (sekarang dunia belum punya air sama sekali) dengan titik pancing di tepinya |
| Memancing | Tombol "Pancing" muncul di tepi danau. Lempar, tunggu umpan dimakan, tarik dengan mini-game sederhana |
| Hasil | Tidak selalu ikan: bisa **kaleng, sepatu bot, celana dalam bekas, sandal bekas**, atau lepas |
| Tas | Hasil masuk **tas dengan slot terbatas**. Tas penuh = tidak bisa memancing sampai dikosongkan |
| Tempat sampah | Di pinggir jalan, tepi danau, taman, dan plaza. Tombol "Buang" untuk membuang sampah dari tas |
| Jual ikan | Di lapak ikan (NPC penjual ikan). **Harga = harga per kg jenis ikan × berat** |

## 2. Danau

- **Lokasi:**
  - Peta sekarang (512 m): satu **Danau Kota tepat di sebelah taman** (diputuskan). Taman yang ada **tetap**,
    danau mengisi 2×2 blok kosong/perumahan yang bersebelahan dengan blok taman, sekitar 56 × 56 m air.
    - Generator memilih blok taman yang punya 2×2 blok tetangga tanpa NPC, halte, atau spawn kendaraan, lalu
      menghapus jalan di antara blok danau supaya airnya menyatu.
    - Sisi danau yang menempel ke taman menjadi **Taman Tepi Danau**: jalur pejalan kaki di tepi air, bangku
      menghadap danau (memakai bangku dan titik duduk dari `NEXT_FEATURES.md` 3.8), lapak ikan, dan tempat sampah.
    - Validator memastikan posisi 5 NPC, kendaraan awal, halte, dan spawn pemain tidak berubah.
  - Peta 1.024 m (`CONTENT_UPDATES.md` U4): danau besar di **Taman Kota**, dan dermaga pancing di
    **Pelabuhan/Pantai** (laut, jenis ikan berbeda).
- **Generator dunia:** tipe blok baru `lake` di `worldGen.ts` dan surface baru `water` di `SURFACE` +
  `SURFACE_COLORS` (biru di minimap dan peta besar). `WORLD_DATA_VERSION` naik.
- **Tabrakan:** air tidak bisa dimasuki. Tepi danau diberi collider (pemain berhenti di bibir danau). Kendaraan juga
  berhenti. Navmesh tidak mencakup air, jadi warga dan hewan tidak masuk danau.
- **Titik pancing:** dibake ke chunk JSON (`fishingSpots: [{ id, x, z, yaw, water: 'lake' | 'sea' }]`), sekitar
  1 titik per 6 m di sepanjang tepi, ditambah dermaga kayu kecil. Hanya satu pemain per titik.
- **Render:** satu plane air per chunk dengan shader murah (warna dalam/dangkal dari vertex color, riak normal
  bergulir, pantulan langit palsu dari warna `DayNight`). 1 draw call per chunk, tanpa refleksi real-time.
- **Dekorasi:** dermaga kayu, batu tepi, alang-alang, bebek (opsional, dari sistem hewan ambient di
  `NEXT_FEATURES.md`).

## 3. Mekanik Memancing

### 3.1 Alur

1. Pemain jalan kaki dalam 1.5 m dari titik pancing kosong, maka tombol **"Pancing"** muncul di kluster aksi
   (slot sendiri, gaya MOBA seperti tombol lain).
2. Tekan "Pancing": karakter menghadap air, animasi lempar (`anim_Cast`), pelampung jatuh di 4-7 m.
3. **Menunggu** 3-12 detik (acak). Pelampung bergoyang kecil sesekali sebagai umpan palsu.
4. **Umpan dimakan:** pelampung tenggelam, getar HP (jika diizinkan) + SFX. Fase `bite` langsung memulai
   gauge timing (langkah 5); `biteWindowMs` (1,2 detik) hanya dipertahankan untuk kompatibilitas wire/store.
5. **Mini-game gauge timing horizontal** (batas waktu mengikuti tuning kesulitan pada butir di bawah).
   Ini mode utama (revisi
   12.5; bahasa bar pancing vertikal/meter gulungan lama **ditarik**). Gauge horizontal menampilkan
   **target (zona hijau)** statis di satu posisi dan **jarum** yang menyapu bolak-balik; pemain menekan
   **"Tarik"** tepat saat jarum berada di dalam target:
   - Muncul di sisi kanan layar di atas tombol aksi: **gauge horizontal** dengan
     - **zona target hijau** (posisi dan lebar tetap selama satu percobaan, di [0..1]),
     - **jarum** yang menyapu dari kiri ke kanan lalu memantul di kedua ujung,
     - **hitungan waktu tersisa** `durationMs` (nilai ditentukan kesulitan ikan dan mode aksesibilitas).
   - **Satu ketukan "Tarik"** = satu percobaan. Jarum di dalam zona (inklusif, batas dihitung) = berhasil.
     Di luar zona = gagal: **near miss → ikan lepas** (`escaped`); **miss jauh pada ikan sulit → senar
     putus** (`line-break`, tegangan > 0,5).
   - Kesulitan (1 mujair … 5 patin) mempersempit zona target (mis. lebar 0,28 pada tingkat 1) dan
     mempercepat jarum. Sampah (kaleng, sepatu, dll.) selalu kesulitan 1, jadi paling mudah.
   - Waktu habis tanpa ketukan = **ikan lepas** (`escaped`); percobaan tambahan setelah selesai ditolak
     (state terminal tidak berubah).
   - Konstanta tuning saat ini: durasi dasar 1.200 ms; mode mudah +900 ms; tiap kenaikan tingkat kesulitan
     mengurangi 100 ms. Nilai ini menjadi gerbang test hingga dipindah ke konten/config.
   - Joran karbon memperlebar zona target 25%.
   - Umpan balik: getar pendek saat berhasil/gagal, SFX reel saat menarik, dan joran 3D melengkung
     sesuai tegangan.
   - Bisa dimainkan dengan satu jempol. Tombol "Tarik" besar (≥ 72 px) di posisi tombol aksi utama,
     joystick tidak dipakai selama mini-game.
6. **Hasil:** kartu kecil muncul (nama, berat untuk ikan, perkiraan harga), lalu masuk tas. Tombol "Lepas"
   untuk melepas ikan kembali ke danau. Outcome: `caught` (disimpan ke tas), `escaped` (waktu habis / di
   luar target), `line-broken` (senar putus), atau `cancelled` (pemain membatalkan; tidak mengubah tas).

**Gerbang lokomosi (movement lock):** selama sesi memancing aktif (`state.fishing !== null`) pemain
**terkunci penuh di tempat**: pindah titik, naik/turun kendaraan, duduk, dan naik bus tidak tersedia —
`Proximity` berhenti memindai target dan `ActionButtons` mengganti seluruh kluster aksi dengan satu tombol
"Batal". `canStartFishing()` hanya mengizinkan mulai saat mode `walk`, tidak duduk, tidak di bus, tidak
dijeda, dan peta tertutup. Kamera tetap bisa diputar; membatalkan ("Batal") melepas reservasi titik dan
mengembalikan kontrol.

- Memancing bisa dibatalkan kapan saja dengan tombol "Batal". Kamera tetap bisa diputar.
- **Mode mudah** (Pengaturan → Kontrol, aksesibilitas, **default mati**): gauge tetap tampil, tapi zona
  target lebih lebar, jarum lebih lambat, durasi lebih panjang, dan senar tidak bisa putus (semua miss
  menjadi `escaped`). Berat ikan maksimum dibatasi 70% supaya mode normal tetap lebih bernilai.
- **Getaran (haptics):** gigitan memakai `ImpactStyle.MEDIUM` (80 ms); ketukan yang berhasil/tangkapan
  memakai medium 50 ms; denyut ringan (`ImpactStyle.LIGHT`, ~10 ms) disediakan untuk feedback ketukan.
  Denyut ringan dibatasi maks. 1 per 50 ms agar input/frame loop tidak membanjiri motor. Di Android memakai
  Capacitor Haptics; di web fallback `navigator.vibrate`; bila getar ditolak/tak didukung, permainan tetap
  bisa dimainkan penuh.
- Selama memancing tombol Naik/Turun kendaraan dan Duduk disembunyikan (lihat gerbang lokomosi di atas).

### 3.2 Peralatan

| Barang | Didapat | Efek |
| --- | --- | --- |
| Joran bambu | Gratis dari NPC penjual ikan (quest pendek "Belajar mancing") | Bisa memancing |
| Joran karbon | Toko (sekitar 300 koin) | Zona hijau mini-game 25% lebih lebar |
| Umpan cacing / pelet | Toko (murah, habis pakai) | Peluang ikan naik, peluang sampah turun (lihat 4.1) |

- Joran dan umpan masuk tas sebagai **barang alat** dan tidak memakan slot hasil tangkapan (kantong alat terpisah).

## 4. Hasil Tangkapan

### 4.1 Peluang dasar (per tangkapan berhasil)

| Hasil | Tanpa umpan | Dengan umpan |
| --- | --- | --- |
| Ikan | 55% | 70% |
| Kaleng bekas | 13% | 9% |
| Sandal bekas | 12% | 8% |
| Sepatu bot | 10% | 7% |
| Celana dalam bekas | 10% | 6% |

- Peluang ikan ini berlaku setelah mini-game berhasil. Kegagalan mini-game (lepas/senar putus) dihitung terpisah.
- **Jam dalam game:** pagi (05.00-08.00) dan sore (16.00-18.00) peluang ikan +10%. Malam lebih
  banyak lele.
- **Anti-farming:** jika satu titik pancing dipakai terus lebih dari 10 tangkapan, peluang ikan di titik itu
  turun 15% sampai pemain pindah titik. Mendorong pemain berkeliling danau.
- Semua angka ada di `content/base/fishing.json`, jadi bisa disesuaikan lewat paket unduhan tanpa APK baru.

### 4.2 Jenis ikan (danau)

| Ikan | Peluang di antara ikan | Berat (kg) | Harga per kg | Catatan |
| --- | --- | --- | --- | --- |
| Mujair | 30% | 0.1-0.6 | 8 | Paling umum |
| Nila | 28% | 0.2-1.2 | 10 | |
| Lele | 18% | 0.3-1.5 | 9 | Peluang 2× di malam hari |
| Ikan mas | 14% | 0.5-3.0 | 14 | |
| Gurame | 8% | 0.8-4.0 | 18 | Tarikan lebih kuat |
| Patin | 2% | 2.0-8.0 | 22 | Langka, mini-game paling sulit |

- **Berat diacak miring ke kecil:** `berat = min + (max - min) × r²` dengan `r` acak 0-1. Ikan besar jarang.
  Berat dibulatkan 0.01 kg.
- Laut (dermaga Pelabuhan/Pantai, setelah U4) punya tabel sendiri: kembung, tongkol, kakap, kerapu (langka).

### 4.3 Harga jual ikan

- **Harga = `round(hargaPerKg × berat)`**, minimal 1 koin. Contoh:
  - Mujair 0.35 kg × 8 = **3 koin**.
  - Ikan mas 2.4 kg × 14 = **34 koin**.
  - Patin 6.8 kg × 22 = **150 koin**.
- **Pasar jenuh harian:** setelah 10 ekor dari jenis yang sama dijual dalam satu hari game, harga jenis itu turun
  5% per ekor (minimal 50%), reset di hari berikutnya. Mencegah memancing jadi sumber koin tak terbatas.
- **Target keseimbangan** (sesuai `CONTENT_UPDATES.md` 6.6): pendapatan memancing sekitar setara pekerjaan
  berulang per jam main, dengan peluang "jackpot" kecil dari ikan langka. Dicek oleh simulasi di `content:check`.
- Sampah **tidak bisa dijual**.

## 5. Tas (Inventori Terbatas)

- Tas memakai `inventory.ts` dari tahap U2b, ditambah **slot terbatas** untuk barang tangkapan/sampah.

| Tas | Slot | Didapat |
| --- | --- | --- |
| Tas awal | 8 | Bawaan |
| Tas ransel | 14 | Toko (sekitar 250 koin) |
| Tas carrier | 20 | Toko (sekitar 600 koin), terbuka setelah quest memancing |

- **Aturan slot:**
  - Tiap ikan 1 slot (beratnya berbeda-beda, jadi tidak ditumpuk).
  - Sampah sejenis ditumpuk sampai 5 per slot.
  - Alat (joran, umpan) dan barang kosmetik dari toko tidak memakan slot.
- **Tas penuh:** tombol "Pancing" tetap tampil tapi nonaktif dengan label "Tas penuh", dan pesan
  "Buang sampah atau jual ikan dulu". Hasil tangkapan terakhir yang tidak muat boleh dilepas atau menggantikan
  barang lain (pilihan di kartu hasil).
- **Panel tas:** tombol tas di HUD (ikon + jumlah slot terpakai, misal `6/8`). Panel menampilkan barang, berat
  ikan, perkiraan harga, dan tombol "Lepas" (khusus ikan, hanya saat dekat air).
- **Tidak bisa membuang sampah sembarangan.** Sampah hanya bisa keluar dari tas lewat tempat sampah. Ikan bisa
  dijual atau dilepas ke air.
- Save v2 (lihat `CONTENT_UPDATES.md` 7): field `bag` (`capacity`, daftar `{ id, kind, species?, weight?, qty }`).
  Ikan tidak membusuk di v1.

## 6. Tempat Sampah

- Memakai aset yang sudah ada `prop_trashbin_01` (sekarang hanya di blok taman), ditambah varian
  `prop_trashbin_02` (tong sampah pilah organik/anorganik, warna hijau dan kuning).
- **Penempatan baru** di generator dunia:
  - **Pinggir jalan:** 1 per sisi blok di Pusat Kota dan Perumahan, mengikuti aturan jarak street furniture
    (≥ 1.5 m dari lampu, bangku, dan halte; tidak di 6 m terakhir sebelum persimpangan).
  - **Tepi danau:** tiap 20-25 m di jalur keliling danau, dan di ujung dermaga.
  - **Tempat tertentu:** halte bus, plaza Pusat Kota, lapak ikan, dan depan toko.
- Titik buang dibake ke chunk JSON (`trashBins: [{ id, x, z }]`) dan tampil sebagai ikon kecil di minimap saat
  tas berisi sampah (supaya pemain tahu harus ke mana).
- **Tombol "Buang"** muncul dalam 1.5 m dari tempat sampah jika tas berisi sampah. Satu tekan membuang **semua
  sampah** dari tas, dengan animasi singkat dan SFX.
- **Hadiah kebersihan:** +1 koin per sampah yang dibuang (batas 30 koin per hari game) dan statistik
  "Sampah dibuang". Kecil supaya tidak lebih menguntungkan dari ikan, tapi memberi alasan membuang dengan benar.

## 7. Lapak Ikan dan NPC Penjual

- **Lapak ikan** di tepi Danau Kota (dan pasar ikan di Pelabuhan/Pantai setelah U4), dengan NPC bernama, misal
  **Pak Darto, penjual ikan**. NPC bisa diajak chat AI seperti NPC lain dan punya persona di paket konten.
- **Tombol "Jual ikan"** muncul dekat lapak jika tas berisi ikan. Membuka panel jual:
  - Daftar ikan dengan berat dan harga, pilih satu atau **"Jual semua"**.
  - Total koin ditampilkan sebelum konfirmasi. Transaksi lewat `wallet.ts` (tercatat di ledger).
- **AI tidak menentukan harga dan tidak bisa membeli/memberi koin.** Harga selalu dari rumus di 4.3. Persona
  Pak Darto diberi daftar harga per kg dan tips (jam ramai ikan, umpan), supaya jawabannya konsisten dengan game.
- Quest awal **"Belajar mancing"**: bicara ke Pak Darto, dapat joran bambu, tangkap 1 ikan, jual ikan pertama.
  Memakai tipe langkah quest di `CONTENT_UPDATES.md` 3.2, ditambah tipe baru **`catch`** (tangkap ikan jenis/berat
  tertentu) dan **`dispose`** (buang N sampah).

## 8. Multiplayer

- Mengikuti `MULTIPLAYER.md`: **tas, koin, hasil tangkapan, posisi target/jarum gauge, input ketukan, dan
  hasil RNG tetap lokal milik pemancing** (tidak direplikasi dan disimpan di HP masing-masing).
- Host/server menjadi otoritas **reservasi titik**: satu pemilik per `spotId`; klaim konflik ditolak; reservasi
  dilepas saat hasil, batal, putus koneksi, atau heartbeat basi (TTL 5 detik).
- Pemancing menerbitkan state visual ringkas berversi (`FISHING_SYNC_VERSION = 1`, payload 8 byte):
  `phase` (`idle|cast|wait|bite|reel`), indeks titik, serta posisi pelampung X/Z (presisi 0,01 m). Sequence
  yang stale/duplikat diabaikan, termasuk dengan wrap-around 16-bit; payload panjang/versi/fase di luar
  kontrak ditolak.
- Pemain lain hanya merender fase animasi yang sesuai (`anim_Cast`, `anim_FishIdle`, `anim_Reel`), joran,
  senar, dan pelampung. Fase `result`/batal diterbitkan sebagai `idle` agar visual dibersihkan; gauge pribadi
  tidak pernah tampil pada klien lain.
- Gelembung hasil ("Dapat nila 0.8 kg!" atau "Dapat sepatu bot...") bersifat kosmetik setelah hasil lokal;
  tidak memberi barang/koin kepada klien lain. Hasil acak lokal dapat dicurangi pemilik HP, tetapi tidak
  berdampak lintas pemain karena tidak ada perdagangan antar pemain.

## 9. Aset Baru (Mode B, prosedural)

| ID | Segitiga | Catatan |
| --- | --- | --- |
| `water_surface` | Plane per chunk | Shader air murah, 1 draw call per chunk |
| `prop_dock_01` | ≤ 400 | Dermaga kayu kecil |
| `prop_reeds_01` | ≤ 150 | Alang-alang, instanced |
| `prop_trashbin_02` | ≤ 250 | Tong sampah pilah |
| `prop_fish_stall_01` | ≤ 600 | Lapak ikan dengan atap |
| `tool_rod_bamboo`, `tool_rod_carbon` | ≤ 120 | Dipegang di tangan kanan, senar digambar sebagai garis (1 draw call) |
| `prop_bobber` | ≤ 40 | Pelampung |
| `item_fish_*` (6 jenis) | ≤ 200 | Tampil di kartu hasil dan tangan saat diangkat, 1 mesh dengan warna per jenis |
| `item_can`, `item_boot`, `item_underwear`, `item_sandal` | ≤ 150 | Sampah, tampil di kartu hasil |
| `hero` (update) | - | Klip `anim_Cast`, `anim_FishIdle`, `anim_Reel`, `anim_Throw` (buang sampah) |
| `npc_fishmonger` | ≤ 1.5k | Variasi `npc_vendor` (celemek, topi) |

- **Kontrak animasi karakter/pose:** memasuki fase `cast` menjalankan pose cast satu kali selama 700 ms;
  pose `casting` diinterpolasi ke `release` dengan `smoothCast`, sambil karakter menghadap air dan memegang
  joran; fase `wait`, `bite`, dan `reel` mempertahankan pose `holding`. Jika klip rig tersedia, pemetaan yang
  dituju adalah `anim_Cast`, `anim_FishIdle`, dan `anim_Reel`; fallback prosedural memakai `fishingPose.ts`.
  Selesai/batal melepas joran dan kembali ke locomotion idle. Transisi tidak boleh menggeser root transform
  pemain (movement lock tetap berlaku).
- **SFX + getaran:** gigitan dan tangkapan memakai getar medium; denyut ringan saat menarik (lihat 3.1).

- Ikon tas, ikon tempat sampah, dan ikon lapak ikan di minimap dibuat sebagai SVG di UI.
- SFX prosedural baru: lempar, pelampung jatuh, gigitan, gulungan reel, senar putus, ikan menggelepar, buang sampah.

## 10. Struktur Kode

```
web/src/fishing/
  lootTable.ts       peluang hasil, jenis ikan, berat r², faktor jam/umpan/anti-farming (murni) + test
  fishingMinigame.ts gauge timing horizontal: target, jarum, durasi, escaped/line-break, mode mudah (murni) + test
  fishingHaptics.ts  Capacitor Haptics + fallback navigator.vibrate, throttle denyut ringan + test
  fishingSync.ts     codec wire 8 byte fase/pelampung + urutan berversi (murni) + test
  fishingMultiplayerBridge.ts  jembatan reservasi titik & publikasi state ke netRuntime + test
  fishingSpots.ts    registrasi reservasi titik pancing di host (murni) + test
  fishingPose.ts     pose joran per fase (casting/holding/idle) + smoothCast easing
  fishingVisuals.ts  render joran 3D + garis senar + pelampung dari state sesi
  fishPrice.ts       harga per kg × berat, pasar jenuh harian + test
  FishingController.tsx  state cast/wait/bite/reel/result, outcome caught/escaped/line-broken/cancelled
  FishingHud.tsx     tombol Tarik, gauge timing horizontal, kartu hasil, aksesibilitas ARIA ≥ 72 px
web/src/game/
  fishingActions.ts  integrasi store: canStartFishing, startFishing, updateFishing, cancel, reservasi
  fishingLock.ts    freeze posisi/heading pemain saat sesi aktif + filter input locomotion
web/src/economy/
  bag.ts             slot, tumpukan sampah, kapasitas tas, buang/jual/lepas + test
  BagPanel.tsx       panel tas
  FishStallScreen.tsx panel jual ikan
web/content/base/
  fishing.json       tabel hasil, ikan, harga, peluang, batas harian
```

- `Proximity` ditambah `fishingSpotId`, `trashBinId`, dan `fishStallId`. `ActionButtons` menambah tombol
  "Pancing", "Buang", dan "Jual ikan" dengan slot sendiri, tetap gaya MOBA.

## 11. Tahapan dan Estimasi (hari kerja, 1 developer)

| Tahap | Isi | Estimasi |
| --- | --- | --- |
| F1. Danau dan air | Blok `lake` di sebelah taman, Taman Tepi Danau, surface `water`, collider tepi, navmesh, shader air, titik pancing, dermaga, peta/minimap | 3 hari |
| F2. Tas terbatas | `bag.ts`, slot dan tumpukan, kapasitas, `BagPanel`, save `bag`, ikon HUD | 1.5 hari |
| F3. Memancing | `FishingController`, lempar/tunggu/gigit, gauge timing horizontal sekali-ketuk, mode mudah, movement lock, haptics, tombol "Pancing" dan "Tarik", animasi cast/hold/reel | 3 hari |
| F4. Hasil tangkapan | `lootTable.ts`, 6 ikan, 4 sampah, berat, faktor jam/umpan, anti-farming, `fishing.json`, kartu hasil | 1 hari |
| F5. Tempat sampah | Penempatan pinggir jalan/tepi danau/titik tertentu, tombol "Buang", hadiah kebersihan, ikon minimap | 1 hari |
| F6. Jual ikan | Lapak + NPC Pak Darto + persona, `fishPrice.ts`, pasar jenuh, `FishStallScreen`, quest "Belajar mancing", tipe langkah `catch`/`dispose` | 2 hari |
| F7. Aset dan audio | Aset di bagian 9, klip animasi hero, SFX prosedural | 2 hari |
| F8. Multiplayer | State `fishing` disinkron, pelampung terlihat, reservasi titik pancing, gelembung tangkapan | 0.75 hari |
| F9. Uji dan rilis | Unit test, simulasi keseimbangan, uji HP (FPS di tepi danau, sentuhan mini-game), APK/paket konten | 1.25 hari |
| **Total** | | **15.5 hari (sekitar 3 minggu)**, +20% cadangan |

- **Urutan:** dikerjakan **setelah U2b** (toko dan ekonomi) di `CONTENT_UPDATES.md`, karena butuh `wallet` dan
  `inventory`. F8 hanya perlu jika multiplayer (`MULTIPLAYER.md`) sudah selesai.
- **Pengiriman:** butuh **APK baru** (mekanik, shader air, dan kode baru). Setelah itu, jenis ikan, harga, dan peluang
  bisa diubah lewat paket unduhan.
- **Gerbang:**
  - F1: danau bersebelahan dengan taman, posisi NPC/kendaraan/halte/spawn tidak berubah, tidak ada pemain, kendaraan, warga, atau hewan yang masuk air, dan FPS di tepi danau tetap ≥ 30 di mid-range.
  - F3: gauge timing bisa dimainkan dengan satu jempol tanpa bentrok dengan joystick, ikan langka terasa lebih sulit dari ikan umum, dan mode mudah berfungsi.
  - F4/F6: 10.000 simulasi tangkapan sesuai peluang (toleransi ±1%), harga sesuai rumus, pasar jenuh reset per hari.
  - F2/F5: tas tidak pernah melebihi kapasitas, sampah hanya keluar lewat tempat sampah, save/load tas utuh.
  - F8: reservasi titik bersifat satu-pemilik dengan TTL 5 detik; frame sync berversi ditolak bila panjang/versi/fase di luar kontrak; state stale dari sequence lama tidak pernah menggantikan yang lebih baru (termasuk wrap-around 16-bit).

## 11a. Skenario Penerimaan (Acceptance Scenarios)

Skenario dijalankan otomatis bila memungkinkan (unit test `web/src/fishing/*.test.ts`) dan manual di desktop
plus satu perangkat Android satu-jempol. Satu skenario = satu alasan gagal rilis.

**Desktop (mouse/keyboard):**

1. **Gauge timing akurat:** buka sesi memancing hingga gauge aktif (fase `bite`/`reel`); langkah simulasi
   menggerakkan jarum bolak-balik tanpa input dan memantul di ujung [0..1]; ketukan saat jarum berada pada
   batas target (inklusif) → `result/caught` dengan `attempts = 1` (fishingMinigame.test.ts,
   FishingController.test.ts).
2. **Hasil gagal deterministik:** near miss (+0,01 di luar target) → `escaped`; miss jauh pada ikan
   kesulitan ≥ 4 → `line-broken` dengan SFX `line-break` (fishingMinigame.test.ts,
   FishingController.test.ts).
3. **Timeout = lepas:** biarkan `durationMs` habis tanpa ketukan → `result/escaped`, `remainingMs = 0`,
   `loot` tidak dihasilkan, dan ketukan lanjutan diabaikan (state terminal tetap)
   (fishingMinigame.test.ts, FishingController.test.ts).
4. **Mode mudah:** aktifkan Pengaturan → Kontrol → Mode mudah; target lebih lebar, jarum lebih lambat,
   durasi lebih panjang, dan miss jauh tidak pernah `line-broken` (fishingMinigame.test.ts,
   FishingController.test.ts).
5. **Joran karbon:** target 25% lebih lebar daripada joran bambu pada kesulitan sama; state input tidak
   pernah termutasi (fishingMinigame.test.ts).
6. **Gerbang lokomosi:** saat sesi memancing aktif, posisi/heading pemain dibekukan pada pose awal meski ada
   input atau tulisan jaringan; vektor keyboard/joystick difilter jadi nol; setelah sesi berakhir, gerbang
   melepas dan sesi berikutnya menangkap pose baru. Selain itu kluster aksi hanya menampilkan "Batal", dan
   `canStartFishing()` menolak start saat tidak mode `walk`, duduk, di bus, dijeda, atau peta terbuka
   (fishingLock.test.ts, fishingActions.test.ts, ActionButtons.tsx).
7. **Haptics & aksesibilitas HUD:** tombol Tarik dan Batal mempunyai `aria-label` dan target sentuh ≥ 72 px;
   vibrator memakai gaya MEDIUM untuk kejadian salien, LIGHT untuk denyut, dan throttle 50 ms; di web fallback
   `navigator.vibrate` dipakai dan getar ditolak tidak mengganggu permainan (fishingHaptics.test.ts,
   FishingHud.render.test.ts).

**Android satu-jempol:**

8. **Putar–tunggu–ketuk tanpa menggeser jempol:** mulai memancing dari tombol kluster aksi; setelah gigitan
   gauge langsung menyapu dan layar hanya menuntut satu ketukan "Tap/Tarik"; joystick tidak dipakai dan
   gerbang lokomosi menolak drag untuk memindahkan karakter.
9. **Timeout gauge:** lewatkan `durationMs` tanpa ketukan → kartu hasil "Ikan lepas!" (`escaped`), tanpa
   perubahan tas, dan reservasi titik dilepas (FishingController.test.ts, fishingActions.test.ts).
10. **Loop multiplayer:** dua perangkat dalam satu sesi; pemain B tidak bisa menempati titik yang sedang
    dipakai A; A membatalkan → titik langsung bisa diklaim B; frame fase A (`cast/wait/bite/reel`) tampil di
    klien B dengan payload 8 byte yang sah; payload korup/versi salah diabaikan tanpa crash
    (fishingMultiplayerBridge.test.ts, fishingSync.test.ts, fishingSpots.test.ts).
11. **Alur penuh sekali ketukan:** lempar → tunggu (3-12 dtk) → gigitan (getar + SFX) + gauge → ketuk di
    target → kartu hasil "Simpan" → ikan masuk tas dan slot terpakai bertambah; alternatif gagal
    (escaped/line-broken/cancelled) menampilkan kartu "Tutup" tanpa mengubah tas.

## 12. Keputusan (dikonfirmasi 2026-10-02)

1. Lokasi danau: **di sebelah taman**. Taman tetap ada dan menjadi Taman Tepi Danau.
2. Tas awal **8 slot**, upgrade 14 dan 20 lewat toko.
3. Hadiah **+1 koin per sampah** yang dibuang, maksimal 30 per hari.
4. Ikan **tidak membusuk** di v1.
5. **Mini-game gauge timing horizontal sekali-ketuk** (revisi 2026-10, menggantikan keputusan lama "bar
   pancing tarik" — bar vertikal/meter gulungan **ditarik**). Mode mudah tetap ada di Pengaturan → Kontrol
   untuk aksesibilitas, default mati.
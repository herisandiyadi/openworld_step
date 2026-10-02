# Fitur Baru: Memancing, Tas Terbatas, Tempat Sampah, dan Jual Ikan

Status: rencana, terpisah dari dokumen lain. Bergantung pada **toko dan ekonomi** (koin, `wallet.ts`,
`inventory.ts`) di [`CONTENT_UPDATES.md`](CONTENT_UPDATES.md) bagian 6 / tahap U2b. Dokumen ini satu-satunya
rujukan untuk fitur memancing.

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
4. **Umpan dimakan:** pelampung tenggelam, getar HP (jika diizinkan) + SFX. Pemain punya **1.2 detik** untuk
   menekan tombol **"Tarik"**. Terlambat = ikan lepas.
5. **Mini-game bar pancing tarik** (2-6 detik, lebih lama untuk ikan berat). Ini mode utama (diputuskan).
   - Muncul di sisi kanan layar di atas tombol aksi: **bar vertikal** dengan
     - **zona tarik hijau** yang bisa digerakkan pemain,
     - **ikon ikan** yang naik-turun sendiri di dalam bar,
     - **meter gulungan** di samping bar (0-100%).
   - **Tahan tombol "Tarik"** = zona hijau naik dan senar digulung. **Lepas** = zona hijau turun.
   - Selama ikon ikan berada di dalam zona hijau, meter gulungan naik. Di luar zona, meter turun pelan.
   - **Tegangan senar:** menahan "Tarik" terus saat ikan di luar zona menaikkan tegangan. Indikator tegangan
     berubah kuning lalu merah. Merah lebih dari 1 detik = senar putus, hasil lepas.
   - Meter gulungan **100% = berhasil**. Meter 0% = ikan lepas.
   - Gerak ikon mengikuti jenis dan berat: mujair pelan dan tenang, gurame dan patin cepat dengan sentakan acak.
     Sampah (kaleng, sepatu, dll.) hampir diam, jadi mudah ditarik.
   - Joran karbon memperlebar zona hijau 25%.
   - Umpan balik: getar pendek saat ikan masuk/keluar zona (jika getar diizinkan), suara reel mengikuti
     kecepatan gulungan, dan joran 3D melengkung sesuai tegangan.
   - Bisa dimainkan dengan satu jempol. Tombol "Tarik" besar (≥ 72 px) di posisi tombol aksi utama, joystick
     tidak dipakai selama mini-game.6. **Hasil:** kartu kecil muncul (nama, berat untuk ikan, perkiraan harga), lalu masuk tas. Tombol "Lepas" untuk
   melepas ikan kembali ke danau.

- Memancing bisa dibatalkan kapan saja dengan joystick atau tombol "Selesai". Kamera tetap bisa diputar.
- **Mode mudah** (Pengaturan, aksesibilitas, **default mati**): bar tetap tampil, tapi zona hijau 2× lebih lebar,
  ikon ikan bergerak lebih pelan, dan senar tidak bisa putus. Berat ikan maksimum dibatasi 70% supaya mode normal
  tetap lebih bernilai.
- Selama memancing tombol Naik/Turun kendaraan dan Duduk disembunyikan. "Tanya" tetap bisa dipakai (ngobrol
  dengan sesama pemancing).

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

- Mengikuti `MULTIPLAYER.md`: **tas, koin, dan hasil tangkapan per pemain** (disimpan di HP masing-masing).
- Pemain lain melihat animasi memancing dan pelampung (state `fishing` ditambah ke mode animasi yang disinkron,
  1 byte), serta gelembung singkat saat ada tangkapan ("Dapat nila 0.8 kg!" atau "Dapat sepatu bot...").
- Titik pancing direservasi di host/server, jadi dua pemain tidak berdiri di titik yang sama.
- Hasil acak dihitung di HP pemancing. Sama seperti ekonomi v1, ini bisa dicurangi oleh pemilik HP, tapi tidak
  berdampak ke pemain lain karena tidak ada perdagangan antar pemain.

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

- Ikon tas, ikon tempat sampah, dan ikon lapak ikan di minimap dibuat sebagai SVG di UI.
- SFX prosedural baru: lempar, pelampung jatuh, gigitan, gulungan reel, senar putus, ikan menggelepar, buang sampah.

## 10. Struktur Kode

```
web/src/fishing/
  lootTable.ts       peluang hasil, jenis ikan, berat r², faktor jam/umpan/anti-farming (murni) + test
  fishingMinigame.ts bar pancing: zona hijau, gerak ikon ikan per jenis, meter gulungan, tegangan, mode mudah (murni) + test
  fishPrice.ts       harga per kg × berat, pasar jenuh harian + test
  FishingController.tsx  state lempar/tunggu/gigit/tarik, pelampung, senar, animasi
  FishingHud.tsx     tombol Tarik, bar pancing vertikal, meter gulungan, indikator tegangan, kartu hasil
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
| F3. Memancing | `FishingController`, lempar/tunggu/gigit, mini-game bar pancing tarik, mode mudah, tombol "Pancing" dan "Tarik", animasi | 3 hari |
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
  - F3: bar pancing bisa dimainkan dengan satu jempol tanpa bentrok dengan joystick, ikan langka terasa lebih sulit dari ikan umum, dan mode mudah berfungsi.
  - F4/F6: 10.000 simulasi tangkapan sesuai peluang (toleransi ±1%), harga sesuai rumus, pasar jenuh reset per hari.
  - F2/F5: tas tidak pernah melebihi kapasitas, sampah hanya keluar lewat tempat sampah, save/load tas utuh.

## 12. Keputusan (dikonfirmasi 2026-10-02)

1. Lokasi danau: **di sebelah taman**. Taman tetap ada dan menjadi Taman Tepi Danau.
2. Tas awal **8 slot**, upgrade 14 dan 20 lewat toko.
3. Hadiah **+1 koin per sampah** yang dibuang, maksimal 30 per hari.
4. Ikan **tidak membusuk** di v1.
5. Mini-game **bar pancing tarik** sebagai mode utama. Mode mudah tetap ada di Pengaturan untuk aksesibilitas,
   default mati.
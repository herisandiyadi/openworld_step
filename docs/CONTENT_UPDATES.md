# Fase Setelah Multiplayer: Update Konten (Quest, NPC, Peta Diperluas, Toko dan Ekonomi)

Status: rencana. Dikerjakan **setelah M4** di [`MULTIPLAYER.md`](MULTIPLAYER.md). Dokumen ini satu-satunya rujukan
untuk sistem quest, penambahan NPC, perluasan peta, toko dan ekonomi, serta cara mengirim update konten ke pemain. Infrastruktur
server (VPS, domain, TLS) tetap dicatat di `MULTIPLAYER.md`.

## 1. Kondisi Sekarang dan Masalahnya

| Bagian | Sekarang | Masalah untuk update |
| --- | --- | --- |
| NPC | Array `NPCS` di `web/src/world/worldGen.ts` (5 NPC), persona di `NPC_PERSONAS` di `web/src/ai/chat.ts` | Tambah NPC = ubah kode + build APK baru |
| Quest | Satu quest tetap "Kenalan dengan warga", progres = `met: string[]` di `gameStore` | Tidak ada tipe quest lain, langkah, atau hadiah |
| Dunia | 8×8 chunk × 64 m = 512 m, `WORLD_CHUNKS` konstan, 2 distrik aktif | Ukuran terkunci di kode. `navmesh.bin` satu file 4,2 MB untuk seluruh peta |
| Save | `SAVE_VERSION = 1`, ditolak jika versi beda | Update apa pun yang mengubah save akan menghapus progres pemain |
| Distribusi | Semua konten ikut di dalam APK | Tiap update konten harus rilis APK |

Tujuan fase ini: **konten jadi data, bukan kode**. Quest, NPC, dan wilayah baru cukup ditambah lewat file data,
divalidasi oleh tool, lalu dikirim lewat APK atau unduhan paket konten.

## 2. Arsitektur Konten

### 2.1 Paket konten (content pack)

```
web/content/
  base/                    paket bawaan, ikut di APK
    manifest.json          id, version, minAppVersion, worldVersion, daftar file + SHA-256
    npcs.json              definisi NPC
    quests.json            definisi quest
    dialogue/<npcId>.json  persona AI + fakta yang boleh disebut + baris fallback offline
    regions.json           distrik dan wilayah peta (dipakai generator dunia)
    shops.json             toko: lokasi, NPC penjaga, daftar barang
    items.json             katalog barang: harga, kategori, efek
    economy.json           tabel pendapatan (quest, pekerjaan), batas harian
  update-2027-01/          contoh paket update berikutnya, struktur sama
```

- Satu paket = satu `manifest.json` + file data. **Hanya JSON, tidak ada kode** (tidak ada `eval`, skrip, atau
  ekspresi bebas). Logika quest dibatasi ke tipe langkah yang sudah didukung engine (lihat 3.2).
- Paket boleh menambah dan mengubah, tidak menghapus id yang sudah dipakai save pemain. Id yang pensiun ditandai
  `retired: true`.
- Skema ditulis dengan **zod** (versi di-pin saat implementasi) di `web/src/content/schema.ts`. Skema yang sama
  dipakai tool validasi, runtime, dan server multiplayer.

### 2.2 Modul baru

```
web/src/content/
  schema.ts         skema zod NpcDef, QuestDef, RegionDef, Manifest
  registry.ts       gabungkan paket base + update, cek konflik id, sediakan getNpc/getQuest/getRegion
  loader.ts         baca paket dari APK lalu dari penyimpanan lokal (paket unduhan), verifikasi hash
web/src/economy/
  wallet.ts         saldo koin, transaksi tercatat (ledger), aturan batas
  inventory.ts      barang milik pemain, item terpasang (equip)
  ShopScreen.tsx    UI toko (kategori, beli, preview, pasang)
web/src/quest/
  questEngine.ts    state machine quest (murni, mudah dites)
  questEvents.ts    event game: talk, reach, ride, collect, time
  QuestTracker.tsx  HUD quest aktif + daftar quest di menu pause
web/tools/content/
  validate.ts       `npm run content:check` — skema, referensi id, posisi NPC di jalan/trotoar, quest bisa diselesaikan
  pack.ts           `npm run content:pack` — buat manifest + hash, zip paket
```

- `NPCS` di `worldGen.ts` dan `NPC_PERSONAS` di `chat.ts` dipindah ke `content/base`. Kode membaca dari
  `registry`. Ini refactor pertama dan tidak mengubah gameplay.

## 3. Quest

### 3.1 Contoh definisi

```json
{
  "id": "q_antar_paket",
  "title": "Antar Paket Bu Sari",
  "giver": "npc_sari",
  "requires": ["q_kenalan"],
  "repeatable": false,
  "steps": [
    { "type": "talk", "npc": "npc_sari", "text": "Ambil paket dari Bu Sari" },
    { "type": "reach", "x": 69, "z": -54, "radius": 6, "text": "Bawa ke toko Mbak Rina" },
    { "type": "talk", "npc": "npc_rina", "text": "Serahkan paket" }
  ],
  "rewards": { "coins": 50, "items": ["paint_scooter_blue"] }
}
```

### 3.2 Tipe langkah (v1)

| Tipe | Selesai jika | Sumber event |
| --- | --- | --- |
| `talk` | Pemain membuka chat dengan NPC tertentu (minimal 1 pesan terkirim) | `NpcChat` |
| `reach` | Pemain masuk radius titik/area | `Proximity` (dicek 4 Hz, bukan per frame) |
| `ride` | Pemain menaiki jenis kendaraan tertentu (opsional: sampai tujuan dalam batas waktu) | `gameStore.riding` |
| `collect` | Mengambil item yang di-spawn quest di dunia | Item pickup baru |
| `visit_district` | Pertama kali masuk distrik tertentu | Fog of war / `exploration` |
| `time` | Jam dalam game di rentang tertentu | `DayNight` |

- Penyelesaian langkah ditentukan **oleh engine dari event game, bukan dari jawaban AI**. Chat AI hanya
  memberi warna cerita. Ini mencegah quest "selesai" karena model berhalusinasi atau pemain membujuk NPC.
- Persona NPC menerima ringkasan quest aktif yang terkait NPC itu (judul + langkah sekarang), maksimal ~300
  karakter, supaya jawaban AI nyambung dengan quest.
- Quest "Kenalan dengan warga" yang sekarang menjadi `q_kenalan` (langkah `talk` ke 5 NPC). Progres `met` lama
  dimigrasi otomatis.

### 3.3 Quest di multiplayer

- Progres quest **tetap per pemain** (sesuai `MULTIPLAYER.md` bagian 3). Server tidak menyimpan quest di v1.
- Item `collect` di-spawn lokal per pemain, jadi pemain lain tidak bisa "merebut" item quest.
- Quest kooperatif (misal "antar 3 penumpang bersama") di luar fase ini.

## 4. NPC Baru

### 4.1 Contoh definisi

```json
{
  "id": "npc_agus",
  "name": "Pak Agus",
  "asset": "npc_mechanic",
  "x": 210, "z": -40, "yaw": 1.57,
  "region": "industrial",
  "schedule": [
    { "from": 6, "to": 18, "x": 210, "z": -40 },
    { "from": 18, "to": 22, "x": 180, "z": -20 }
  ],
  "dialogue": "dialogue/npc_agus.json",
  "questGiver": ["q_bengkel"]
}
```

- **Jadwal sederhana:** NPC berpindah antar 1-3 titik berdasarkan jam, berjalan lewat navmesh. Di luar jadwal
  NPC tidak muncul (dan tidak tampil di peta).
- **Dialog AI:** file `dialogue` berisi `persona`, `facts` (hal yang boleh dia tahu tentang kota dan quest),
  dan `fallback` (beberapa baris statis saat AI tidak tersedia atau offline). Aturan konteks kota di `chat.ts`
  tetap berlaku untuk semua NPC.
- **Aset NPC:** variasi model tetap Mode B (prosedural) lewat `npm run assets`: kombinasi warna baju, topi,
  dan aksesori profesi (penjual, mekanik, satpam, sopir bus). Aset baru di paket update perlu GLB baru, jadi
  lihat batasan di bagian 7.
- **Penanda:** NPC dengan quest yang bisa diambil memakai penanda `!`, quest yang sedang berjalan `?`, di 3D,
  minimap, dan peta besar (memperluas penanda NPC yang sudah ada).
- Validator menolak NPC yang berdiri di dalam bangunan, di tengah jalan raya, atau di luar navmesh.

## 5. Perluasan Peta

### 5.1 Target

| | Sekarang | Setelah perluasan |
| --- | --- | --- |
| Grid | 8×8 chunk | **16×16 chunk** (diputuskan) |
| Ukuran | 512 m | **1.024 m** (4× luas) |
| Distrik | Pusat Kota, Perumahan | + **Kawasan Industri, Pelabuhan/Pantai, Taman Kota** (diputuskan) |
| Chunk JSON | 64 file, ~1,2 MB | 256 file, ~5 MB |

- Peta lama **tidak diubah**: 8×8 yang sekarang menjadi bagian tengah peta baru (offset chunk), jadi posisi
  NPC, kendaraan, dan save pemain tetap valid. Generator baru hanya mengisi cincin luar.
- Jalan penghubung antar distrik dan rute bus baru ditentukan di `regions.json` (titik halte + garis jalan
  utama). Fast travel bus otomatis memakai halte baru.

### 5.2 Perubahan teknis

- **`WORLD_CHUNKS` jadi data:** dibaca dari `public/world/index.json`, bukan konstanta. `HALF_WORLD`, batas peta,
  minimap, dan validasi posisi multiplayer ikut membaca dari sana.
- **Navmesh per tile:** `navmesh.bin` 4,2 MB untuk 512 m akan menjadi ~17 MB untuk 1.024 m. Diganti menjadi
  tile navmesh Recast per chunk (`navmesh/<x>_<z>.bin`) yang di-load dan di-unload bersama chunk. Tap-to-move
  dibatasi ke tile yang sudah ter-load (radius 2 chunk = 128 m, cukup untuk tap di layar).
- **Peta besar:** `map.png` 1.024 px dipecah jadi tile atau diperkecil ke 0,5 px/m untuk peta besar, tetap
  1 px/m untuk minimap. Fog of war (`exploration`) diperbesar dengan format yang sama, ditambah header ukuran.
- **Streaming:** `LOAD_RADIUS`/`UNLOAD_RADIUS` tetap, jadi beban memori per frame tidak naik. Yang naik hanya
  ukuran unduhan dan penyimpanan.
- **Budget:** jumlah chunk ter-load tetap 25, draw call dan memori tetap di bawah budget Fase 3. Yang diukur ulang:
  waktu load awal, ukuran APK, dan hitch saat masuk distrik baru.
- **Multiplayer:** semua pemain di satu room wajib punya `worldVersion` dan versi paket yang sama. Server
  menolak join dengan pesan "Perbarui konten dulu" jika berbeda. Batas peta untuk validasi gerak dibaca dari
  `index.json` yang sama.

## 6. Toko dan Ekonomi

Keputusan: **ada toko dan ekonomi** dengan mata uang dalam game (koin). Tidak ada musuh dan tidak ada kompetisi,
jadi ekonomi ini untuk **progres dan kustomisasi**, bukan menang-kalah.

### 6.1 Mata uang dan sumber koin

| Sumber | Contoh | Koin |
| --- | --- | --- |
| Quest | Hadiah di `rewards.coins` | 20-200 per quest |
| Pekerjaan berulang | Antar paket, ojek (antar NPC ke tujuan), kurir sepeda | 10-40 per tugas, batas harian |
| Eksplorasi | Pertama kali masuk distrik, menemukan landmark | 10-50, sekali saja |
| Harian | Bonus main pertama hari itu | 20 |

- **Satu mata uang** (koin) di v1, tanpa mata uang premium.
- **Tanpa pembelian uang sungguhan** (in-app purchase) di fase ini. Kalau nanti diperlukan, itu fitur terpisah
  karena butuh Google Play Billing, verifikasi server, dan aturan Play Store.
- **Pekerjaan berulang** memakai tipe langkah quest yang sama (`talk`, `reach`, `ride`, `collect`) dengan
  `repeatable: true` dan tujuan acak dari daftar titik di `economy.json`. Ini memberi pemasukan stabil setelah
  quest cerita habis.
- **Batas harian** per jenis pekerjaan (misal 15 tugas/hari) supaya ekonomi tidak cepat jenuh.

### 6.2 Barang di toko

| Kategori | Contoh | Efek |
| --- | --- | --- |
| Kendaraan | Varian motor/sepeda/skateboard, mobil pribadi | Kendaraan milik pemain, dipanggil di tempat parkir |
| Cat dan stiker kendaraan | Warna, motif | Kosmetik |
| Pakaian dan aksesori | Baju, topi, tas, helm | Kosmetik, terlihat juga di multiplayer |
| Upgrade kendaraan | Klakson, lampu, rak barang | Kosmetik atau kenyamanan (misal rak = bisa ambil pekerjaan antar paket) |
| Tiket | Tiket bus harian | Fast travel bus tanpa biaya per perjalanan |
| Garasi (v2) | Garasi di Perumahan | Tempat spawn dan menyimpan kendaraan |

- **Tidak ada barang yang memberi keuntungan besar** (misal kecepatan jauh lebih tinggi). Upgrade dibatasi
  kosmetik dan kenyamanan supaya pemain baru dan lama tetap setara di multiplayer.
- Fast travel bus jadi berbayar kecil (misal 5 koin per perjalanan), dengan tiket harian sebagai alternatif.

### 6.3 Toko di dunia

- Toko adalah lokasi fisik dengan **NPC penjaga** yang bisa diajak chat AI seperti NPC lain. Contoh: toko sepeda
  di Perumahan, dealer motor di Kawasan Industri, butik di Pusat Kota, toko suvenir di Pelabuhan/Pantai.
- Dekati toko, lalu tombol **"Belanja"** membuka `ShopScreen`. Di mode solo game di-pause seperti chat NPC,
  di multiplayer tidak.
- Penanda toko (ikon tas) di 3D, minimap, dan peta besar, dengan legenda baru.
- **AI tidak bisa menjual atau memberi barang.** Jual-beli hanya lewat `ShopScreen`, jadi pemain tidak bisa
  "menawar" ke model untuk barang gratis. Persona penjaga tahu daftar barang dan harga dari `items.json` supaya
  bisa memberi rekomendasi.
- Stok tidak terbatas di v1. Diskon dan barang mingguan diatur lewat paket konten (`shops.json`, rentang tanggal).

### 6.4 Data dan penyimpanan

```json
{
  "id": "paint_scooter_blue",
  "category": "vehicle_paint",
  "name": "Cat Skuter Biru",
  "price": 120,
  "appliesTo": "scooter",
  "asset": { "color": "#2f6fd6" },
  "unlockAfter": "q_antar_paket"
}
```

- Save v2 menambah `coins`, `inventory` (id barang), `equipped` (barang terpasang per slot), dan `jobs`
  (hitungan pekerjaan harian + tanggal).
- Semua perubahan koin lewat `wallet.ts` dan dicatat di ledger singkat (100 transaksi terakhir) untuk debug.
- Barang dengan id `retired` tetap dimiliki pemain, hanya tidak dijual lagi.

### 6.5 Ekonomi di multiplayer

- **Koin dan inventori disimpan di HP masing-masing**, konsisten dengan `MULTIPLAYER.md` (progres per pemain).
  Akibatnya, pemain yang mengubah file save bisa menambah koinnya sendiri.
- Ini **aman selama tidak ada perdagangan antar pemain** dan barang hanya kosmetik/kenyamanan. Koin curang
  hanya berdampak ke pemain itu sendiri.
- Pemain lain hanya melihat **barang terpasang** (pakaian, cat kendaraan). Server multiplayer mengecek id barang
  ada di katalog, tapi tidak memverifikasi kepemilikan.
- **Di luar fase ini:** transfer koin/barang, pasar antar pemain, dan leaderboard kekayaan. Semuanya butuh
  ekonomi di server (akun + saldo authoritative di database), karena tanpa itu mudah dicurangi.

### 6.6 Keseimbangan

- Target awal: barang kosmetik murah setara 3-5 pekerjaan, kendaraan baru setara 2-4 jam main.
- Semua angka (harga, hadiah, batas harian) ada di `economy.json` dan `items.json`, jadi bisa disesuaikan lewat
  paket unduhan tanpa APK baru.
- `npm run content:check` juga menjalankan simulasi sederhana: perkiraan jam main untuk membeli tiap barang, dan
  peringatan untuk barang yang terlalu murah atau mahal dibanding pemasukan.

## 7. Cara Mengirim Update

| Jenis perubahan | Lewat paket konten (tanpa APK baru) | Butuh APK baru |
| --- | --- | --- |
| Quest baru dengan tipe langkah yang sudah ada | Ya | |
| NPC baru dengan aset yang sudah ada di APK | Ya | |
| Persona, fakta, teks dialog | Ya | |
| Barang toko baru, harga, diskon, hadiah, batas harian | Ya | |
| Wilayah peta baru (chunk, navmesh, map) | Ya, jika `worldVersion` didukung app | |
| Aset 3D baru (GLB) | Ya, jika ukurannya kecil (< 5 MB per paket) | Lebih aman lewat APK |
| Tipe langkah quest baru, mekanik baru, kendaraan dengan fisika baru | | Ya |

- **APK (selalu):** semua konten terbaru ikut di APK. Pemain yang tidak pernah online tetap dapat konten lewat update APK.
- **Paket unduhan (diputuskan, jalur utama update konten):**
  - App mengecek `content/latest.json` di server konten saat di layar judul (tidak saat main). Server konten
    adalah file statis di VPS yang sama dengan multiplayer. Setup VPS, domain, dan TLS ada di `MULTIPLAYER.md`
    bagian 6.
  - Paket diunduh lewat HTTPS, dicek SHA-256 tiap file, dan **diverifikasi tanda tangan Ed25519** dengan kunci
    publik yang ditanam di APK. Kunci privat hanya ada di mesin build, tidak di VPS.
  - Paket disimpan di penyimpanan app (`Filesystem`), diaktifkan saat game dimulai berikutnya. Paket yang gagal
    verifikasi dibuang. Ada tombol "Kembali ke konten bawaan" di Pengaturan.
  - `minAppVersion` di manifest mencegah paket dipasang di APK lama yang belum paham formatnya.
  - Default hanya unduh lewat Wi-Fi (pilihan "izinkan data seluler" di Pengaturan), ukuran paket ditampilkan
    sebelum unduh. Paket peta (U4) bisa 15-20 MB.
  - Update berikutnya hanya mengunduh file yang berubah (dibandingkan lewat hash), bukan seluruh konten.
- **Save:** `SAVE_VERSION` naik ke 2 dan ditambah **fungsi migrasi berantai** (`v1 → v2 → ...`) alih-alih menolak
  save lama. Field baru: `quests` (status + langkah per quest), `coins`, `inventory`, `equipped`, `jobs`, `contentVersion`.

## 8. Tahapan dan Estimasi (hari kerja, 1 developer)

| Tahap | Isi | Estimasi |
| --- | --- | --- |
| U1. Konten jadi data | `content/` + skema zod, `registry`, pindahkan 5 NPC + persona + quest lama, `content:check`, migrasi save v1 → v2, unit test | 5 hari |
| U2. Sistem quest | `questEngine` + 6 tipe langkah, event dari game, `QuestTracker` HUD + menu, penanda `!`/`?`, hadiah koin/barang, konteks quest di prompt AI, 5-8 quest contoh | 8 hari |
| U2b. Toko dan ekonomi | `wallet` + ledger, `inventory` + equip, `ShopScreen`, 4 toko + penjaga, pekerjaan berulang + batas harian, bus berbayar + tiket, barang terpasang terlihat di multiplayer, simulasi keseimbangan, 30-40 barang awal | 10 hari |
| U3. NPC baru | Variasi aset NPC prosedural, jadwal + gerak navmesh, dialog + fallback offline, 10 NPC baru | 6 hari |
| U4. Peta diperluas | `WORLD_CHUNKS` dari data, offset peta lama, generator cincin luar + 3 distrik baru, navmesh per tile, peta/fog lebih besar, rute bus baru, cek versi di multiplayer | 12 hari |
| U5. Paket unduhan | `content:pack`, tanda tangan Ed25519, `loader` + verifikasi, cek update di layar judul, rollback, deploy file statis ke VPS | 5 hari |
| U6. Uji dan rilis | Uji HP fisik (memori, load, hitch di distrik baru), uji update dari APK lama + save lama, uji multiplayer dengan versi berbeda | 4 hari |
| **Total** | | **50 hari (sekitar 10 minggu)**, +20% cadangan |

- Urutan: **U1 → U5 → U2 → U2b → U3 → U4 → U6**.
  - U1 wajib duluan karena semua tahap lain bergantung padanya.
  - U5 (paket unduhan) dimajukan karena jadi jalur update utama. Konten berikutnya langsung bisa dikirim lewat
    paket, dan jalur unduhannya teruji lebih lama.
- Rilis bertahap:
  - Rilis 1 (APK): U1 + U5 + U2 + U2b, "quest, toko, dan ekonomi" (sekitar 28 hari).
  - Rilis 2 (paket unduhan, tanpa APK baru jika tidak ada aset GLB baru): U3, "warga baru".
  - Rilis 3 (paket unduhan): U4, "peta 1.024 m".
- Gerbang tiap tahap:
  - U1: game identik dengan sebelum refactor, save v1 termigrasi tanpa kehilangan progres, `content:check` lolos.
  - U2: semua quest contoh bisa diselesaikan dari awal sampai hadiah, quest tidak bisa selesai hanya lewat chat AI.
  - U2b: beli, pasang, dan simpan barang bertahan setelah restart, saldo tidak pernah negatif, batas harian reset
    sesuai tanggal, barang terpasang terlihat oleh pemain lain di sesi lokal, simulasi keseimbangan tanpa peringatan.
  - U3: 15 NPC di peta, jadwal berpindah sesuai jam, chat tetap jalan saat AI offline (fallback).
  - U4: peta 1.024 m, memori dan draw call tetap di budget Fase 3, hitch saat masuk distrik baru < 50 ms di HP
    mid-range, save lama tetap di posisi yang benar.
  - U5: paket yang dimodifikasi satu byte ditolak, rollback berhasil, APK lama menolak paket dengan `minAppVersion` lebih tinggi.

## 9. Risiko

- **Ukuran APK dan unduhan** naik sekitar 15-20 MB karena peta 4× lebih besar (terutama navmesh). Navmesh per tile
  dan kompresi (gzip/brotli di server) diperlukan.
- **Bentrok id dan save lama:** dicegah dengan validator dan aturan "id tidak dihapus, hanya `retired`".
- **Konteks AI terlalu panjang** saat quest dan fakta bertambah: ringkasan per NPC dibatasi, riwayat tetap 10 giliran.
- **Ekonomi bisa dicurangi** karena saldo disimpan di HP. Diterima karena tidak ada perdagangan antar pemain.
  Perdagangan butuh ekonomi di server (lihat 6.5).
- **Keseimbangan ekonomi** sulit tepat di awal. Mitigasi: semua angka ada di paket konten dan bisa disesuaikan cepat.
- **Versi berbeda di multiplayer:** ditolak saat join. Perlu pesan yang jelas supaya pemain tahu harus update.
- **Konten di luar validasi** (misal teks quest yang tidak pantas) tetap tanggung jawab penulis konten. Review
  manual sebelum `content:pack`.

## 10. Keputusan

Sudah diputuskan (2026-10-02):

1. Ukuran peta: **16×16 chunk (1.024 m)**.
2. Distrik baru: **Kawasan Industri, Pelabuhan/Pantai, Taman Kota**.
3. Update konten: **paket unduhan** (U5) sebagai jalur utama. APK hanya untuk mekanik atau kode baru.
4. Hadiah quest: **ada toko dan ekonomi** (koin, pekerjaan berulang, toko fisik, barang kosmetik/kenyamanan).

Masih perlu dikonfirmasi (default dipakai jika tidak ada jawaban):

- Pembelian dengan uang sungguhan (in-app purchase). Default: tidak ada.
- Perdagangan koin/barang antar pemain di fase ini. Default: tidak ada.
- Fast travel bus berbayar kecil (5 koin) dengan tiket harian. Default: ya.
- Alamat server konten di VPS (misal `https://<domain>/content/`). Default: domain yang sama dengan multiplayer di `MULTIPLAYER.md`.
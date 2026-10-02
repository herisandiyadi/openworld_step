# Fitur Terpisah: Multiplayer (Bluetooth / Lokal dan Internet)

Status: rencana, terpisah dari [`NEXT_FEATURES.md`](NEXT_FEATURES.md). Game saat ini dirancang single-player,
jadi dokumen ini menjelaskan apa yang perlu diubah, pilihan teknologinya, dan estimasinya.

Dokumen ini adalah **satu-satunya rujukan** untuk fase multiplayer (M1-M4) dan infrastruktur server internet (VPS, domain, TLS, deploy, uji beban). Perubahan rencana multiplayer hanya dicatat di sini, tidak di `NEXT_FEATURES.md` atau `TASKS.md`.

## 1. Ringkasan Rekomendasi

| Mode | Teknologi | Pemain | Butuh server | Cocok untuk |
| --- | --- | --- | --- | --- |
| Lokal (tanpa internet), **dikerjakan duluan** | Android **Nearby Connections** (Bluetooth + Wi-Fi Direct otomatis) | maks. **5** (host + 4) | Tidak, satu HP jadi host | Main bareng di satu ruangan |
| Internet, **setelah lokal** | **WebSocket (wss)** ke server Node.js authoritative di **VPS sendiri** | maks. **50** per room | Ya | Main dari mana saja |

Keduanya memakai satu lapisan jaringan yang sama (`Transport`), jadi logika game cukup ditulis sekali.
Mode lokal dan internet hanya beda "kabel".

## 2. Kenapa Bukan Bluetooth Murni atau Web Bluetooth

- **Web Bluetooth tidak tersedia di Android WebView**, jadi tidak bisa dipakai langsung dari kode web (Capacitor).
  Wajib lewat plugin native.
- **BLE murni** bandwidth-nya kecil (beberapa KB/s), jangkauan pendek, dan rawan putus. Untuk 2 pemain masih
  bisa, tapi untuk 4 pemain dengan kendaraan sudah mepet.
- **Nearby Connections** (Google Play Services) menemukan perangkat lewat Bluetooth, lalu otomatis upgrade ke
  Wi-Fi Direct atau hotspot yang jauh lebih cepat. Tanpa internet dan tanpa router. Ini pilihan paling stabil untuk
  "main bareng lewat Bluetooth".
  - Syarat: HP Android dengan Google Play Services.
  - Izin runtime: `BLUETOOTH_SCAN`, `BLUETOOTH_ADVERTISE`, `BLUETOOTH_CONNECT`, `NEARBY_WIFI_DEVICES` (Android 13+),
    dan lokasi di Android 12 ke bawah.
  - Dependency baru: `com.google.android.gms:play-services-nearby`, versi di-pin saat implementasi.

## 3. Apa yang Disinkronkan

Prinsip: **sinkronkan sesedikit mungkin**. Tidak ada combat, jadi tidak perlu fisika atau hit detection yang sinkron.

| Data | Disinkron? | Pemilik (authority) | Frekuensi |
| --- | --- | --- | --- |
| Posisi, arah, mode gerak, animasi, lompat pemain | Ya | Pemain itu sendiri (client authority) | 10-15 Hz, unreliable |
| Username dan **penampilan** (gender, rambut, ekspresi, baju, celana, lihat 3.1) | Ya | Pemain | Saat join dan saat berubah, reliable |
| Kendaraan terparkir (siapa yang naik, posisi parkir) | Ya | Host/server | Saat berubah, reliable |
| Jam siang-malam | Ya | Host/server | Tiap 10 detik |
| Chat teks antar pemain (grup sesi + jarak dekat) | Ya | Host/server meneruskan | Saat kirim, reliable |
| Lalu lintas, pejalan kaki, hewan (`NEXT_FEATURES`) | **Tidak** (v1) | Lokal tiap HP | - |
| Chat AI dengan NPC/warga | **Tidak**, privat per pemain | HP pemain | - |
| Quest, fog of war, save | Per pemain, tidak dibagi | HP pemain | - |

Catatan:

- **Ambient lokal per HP** artinya mobil dan kucing yang dilihat tiap pemain bisa berbeda. Untuk game santai tanpa
  musuh ini wajar, dan menghemat banyak bandwidth dan kerja. Sinkronisasi ambient (seed dan waktu bersama) bisa
  jadi v2.
- **Chat AI tetap memakai API key masing-masing HP.** Key tidak pernah dikirim ke pemain lain atau ke server
  multiplayer.
- **Client authority untuk posisi** cukup karena tidak ada kompetisi. Host/server tetap memvalidasi kecepatan
  maksimum dan batas peta supaya tidak ada teleport aneh.

### 3.1 Penampilan Pemain

Setiap pemain bisa melihat penampilan pemain lain sesuai pilihan di profilnya (`NEXT_FEATURES.md` bagian 9):
**gender (laki-laki/perempuan), warna rambut, ekspresi wajah, warna baju, gaya baju, warna celana, dan gaya
celana**, ditambah barang kosmetik yang sedang dipakai dari toko (`CONTENT_UPDATES.md` 6.5).

- **Format:** dikirim sebagai **id opsi**, bukan warna atau mesh bebas. 7 field (gender 1 bit, sisanya 0-2,
  masing-masing 2 bit) muat dalam **2 byte**, plus versi format 1 byte.
- **Kapan dikirim:**
  - Saat join (bersama username) di pesan `hello`, reliable.
  - Saat pemain mengganti penampilan dari Profil. Di v1 Profil hanya bisa dibuka dari layar judul, jadi ini terjadi
    saat pemain masuk lagi ke sesi.
  - Barang kosmetik terpasang: daftar id barang, dikirim saat join dan saat berubah.
- **Online 50 pemain:** server menyimpan penampilan per pemain dan mengirimkannya **sekali** ke klien saat pemain
  itu pertama kali masuk area minatnya (AOI, 4.1). Klien menyimpannya di cache per id pemain selama sesi, jadi
  tidak dikirim ulang tiap update posisi.
- **Validasi di host/server:** gender harus `m`/`f`, angka harus 0-2, dan id barang harus ada di katalog. Pesan
  tidak valid ditolak dan pemain memakai tampilan default. Tidak ada teks atau gambar bebas, jadi tidak ada
  risiko konten tidak pantas lewat penampilan.
- **Render pemain lain** (`RemotePlayers.tsx`):
  - Memakai GLB `char_hero_m`/`char_hero_f` yang sama dengan pemain lokal. Node gaya dan material warna diatur
    dari id opsi, sama persis dengan tampilan di HP pemilik.
  - **Dekat (12 terdekat, skinned penuh):** semua detail tampil, termasuk ekspresi wajah dan barang kosmetik.
  - **Jauh (versi ringan instanced, 4.1):** gender, gaya, dan warna baju/celana/rambut tetap tampil lewat
    atribut warna per instance dan mesh per gaya. Ekspresi wajah dan kosmetik kecil disembunyikan karena tidak
    terlihat di jarak itu.
  - Label username di atas kepala dalam 30 m, tetap seperti rencana.
- **Pilihan identik** (dua pemain memilih kombinasi sama) diperbolehkan. Label username dan titik di minimap tetap
  membedakan mereka.
## 4. Arsitektur

```
web/src/net/
  protocol.ts        tipe pesan + encode/decode biner (posisi dikuantisasi), versi protokol
  transport.ts       interface Transport { send(reliable|unreliable), onMessage, onPeer, close }
  loopback.ts        transport in-memory untuk unit test
  nearbyTransport.ts bridge ke plugin native NearbyPlugin (lokal)
  wsTransport.ts     WebSocket (internet), reconnect + backoff
  session.ts         host/client, join/leave, room state, validasi
  RemotePlayers.tsx  render pemain lain (instanced hero + label nama) dengan interpolasi snapshot
  netStore.ts        status koneksi, daftar pemain, ping (Zustand)
web/android/.../NearbyPlugin.java   advertise/discover/connect/payload (Nearby Connections, strategi P2P_STAR)
server/                             (repo/folder baru) Node.js + ws, room, relay, validasi, rate limit
```

- **Model jaringan:** host-authoritative untuk data bersama dan client authority untuk posisi sendiri.
  - Mode lokal: HP pembuat sesi adalah host.
  - Mode internet: server adalah host (HP tidak perlu terbuka ke internet).
- **Interpolasi:** pemain lain digambar 100-150 ms di belakang dengan interpolasi antar snapshot. Gerak sendiri
  tetap instan karena dihitung lokal.
- **Ukuran pesan:** state pemain sekitar 16 byte (x/z/y 16-bit, heading 8-bit, mode/animasi 8-bit).
  - Lokal, 5 pemain × 15 Hz: sekitar 1 KB/s per HP, aman untuk Nearby.
  - Online, 50 pemain: tanpa penyaringan setiap HP menerima 49 × 15 Hz × 16 byte ≈ 12 KB/s, dan server mengirim
    ≈ 0,6 MB/s per room. Karena itu online memakai **interest management** (lihat 4.1).
- **Topologi lokal:** Nearby `P2P_STAR`, host + 4 klien. Semua pesan lewat host. 5 HP masih dalam batas wajar
  Nearby, tapi koneksi Bluetooth awal makin lambat per perangkat tambahan, jadi gerbang M2 menguji 5 HP penuh.

### 4.1 Skala 50 Pemain (online)

- **Interest management (AOI) di server:** tiap pemain hanya menerima update dari pemain dalam radius 120 m
  (sekitar 2 chunk) pada 15 Hz, 120-250 m pada 3 Hz, dan di luar itu hanya posisi kasar untuk peta tiap 2 detik.
  Grid spasial di server memakai ukuran chunk 64 m yang sama dengan dunia.
- **Render pemain lain di HP:**
  - Maksimal 12 pemain terdekat dianimasikan penuh (skinned).
  - Sisanya dalam jarak pandang memakai versi ringan (pose statis instanced, tanpa skinning, tetap dengan gender, gaya, dan warna pilihan pemain) dan label nama
    hanya dalam 30 m.
  - Pemain di luar jarak pandang hanya tampil sebagai titik di peta.
  - Budget tambahan: kurang dari 2 ms/frame dan kurang dari 15 draw call di HP mid-range.
- **Kendaraan bersama:** klaim naik/turun kendaraan diputuskan server (siapa cepat dia dapat), reliable.
- **Chat 50 orang:** kanal Sesi bisa ramai, jadi rate limit per pemain tetap 1 pesan per detik, dan panel
  menampilkan 50 pesan terakhir.
- **Uji beban:** skrip bot Node yang mensimulasikan 50 klien (gerak acak + chat) ke server staging, diukur
  CPU, RAM, bandwidth, dan latensi.
- **Perubahan kode yang ada:**
  - `playerState` tetap untuk pemain lokal, ditambah daftar pemain remote.
  - `vehicles` di `gameStore` jadi milik host saat sesi multiplayer.
  - Save game memisahkan "dunia solo" dan "sesi multiplayer". Progres solo tidak tertimpa.

## 5. Fitur Multiplayer v1

- Menu "Main bersama":
  - **Buat sesi lokal**, **Gabung sesi lokal** (daftar HP terdekat), dan **Main online** (masukkan kode room atau buat baru).
  - Konfirmasi koneksi lokal dengan kode 4 digit yang sama di kedua HP, supaya tidak tersambung ke orang asing.
- Pemain lain terlihat dengan **penampilan pilihannya sendiri** (gender, rambut, ekspresi, baju, celana, lihat 3.1) dan label username.
- Titik biru di minimap dan peta besar untuk pemain lain.
- Kendaraan bersama: kalau satu pemain naik sepeda, pemain lain tidak bisa mengambilnya.
- Chat teks antar pemain untuk lebih dari 2 pemain (lihat bagian 5.1).
- Notifikasi pemain masuk dan keluar, indikator ping, dan reconnect otomatis untuk mode internet.

### 5.1 Chat Antar Pemain (v1)

Keputusan: **grup sesi + gelembung jarak dekat**. Whisper menyusul di v2.

| Kanal | Siapa yang menerima | Tampil di | Batas pemain |
| --- | --- | --- | --- |
| **Sesi** (default) | Semua pemain di sesi/room | Panel chat (riwayat) | 5 lokal, 50 online |
| **Dekat** | Pemain dalam radius 30 m dari pengirim | Gelembung di atas kepala pengirim (5 detik), juga masuk panel dengan tanda "dekat" | Sama |

- **Alur pesan:** HP mengirim `chat { channel: 'session' | 'nearby', text }` ke host/server. Host/server mengisi
  `from`, `id`, dan waktu, lalu meneruskan:
  - `session` ke semua pemain;
  - `nearby` hanya ke pemain yang posisinya (versi host/server) dalam 30 m. Penyaringan dilakukan di host/server,
    bukan di HP penerima, supaya pemain jauh tidak menerima teksnya sama sekali.
- **UI:**
  - Tombol chat di HUD membuka panel dengan dua tab, "Sesi" dan "Dekat", memakai input free text bergaya sama
    dengan chat NPC.
  - Badge jumlah pesan belum dibaca saat panel tertutup.
  - Satu gelembung per pemain (pesan baru mengganti yang lama), hanya digambar dalam 30 m supaya ringan.
  - Game **tidak** di-pause saat chat antar pemain (berbeda dengan chat NPC), karena dunianya dibagi bersama.
- **Aturan dan keamanan:**
  - Maksimal 200 karakter. Teks dirapikan (trim, buang karakter kontrol) dan dirender sebagai teks biasa, bukan HTML.
  - Rate limit 1 pesan per detik dengan burst 5, dicek di host/server, bukan hanya di HP.
  - Riwayat hanya di memori: 50 pesan terakhir per kanal, hilang saat keluar sesi, tidak disimpan di server.
    Pemain yang baru join tidak melihat riwayat sebelumnya.
  - Tombol **bisukan pemain** (lokal di HP sendiri) untuk menyembunyikan pesan dan gelembung pemain tertentu.
- **Unit test (M1, transport loopback):** 3+ klien menerima pesan sesi, pesan dekat hanya sampai ke klien dalam
  radius, serta pesan yang melanggar rate limit atau batas panjang ditolak host.

Di luar v1:

- Pesan pribadi (whisper) ke satu pemain: kanal ketiga `private`, diteruskan host/server hanya ke penerima.
- Menumpang kendaraan pemain lain (penumpang).
- Voice chat.
- Ambient yang sinkron.
- Matchmaking publik.
- Akun dan login.

## 6. Server Internet

- Node.js 20 dengan `ws` (atau Colyseus jika ingin room management siap pakai). Room in-memory, tanpa database di v1.
- **Wajib** `wss://` (TLS) di belakang reverse proxy. Jangan WebSocket polos di internet.
- Keamanan:
  - Token sesi anonim dari server saat join. Username sudah divalidasi dengan aturan yang sama seperti
    `profile.ts`, dan dicek ulang di server.
  - Rate limit per koneksi: pesan per detik dan ukuran maksimum pesan.
  - Validasi semua pesan: skema, batas peta, dan kecepatan maksimum.
  - Kode room acak 6 karakter, kedaluwarsa saat kosong.
  - Tanpa autentikasi akun, siapa pun yang tahu kode room bisa masuk. Ini cukup untuk v1, tapi perlu disadari.
- Hosting: **VPS sendiri** (diputuskan).
  - Spesifikasi awal: 2 vCPU / 2 GB RAM, bandwidth minimal 10 Mbps upload. Ini cukup untuk beberapa room berisi
    50 pemain dengan AOI. Angka final ditentukan dari uji beban di M3.
  - OS Linux (Ubuntu LTS). Server Node dijalankan sebagai service systemd (atau Docker) dengan restart otomatis.
  - Reverse proxy Caddy atau Nginx untuk `wss://` dengan sertifikat Let's Encrypt otomatis. Butuh **domain atau
    subdomain** yang mengarah ke IP VPS.
  - Firewall hanya membuka port 443 (dan 22 untuk SSH dengan key, tanpa password).
  - Log koneksi dan error tanpa menyimpan isi chat.
- Endpoint server multiplayer terpisah dari endpoint AI dan diisi di Pengaturan, sama seperti Base URL AI.

## 7. Tahapan dan Estimasi (hari kerja, 1 developer)

| Tahap | Isi | Estimasi |
| --- | --- | --- |
| M1. Fondasi | `protocol`, `transport`, `loopback`, `session`, refactor state lokal vs remote, `RemotePlayers` + interpolasi, penampilan pemain (encode 2 byte, validasi, cache, render dekat/jauh), unit test | 6 hari |
| M2. Lokal (Bluetooth/Nearby), **duluan** | `NearbyPlugin.java`, izin runtime, UI buat/gabung sesi + kode konfirmasi, kendaraan bersama, chat antar pemain, uji 5 HP | 7 hari |
| M3. Internet, **setelah M2** | Server Node (room, relay, validasi, rate limit), AOI, LOD pemain lain, `wsTransport` + reconnect, UI room code, deploy ke VPS + TLS, uji beban 50 bot | 11 hari |
| M4. Uji dan polish | Uji 5 HP fisik (lokal) dan banyak HP + bot (online), jaringan lambat dan putus-sambung, baterai, dokumentasi, rilis | 4 hari |
| **Total** | | **28 hari (sekitar 5-6 minggu)**, +20% cadangan |

- Urutan (diputuskan): **M1 → M2 (lokal) → rilis lokal → M3 (internet) → M4**. Lokal bisa dirilis lebih dulu
  setelah sekitar **14 hari** (M1 + M2 + sebagian M4).
- Gerbang tiap tahap:
  - M1: 2 klien loopback sinkron di unit test, termasuk encode/decode penampilan untuk semua 1.458 kombinasi dan penolakan nilai tidak valid.
  - M2: 5 HP tersambung tanpa internet selama 30 menit tanpa putus, dan tiap HP melihat penampilan 4 pemain lain sesuai profil masing-masing.
  - M3: 50 klien (HP + bot) di satu room selama 30 menit, ping p95 < 150 ms di jaringan seluler lokal, HP mid-range tetap ≥ 30 FPS, CPU VPS < 60%, reconnect berhasil setelah jaringan putus.
- Kebutuhan uji: **5 HP Android fisik** untuk lokal (Nearby tidak bisa diuji dengan baik di emulator). Untuk online, beberapa HP fisik ditambah bot.

## 8. Urutan dengan Fitur Lain

- Disarankan dikerjakan **setelah Fase A dan Fase E** di `NEXT_FEATURES.md` (kamera, kontrol kendaraan baru, dan
  kustomisasi karakter). Model, penampilan, dan kontrol pemain yang disinkronkan sebaiknya sudah final.
- Ambient (Fase B/C) tidak menghalangi multiplayer karena v1 tidak menyinkronkan ambient.

## 9. Keputusan

Sudah diputuskan (2026-10-02):

1. Urutan: **lokal (Bluetooth/Nearby) dulu, lalu internet**.
2. Jumlah pemain maksimum: **5 lokal**, **50 per room online**.
3. Server internet: **VPS sendiri**.
4. Chat antar pemain: grup sesi + gelembung jarak dekat (v1), whisper di v2.
5. Penampilan pemain (gender, rambut, ekspresi, baju, celana) **terlihat oleh pemain lain** (3.1).

Masih dibutuhkan sebelum M3 (internet):

- Domain/subdomain untuk server multiplayer dan akses SSH ke VPS (atau VPS disiapkan sendiri mengikuti bagian 6).
- Spesifikasi VPS yang tersedia (vCPU, RAM, bandwidth), untuk dicocokkan dengan hasil uji beban.
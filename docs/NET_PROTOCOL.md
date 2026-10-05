# Protokol Wire Multiplayer (v1)

Rujukan format biner untuk klien (`web/src/net/protocol.ts`), host lokal, dan server Node (M3).
Rencana dan alasan desain ada di [`MULTIPLAYER.md`](MULTIPLAYER.md). Dokumen ini hanya mendefinisikan byte di wire.

## 1. Aturan Umum

- Semua pesan biner, **bukan JSON**. Satu pesan = satu payload transport (frame WebSocket / payload Nearby).
- Byte order **big-endian** untuk semua field multi-byte.
- Tipe: `u8`, `u16`, `u32` (unsigned), `f32` (IEEE 754 float 32-bit).
- `str8` = `u8` panjang (byte UTF-8) + isi UTF-8. `str16` = `u16` panjang + isi UTF-8. UTF-8 rusak ditolak.
- Setiap pesan diawali header 2 byte:

| Offset | Tipe | Field |
| --- | --- | --- |
| 0 | u8 | `PROTOCOL_VERSION` (sekarang `1`) |
| 1 | u8 | id pesan (tabel 2) |

- Penerima **menolak** pesan kalau: versi beda, id tidak dikenal, panjang buffer tidak persis sama dengan layout
  (kurang atau lebih), enum di luar rentang, teks chat kosong atau > 200 karakter, koordinat di luar peta atau
  bukan angka (NaN/Infinity).
- Mengubah urutan/arti field atau id pesan **wajib** menaikkan `PROTOCOL_VERSION`.

## 2. Daftar Pesan

| Pesan | Id | Arah | Kanal | Ukuran (byte) |
| --- | --- | --- | --- | --- |
| `hello` | 1 | klien → host | reliable | 2 + 4 + 1 + N |
| `welcome` | 2 | host → klien | reliable | 2 + 7 + Σ(7 + N) |
| `state` | 3 | dua arah | **unreliable** | 2 + 5 + 12 × jumlah pemain |
| `appearance` | 4 | dua arah | reliable | 8 |
| `vehicleClaim` | 5 | klien → host | reliable | 2 + 1 + 1 + N + 12 |
| `vehicleState` | 6 | host → klien | reliable | 2 + 2 + 1 + N + 12 |
| `clock` | 7 | host → klien | reliable | 10 |
| `chat` | 8 | dua arah | reliable | 2 + 13 + N |
| `playerJoin` | 9 | host → klien | reliable | 2 + 2 + 4 + 1 + N |
| `playerLeave` | 10 | host → klien | reliable | 4 |
| `ping` | 11 | klien → host | reliable | 6 |
| `pong` | 12 | host → klien | reliable | 6 |

Host menolak pesan host-only (`welcome`, `clock`, `playerJoin`, ...) yang datang dari klien, serta semua pesan
selain `hello` sebelum `hello` diterima.

## 3. Layout Field

Offset dihitung dari awal payload, **setelah** header 2 byte.

### `hello` (1)

| Offset | Tipe | Field | Catatan |
| --- | --- | --- | --- |
| 0 | 4 byte | appearance | Bagian 4 |
| 4 | str8 | username | maks. 80 byte UTF-8; host memvalidasi dengan `validateUsername` (2-20 karakter) |

### `welcome` (2)

| Offset | Tipe | Field | Catatan |
| --- | --- | --- | --- |
| 0 | u16 | playerId | id pemain penerima, 1-65535 |
| 2 | f32 | timeOfDay | detik, 0..`DAY_SECONDS` (480) |
| 6 | u8 | count | maks. 64 |
| 7 | entri × count | players | tiap entri: `u16 id`, `4 byte appearance`, `str8 username` |

Daftar `players` termasuk penerima itu sendiri. Riwayat chat lama **tidak** dikirim.

### `state` (3)

| Offset | Tipe | Field | Catatan |
| --- | --- | --- | --- |
| 0 | u32 | timeMs | waktu pengirim (ms, mod 2³²); host memakai jamnya sendiri saat meneruskan |
| 4 | u8 | count | klien → host **harus 1**; host → klien maks. 64 |
| 5 | entri × count | players | 12 byte per entri (tabel di bawah) |

Entri pemain (12 byte):

| Offset | Tipe | Field | Kuantisasi |
| --- | --- | --- | --- |
| 0 | u16 | id | dari klien diabaikan (diisi 0); host mengisi id pengirim |
| 2 | u16 | x | `round((x + 256) / 512 × 65535)`, x dijepit ke [-256, 256] m (≈ 8 mm) |
| 4 | u16 | z | sama dengan x |
| 6 | u16 | y | `round((y + 32) / 256 × 65535)`, y dijepit ke [-32, 224] m (≈ 4 mm) |
| 8 | u8 | heading | `round(heading mod 2π / 2π × 256) & 0xFF` (≈ 1,4°) |
| 9 | u8 | moveMode | 0 `walk`, 1 `skate`, 2 `bike`, 3 `moto`, 4 `car` |
| 10 | u8 | anim | 0 `idle`, 1 `walk`, 2 `run`, 3 `ride`, 4 `sit`, 5 `jump` |
| 11 | u8 | flags | bit 0 = sedang lompat; bit 1-7 harus 0 |

Satu pemain = 19 byte per pesan klien → host (header 2 + 5 + 12).

### `appearance` (4)

| Offset | Tipe | Field | Catatan |
| --- | --- | --- | --- |
| 0 | u16 | playerId | 0 dari klien; host mengisi id pengirim |
| 2 | 4 byte | appearance | Bagian 4 |

### `vehicleClaim` (5)

| Offset | Tipe | Field | Catatan |
| --- | --- | --- | --- |
| 0 | u8 | action | 0 = naik (`mount`), 1 = turun (`release`) |
| 1 | str8 | vehicleId | id dari `INITIAL_VEHICLES`, maks. 80 byte |
| 1+N+1 | f32 | x | posisi parkir saat turun (diabaikan saat naik) |
| +4 | f32 | z | |
| +8 | f32 | yaw | radian |

Host: klaim naik pertama menang. Klaim yang kalah, kendaraan tidak dikenal, atau jarak > 6 m ditolak, dan
pengirim menerima `vehicleState` terkini. Turun hanya boleh oleh pemilik, dalam 6 m dari posisinya.

### `vehicleState` (6)

| Offset | Tipe | Field | Catatan |
| --- | --- | --- | --- |
| 0 | u16 | ownerId | 0 = terparkir |
| 2 | str8 | vehicleId | |
| 2+N+1 | f32 | x | |
| +4 | f32 | z | |
| +8 | f32 | yaw | |

Dikirim ke semua saat kepemilikan berubah, dan ke pemain baru untuk kendaraan yang sedang dipakai. Saat pemilik
keluar, kendaraan kembali terparkir (`ownerId = 0`).

### `clock` (7)

| Offset | Tipe | Field |
| --- | --- | --- |
| 0 | f32 | timeOfDay (detik) |
| 4 | u32 | timeMs host |

Dikirim host tiap 10 detik (`CLOCK_INTERVAL_MS`).

### `chat` (8)

| Offset | Tipe | Field | Catatan |
| --- | --- | --- | --- |
| 0 | u8 | channel | 0 `session`, 1 `nearby` |
| 1 | u16 | fromId | 0 dari klien; diisi host |
| 3 | u32 | msgId | 0 dari klien; id unik per sesi dari host |
| 7 | u32 | timeMs | 0 dari klien; waktu host |
| 11 | str16 | text | setelah dirapikan: 1-200 karakter (code point), maks. 800 byte |

Aturan host: teks dirapikan (karakter kontrol → spasi, spasi ganda dipadatkan, trim), rate limit token bucket
1 pesan/detik burst 5 per pemain, `nearby` hanya diteruskan ke pemain dalam 30 m dari posisi pengirim **versi
host** (pengirim selalu menerima salinannya). Host menyimpan 50 pesan terakhir per kanal di memori.

### `playerJoin` (9)

| Offset | Tipe | Field |
| --- | --- | --- |
| 0 | u16 | id |
| 2 | 4 byte | appearance |
| 6 | str8 | username |

Dikirim ke semua pemain lain (bukan ke pemain yang baru masuk).

### `playerLeave` (10)

| Offset | Tipe | Field |
| --- | --- | --- |
| 0 | u16 | playerId |

### `ping` (11) / `pong` (12)

| Offset | Tipe | Field |
| --- | --- | --- |
| 0 | u32 | nonce |

Host membalas `ping` dengan `pong` ber-nonce sama; RTT dihitung di klien.

## 4. Penampilan (4 byte)

| Byte | Isi |
| --- | --- |
| 0 | versi format penampilan (`APPEARANCE_FORMAT_VERSION` = 1) |
| 1-3 | 24 bit little-endian: byte 1 = bit 0-7, byte 2 = bit 8-15, byte 3 = bit 16-23 |

| Bit | Field | Nilai |
| --- | --- | --- |
| 0 | gender | 0 `m`, 1 `f` |
| 1-2 | skinTone | 0-2 |
| 3-4 | hairStyle | 0-2 |
| 5-6 | hairColor | 0-2 |
| 7-8 | expression | 0-2 |
| 9-10 | shirtColor | 0-2 |
| 11-12 | shirtStyle | 0-2 |
| 13-14 | pantsColor | 0-2 |
| 15-16 | pantsStyle | 0-2 |
| 17-18 | accessory | 0-2 |
| 19-23 | cadangan | harus 0 |

Versi format beda, nilai field 3, atau bit cadangan tidak nol → penampilan diganti `DEFAULT_APPEARANCE`
(pesan tetap diterima, sesuai MULTIPLAYER.md 3.1). Semua 2 × 3⁹ = 39.366 kombinasi diuji di
`appearanceCodec.test.ts`.

## 5. Aturan Host Lainnya

| Aturan | Nilai |
| --- | --- |
| Pemain maks. | 5 lokal (default `HostSession`), 50 online (`maxPlayers`) |
| Anti-teleport | jarak ≤ 25,2 m/s × dt + 2 m (mobil 18 m/s + 40 %); di luar peta ditolak |
| AOI | ≤ 120 m: 15 Hz, 120-250 m: 3 Hz, > 250 m: tiap 2 detik |
| Interpolasi klien | digambar 120 ms di belakang waktu host, tanpa ekstrapolasi |

## 6. Penyimpangan dari MULTIPLAYER.md

- **Penampilan 3 byte payload (bukan 2).** Dokumen menyebut 7 field, tetapi `Appearance` di
  `web/src/state/profile.ts` punya 10 field (ditambah `skinTone`, `hairStyle`, `accessory`): 1 + 9 × 2 = 19 bit.
  Total di wire 4 byte (1 versi + 3 payload). Akibatnya jumlah kombinasi 39.366, bukan 1.458 seperti gerbang M1.
- **Entri `state` 12 byte**, lebih kecil dari perkiraan "~16 byte": dokumen tidak menghitung id pemain dan flag
  lompat, dan header pesan (7 byte) dibagi oleh semua entri dalam satu snapshot.
- **Barang kosmetik toko** (daftar id barang, 3.1) belum ada di wire karena katalognya belum ada di kode;
  ditambahkan dengan menaikkan versi format penampilan atau protokol.
- **Ping pemain lain** belum punya pesan; `netStore` menyediakan tempatnya (`setPlayerPing`).

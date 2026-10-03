# Progres Implementasi Multiplayer

Catatan pelaksanaan untuk [`MULTIPLAYER.md`](MULTIPLAYER.md). Dokumen rencana tidak diubah; semua status,
penyimpangan, dan daftar commit dicatat di sini.

Branch: `feat/multiplayer` (dari `main` @ `5b78be5`). Backend ada di direktori terpisah
`/games/open world/mp-server`, dijalankan dengan Docker (belum di VPS).

Gelombang 5 (deploy VPS, TLS Let's Encrypt, systemd) **ditunda** atas permintaan: VPS belum disiapkan.

## Ringkasan Status

| Gelombang | Isi | Status |
| --- | --- | --- |
| 1 | M1 fondasi jaringan + native Nearby (M2 bagian Android) | Selesai |
| 2 | Server Node + `ws` di Docker, `wsTransport`, `nearbyTransport`, bot uji beban | Belum |
| 3 | `RemotePlayers`, menu Main bersama, chat, minimap, kendaraan bersama | Belum |
| 4 | Integrasi, uji beban 50 bot, APK debug, polish M4 | Belum |
| 5 | Deploy VPS + TLS | Ditunda (menunggu VPS) |

## Gelombang 1 — Selesai

### M1: fondasi jaringan (`web/src/net/`)

- `protocol.ts` + `protocol.test.ts` — 12 jenis pesan biner big-endian, header versi + id, validasi ketat.
- `appearanceCodec.ts` + test — penampilan 10 field jadi 4 byte (1 versi + 3 payload).
- `transport.ts` — interface `Transport` (send reliable/unreliable, onMessage, onPeer, close).
- `loopback.ts` + test — transport in-memory, bisa simulasi latensi dan drop paket unreliable.
- `session.ts` + test — host-authoritative: join/leave, validasi anti-teleport, kepemilikan kendaraan,
  jam dari host, relay chat dengan filter radius 30 m di host, rate limit, AOI, interpolasi snapshot.
- `netStore.ts` + test — store zustand: status koneksi, pemain remote, ping, mute lokal, riwayat chat.
- `docs/NET_PROTOCOL.md` — definisi byte di wire, acuan untuk server M3 dan UI.

Verifikasi: `npm run typecheck` exit 0; `npx vitest run src/net` 77/77 lulus; `npm test` 259/259 lulus
(36 file, termasuk test yang sudah ada sebelumnya).

Gerbang M1 (`MULTIPLAYER.md` 7) terpenuhi: 2 klien loopback sinkron, encode/decode penampilan diuji
**ekshaustif** untuk semua 39.366 kombinasi, dan nilai tidak valid jatuh ke default.

### M2 (bagian native): Nearby Connections

- `web/android/.../NearbyPlugin.java` (457 baris) — strategi `P2P_STAR`, advertise/discover/connect,
  kirim payload BYTES, izin runtime per versi Android, kode konfirmasi 4 digit deterministik dari
  `getAuthenticationDigits()`.
- `MainActivity.java` — `registerPlugin(NearbyPlugin.class)`.
- `app/build.gradle` — `com.google.android.gms:play-services-nearby:19.3.0` (versi di-pin, bukan `+`).
- `AndroidManifest.xml` — `BLUETOOTH_SCAN`/`ADVERTISE`/`CONNECT`, `NEARBY_WIFI_DEVICES`,
  lokasi dengan `maxSdkVersion="32"`, `ACCESS_WIFI_STATE`, `CHANGE_WIFI_STATE`.
- `web/src/net/nearbyPlugin.ts` — deklarasi `registerPlugin` + tipe method/event + helper base64.
- `docs/NEARBY_PLUGIN.md` — API, izin, kode konfirmasi, keterbatasan, cara uji di HP fisik.

Verifikasi: `compileDebugJavaWithJavac` exit 0 (dicek lead), dan `assembleDebug` BUILD SUCCESSFUL
dengan APK di `app/build/outputs/apk/debug/app-debug.apk`.

## Penyimpangan dari `MULTIPLAYER.md`

Dicatat di sini supaya dokumen rencana tetap utuh.

1. **Penampilan 4 byte, bukan 3.** Bagian 3.1 menghitung 7 field (2 byte + 1 versi), tapi `Appearance` di
   `web/src/state/profile.ts` sudah punya 10 field (ditambah `skinTone`, `hairStyle`, `accessory`):
   1 bit + 9×2 bit = 19 bit → 3 byte payload + 1 byte versi.
2. **Kombinasi penampilan 39.366, bukan 1.458** (2×3⁹), konsekuensi langsung dari poin 1. Gerbang M1 diuji
   untuk semua kombinasi tersebut.
3. **Entri snapshot `state` 12 byte**, bukan ~16 byte (bagian 4): id 2 + x/z/y 6 + heading 1 + mode 1 +
   anim 1 + flag 1. Header 7 byte dibagi semua entri dalam satu snapshot, jadi bandwidth lebih kecil dari
   perkiraan dokumen.
4. **Penampilan tidak valid tidak menolak seluruh pesan.** Pemain memakai `DEFAULT_APPEARANCE`, sesuai teks
   3.1 ("pemain memakai tampilan default"). Penolakan keras hanya untuk versi protokol, panjang buffer,
   enum tak dikenal, teks > 200 karakter, dan koordinat di luar peta.
5. **Barang kosmetik toko belum masuk wire** (`CONTENT_UPDATES.md` 6.5) karena katalog id barang belum ada
   di kode. Akan ditambah dengan menaikkan versi format penampilan.
6. **Pesan `chat` membawa `msgId` (u32)** yang tidak disebut dokumen; dipakai sebagai id pesan dari host
   (5.1 menyebut host mengisi `from`, `id`, dan waktu).
7. **Kecepatan maksimum anti-teleport 25,2 m/s** (mobil 18 m/s dari `game/vehicleSpec.ts` + toleransi 40%)
   plus slack 2 m. Dokumen tidak menyebut angka.
8. **Ping per pemain remote belum punya pesan protokol** (hanya ping lokal ke host); tempatnya sudah ada di
   `netStore` (`setPlayerPing`).
9. **Payload Nearby BYTES selalu reliable.** Flag `reliable: false` diterima tapi tidak mengubah apa pun di
   mode lokal; penghematan unreliable hanya berlaku untuk mode internet.

## Yang Hanya Bisa Diuji di HP Fisik

Gerbang berikut tidak bisa dibuktikan di host ini dan perlu uji perangkat:

- M2: 5 HP tersambung lewat Nearby selama 30 menit tanpa putus, tiap HP melihat penampilan 4 pemain lain.
- M3: ping p95 < 150 ms di jaringan seluler, HP mid-range tetap ≥ 30 FPS, reconnect setelah jaringan putus.
- M4: konsumsi baterai.

## Commit per Gelombang

### Gelombang 1

- `feat(net): fondasi protokol multiplayer M1 + plugin Nearby Android`

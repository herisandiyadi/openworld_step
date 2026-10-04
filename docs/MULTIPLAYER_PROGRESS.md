# Progres Implementasi Multiplayer

Catatan pelaksanaan untuk [`MULTIPLAYER.md`](MULTIPLAYER.md). Dokumen rencana tidak diubah; semua status,
penyimpangan, dan daftar commit dicatat di sini.

Branch: `feat/multiplayer` (dari `main` @ `5b78be5`). Backend ada di folder `server/`
(paket Node terpisah dari `web/`), dijalankan dengan Docker Compose (belum di VPS).

Gelombang 5 (deploy VPS, TLS Let's Encrypt, systemd) **ditunda** atas permintaan: VPS belum disiapkan.

## Ringkasan Status

| Gelombang | Isi | Status |
| --- | --- | --- |
| 1 | M1 fondasi jaringan + native Nearby (M2 bagian Android) | Selesai |
| 2 | Server Node + `ws` di Docker, `wsTransport`, `nearbyTransport`, bot uji beban | Selesai |
| 3 | `RemotePlayers`, menu Main bersama, chat, minimap, kendaraan bersama | Selesai |
| 4 | Integrasi, uji beban 50 bot, APK debug, polish M4 | Berjalan (uji beban 30 menit + APK) |
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

## Gelombang 2 — Selesai

### M3 (bagian server): `server/`

Paket Node terpisah dari `web/`, dependency runtime hanya `ws` (dipin ke versi eksak).

- `src/protocol.ts` — salinan encoder/decoder klien, hanya baris impor yang diganti. Kompatibilitas
  byte-per-byte dibuktikan `test/vectors.ts`: hex-nya dihasilkan dengan membundel
  `web/src/net/protocol.ts` asli lewat esbuild, bukan ditulis tangan.
- `src/appearance.ts` — codec 4 byte + aturan username, disalin dari `state/profile.ts`.
- `src/room.ts` — room in-memory, kode 6 karakter tanpa `0/O/1/I/L`, token sesi anonim,
  batas 50 pemain, TTL room kosong 60 detik, kepemilikan kendaraan, relay chat.
- `src/aoi.ts` — grid spasial 64 m, tingkat 15 Hz / 3 Hz / 2 detik.
- `src/validate.ts` — anti-teleport 25,2 m/s + slack 2 m, chat 1/detik burst 5, umum 40/detik
  burst 80, strike, batas pesan 1024 byte.
- `src/server.ts` — `POST /rooms`, `POST /rooms/:code/join`, `GET /health`, WS `/ws`, heartbeat,
  batas koneksi per IP, graceful shutdown.
- `src/log.ts` — log JSON satu baris. Isi chat dan username tidak pernah dicatat (bagian 6).
- `Dockerfile` (3 stage, `node:20-alpine`, `USER node`) + `docker-compose.yml` + `Caddyfile`
  untuk `wss://` (`tls internal` di lokal, Let's Encrypt di VPS).
- `loadtest/bots.mjs` — 50 bot WS, gerak 15 Hz, ping 1 Hz, lapor p50/p95/p99 + CPU/RAM/bandwidth.

Verifikasi: `npm run typecheck` exit 0; `npm test` 71/71 lulus (termasuk 39.366 kombinasi penampilan
dan fuzz 20.000 buffer acak); `npm run build` exit 0; `docker compose up -d` kedua container sehat;
`/health` 200 lewat port 8787 dan lewat Caddy di `https://localhost:8443`.

Uji beban 50 bot, 60 detik, server di Docker (host yang sama, jadi RTT internet belum termasuk):

| Metrik | Hasil |
| --- | --- |
| Bot tersambung / terputus | 50 / 0 |
| Ping RTT (2950 sampel) | p50 6,86 ms, p95 18,1 ms, p99 20,39 ms, maks 29,28 ms |
| CPU server | rata-rata 31,23% dari 1 core, `docker stats` maks 42,16% |
| RAM server | RSS 61,8 → 89,8 MB |
| Bandwidth | server→bot 131,2 kB/s, container tx 206,5 kB/s (≈1,65 Mbit/s per room penuh) |
| Pesan | 48.353 terkirim, 52.367 diterima, 0 ditolak |

Gerbang M3 bagian server: p95 < 150 ms **lulus**, CPU < 60% **lulus**. Uji 30 menit dan uji di
jaringan seluler masuk gelombang 4 dan uji perangkat.

### Transport klien

- `web/src/net/wsTransport.ts` + test — mode internet: `Transport` di atas WebSocket, reconnect
  dengan backoff, antrean pesan saat terputus.
- `web/src/net/nearbyTransport.ts` + test — mode lokal: `HostTransport`/`Transport` di atas
  `nearbyPlugin`, payload BYTES base64.
- `web/src/state/netSettings.ts` + test — alamat server (`ws://`/`wss://`) disimpan di perangkat,
  divalidasi, default kosong (tidak ada server bawaan di app).

Verifikasi: `npx vitest run src/net/wsTransport.test.ts src/net/nearbyTransport.test.ts src/state/netSettings.test.ts`
23/23 lulus.

## Gelombang 3 — Selesai

- `web/src/net/netRuntime.ts` + test — manajer koneksi: host lokal, klien lokal, online (buat/gabung room
  lewat HTTP lalu WebSocket). Event sesi diteruskan ke `netStore`; error koneksi berbahasa Indonesia.
- `web/src/game/RemotePlayers.tsx` + `remotePlayers.ts` + test — pemain lain digambar dengan penampilan
  masing-masing, interpolasi snapshot, label nama sprite kanvas, maks pemain terlihat + culling jarak.
- `web/src/ui/MultiplayerMenu.tsx` + test — menu "Main bersama": buat/gabung sesi Nearby dengan kode
  konfirmasi 4 digit, main online dengan kode room 6 karakter, notifikasi pemain masuk/keluar, ping.
- `web/src/ui/ChatPanel.tsx`, `ChatBubbles.tsx`, `chatLogic.ts` + test — kanal Sesi dan Dekat, batas
  200 karakter, bisukan per pemain, lencana pesan baru, gelembung di atas kepala 5 detik dalam 30 m.
- `web/src/game/sharedVehicles.ts` + test — kepemilikan kendaraan mengikuti host/server; kendaraan milik
  pemain lain diberi cincin merah + label "Dipakai ..." dan tidak bisa dinaiki.
- `Minimap.tsx` / `BigMap.tsx` / `mapRender.ts` — titik pemain lain di peta.
- `web/src/game/NetDriver.tsx` + `netDriver.ts` + test — kirim state pemain lokal 15 Hz (pakai interval,
  bukan `useFrame`, supaya host tetap melayani saat game dijeda) dan tick `HostSession`.
- Integrasi: layar `multiplayer` di `App.tsx`, tombol "Main bersama" di `TitleScreen`, tombol chat di HUD
  hanya saat dalam sesi. Single-player tidak berubah perilakunya.

Verifikasi: `npx vitest run` 348/348 lulus (45 file); `npm run typecheck` exit 0; `npm run build` sukses.

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

- `feat(net): fondasi protokol multiplayer M1 + plugin Nearby Android` (`d747686`)

### Gelombang 2

- `feat(server): server multiplayer internet M3 + transport WebSocket dan Nearby` (`f3ff32a`)

### Gelombang 3

- `feat(net): UI multiplayer + integrasi ke game (M3 klien)` (`985d6b9`)

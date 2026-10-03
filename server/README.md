# mp-server — Server Multiplayer Internet (M3)

Server WebSocket authoritative untuk game open-world: room in-memory (maks 50 pemain), interest management (AOI) grid 64 m, validasi anti-teleport, rate limit, relay chat (kanal `session` dan `nearby` 30 m difilter di server). Format biner di wire sama persis dengan `docs/NET_PROTOCOL.md` dan klien `web/src/net/protocol.ts` (dibuktikan oleh `test/protocol.test.ts` + `test/vectors.ts`).

## Menjalankan dengan Docker Compose

```sh
docker compose build
docker compose up -d
curl http://localhost:8787/health          # langsung ke server
curl -k https://localhost:8443/health      # lewat Caddy (self-signed)
docker compose down
```

Endpoint WebSocket:
- lokal langsung: `ws://localhost:8787/ws`
- lewat Caddy (TLS self-signed, `tls internal`): `wss://localhost:8443/ws`

Sertifikat self-signed tidak dipercaya browser secara default. Buka `https://localhost:8443/health` sekali dan terima peringatannya, atau pasang CA lokal Caddy:

```sh
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
```

`/health` mengembalikan 200 + JSON: `rooms`, `players`, `connections`, `uptimeSec`, statistik proses, trafik, dan hitungan pesan ditolak. Dipakai oleh `HEALTHCHECK` di Dockerfile dan healthcheck compose.

## Tanpa Docker

```sh
npm install
npm run typecheck
npm test
npm run build
npm start          # PORT default 8787
```

## Variabel env

| Nama | Default | Keterangan |
|---|---|---|
| `PORT` | `8787` | Port HTTP + WebSocket |
| `HOST` | `0.0.0.0` | Alamat bind |
| `MAX_ROOMS` | `100` | Batas jumlah room aktif |
| `MAX_PLAYERS` | `50` | Pemain per room (dokumen 4.1) |
| `ROOM_EMPTY_TTL_MS` | `60000` | Room kosong dihapus setelah jeda ini |
| `MAX_CONNECTIONS_PER_IP` | lihat `src/index.ts` | Batas koneksi per IP (compose menaikkan ke 200 untuk uji beban dari satu IP) |
| `TRUST_PROXY` | `0` | `1` = percaya `X-Forwarded-For` (aktifkan hanya di belakang Caddy) |
| `LOG_SILENT` | `0` | `1` = matikan log |

Log hanya mencatat koneksi, room, dan error. Isi chat tidak pernah dicatat (dokumen 6).

## Uji beban

Server harus jalan dulu (mis. lewat Docker Compose), lalu:

```sh
npm run build   # bots.mjs memakai dist/protocol.js
node loadtest/bots.mjs --bots 50 --duration 60 \
  --url http://127.0.0.1:8787 --container mp-server-mp-server-1
```

Argumen: `--bots N`, `--duration S`, `--url URL`, `--container NAME` (ambil CPU/RAM/jaringan dari `docker stats`), `--chat-every S`, `--json FILE`.

Bot bergerak acak 6 m/s di dalam batas peta pada 15 Hz, ping tiap detik, dan chat rata-rata tiap 15 detik.

### Hasil nyata (host ini, 2026-10-03, server di Docker)

```
Bot: 50, durasi ukur: 60 s, bot terputus: 0
Latensi ping (RTT, 2950 sampel): p50 6.86 ms, p95 18.1 ms, p99 20.39 ms, max 29.28 ms
CPU server: rata-rata proses 31.23% (1 core), docker stats rata-rata 29.58% / maks 42.16%
RAM server: RSS 61.8 → 89.8 MB (maks 89.9 MB), docker maks 46.5 MB
Bandwidth payload: server→bot 131.2 kB/s (2.62 kB/s per bot), bot→server 14.7 kB/s (0.29 kB/s per bot)
Bandwidth container (docker): rx 122.3 kB/s, tx 206.5 kB/s (= 1.65 Mbit/s upload)
Pesan: dikirim bot 48353, diterima bot 52367 (state 43987, chat 5130)
Pesan ditolak server: 0
Gerbang M3: p95 < 150 ms = LULUS, CPU < 60% = LULUS
```

Catatan: bot dan server berjalan di mesin yang sama, jadi latensi tidak mencakup jaringan internet. Di VPS, tambahkan RTT jaringan nyata ke angka p95.

## Pindah ke VPS

1. VPS 1–2 vCPU, 1–2 GB RAM cukup untuk satu room 50 pemain berdasarkan angka di atas (upload ~1,7 Mbit/s per room penuh).
2. Arahkan DNS domain (mis. `mp.contoh.com`) ke IP VPS. Buka port 80 dan 443.
3. Di `Caddyfile`, ganti blok `localhost, 127.0.0.1 { tls internal ... }` dengan:
   ```
   mp.contoh.com {
     reverse_proxy mp-server:8787
   }
   ```
   Caddy akan mengambil sertifikat Let's Encrypt otomatis.
4. Di `docker-compose.yml`, ubah port Caddy ke `"80:80"` dan `"443:443"`, hapus ekspos `8787:8787` dari `mp-server` (cukup lewat Caddy), dan kembalikan `MAX_CONNECTIONS_PER_IP` ke nilai default.
5. `docker compose up -d --build`, lalu cek `curl https://mp.contoh.com/health`.
6. Klien memakai `wss://mp.contoh.com/ws`.

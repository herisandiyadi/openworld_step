# Geo Map Pipeline — Little Tokyo Block M

Pipeline geospasial → map game OpenWorld City. Jalur 1: dataset terpisah di
`public/world-<name>/`, tidak menyentuh dunia prosedural.

## Komponen

| Service | Port | Fungsi |
|---|---|---|
| `services/geo-generator` | 19100 | Fetch OSM, convert, bake, build map pack |
| `services/geo-dashboard` | 19101 | UI admin: buat job, lihat status, daftar job |

Dashboard memanggil generator. Token admin hanya ada di server; browser tidak pernah
melihatnya.

## Alur

1. Admin buka dashboard (19101), isi nama, bbox (lon,lat), jumlah chunk, tinggi bangunan.
2. Generator fetch OSM API 0.6 → `cache/<jobId>/osm.xml`.
3. Bake: `web/tools/geo/build.ts` → `public/world-<name>/` (chunks, index.json, navmesh, map.png).
4. Map pack: `web/tools/geo/map-pack.mjs` → manifest Ed25519 + `public/maps-manifest/latest.json`.
5. Game polling `latest.json`; kalau ada versi baru, UI menampilkan tombol Unduh.
6. Download/verify/stage lewat `ContentUpdateManager`; aktif di launch berikutnya.

## Runtime

Game membaca dimensi dari `index.json` (`configureWorldDimensionsFromIndex`).
Modul runtime (exploration, mapRender, protocol, spawner, laneGraph) memakai
`getWorldDimensions()` / `halfWorldFor()` / `worldSizeFor()` — bukan konstanta.

Spawn ditentukan saat bake: chunk dengan bangunan terbanyak (pusat kota).

## CLI bake manual

```bash
cd web
npx vite-node tools/geo/build.ts -- \
  --xml <osm.xml> --bbox w,s,e,n --name little_tokyo --chunks 32 --height 8
```

## Build map pack manual

```bash
cd web
MAP_PACK_RUN=1 \
CONTENT_SIGNING_KEY_ID=map-pack-1 \
CONTENT_SIGNING_PRIVATE_KEY_FILE=/etc/openworld/map-pack-private.pem \
  npx vite-node tools/geo/map-pack.mjs
```

## Deploy sebagai service

Lihat `deploy/`. Ringkas:

```bash
sudo mkdir -p /etc/openworld /var/log/openworld
sudo cp deploy/geo.env.example /etc/openworld/geo.env   # isi token & key
sudo cp <private-key>.pem /etc/openworld/map-pack-private.pem
sudo chmod 600 /etc/openworld/map-pack-private.pem
sudo cp deploy/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now openworld-geo-generator openworld-geo-dashboard
```

## Catatan

- Public key Ed25519 untuk game: set `VITE_CONTENT_PUBLIC_KEYS` (JSON `{keyId: base64}`).
- Map baru memakai `worldVersion: 3`; game lama yang hanya mendukung `[2]` akan menolak.
- Job history persist di `cache/jobs.json` (atomic), load saat boot.

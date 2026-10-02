# R&D Lalu Lintas: Pengendara Motor dan Perjalanan Bus

Branch `fix/rd-traffic`. Dua bug yang diperbaiki:

1. Motor warga berjalan tanpa pengendara.
2. Naik bus langsung teleport ke halte tujuan, tidak terlihat diantar.

## 1. Pengendara motor warga

- Aset baru `veh_moto_rider` (`tools/assets/defs/traffic.ts`, `buildMotoRider`). Dimodelkan langsung di
  ruang model `veh_moto` (origin sama), jadi di runtime cukup memakai matriks motor tanpa offset.
- Titik kontak (jok, stang, pijakan) ada di `src/game/riderSpec.ts` (`MOTO_RIDER`), dipakai bersama
  oleh generator aset dan runtime. Id aset didefinisikan di sini karena `src/app/assets.ts` milik modul lain.
- Dua node mesh: `rider_paint` (jaket + helm, diwarnai per kendaraan lewat `riderTint`) dan
  `rider_skin` (kepala, tangan, celana, sepatu).
- `src/ambient/AmbientLayer.tsx` menggambarnya sebagai InstancedMesh hanya di atas motor warga:
  +2 draw call untuk semua motor (total lapisan ambient 15 → 17).
- Pengendara sengaja tidak ditanam di `veh_moto`, karena aset itu juga dipakai motor pemain yang
  sudah membawa hero.

## 2. Bus mengantar pemain

Alur: pilih tujuan di menu bus → bus kota datang ke halte → pintu terbuka, pemain duduk di dalam →
bus berjalan di rutenya dan berhenti sebentar di halte perantara → bus berhenti di halte tujuan →
pemain turun.

| File | Peran |
| --- | --- |
| `src/ambient/busRide.ts` | Logika murni: proyeksi halte ke rute, fase perjalanan (`menunggu`, `naik`, `jalan`, `turun`, `selesai`, `gagal`), progres, ETA, kursi pemain di bus. |
| `src/game/busTrip.ts` | State per frame yang menjembatani UI/aksi dengan `AmbientLayer` (pemilik graf lajur). |
| `src/ambient/AmbientLayer.tsx` | Menjalankan perjalanan memakai bus kota yang sama, menulis posisi pemain di kursi bus tiap frame, mengirim status ke HUD 4 Hz. `useFrame` prioritas -1 supaya pemain dan kamera tidak tertinggal satu frame. |
| `src/game/actions.ts` | `rideBusTo` (mulai perjalanan) dan `leaveBus` (turun kapan saja). `travelTo` lama tetap ada sebagai fallback. |
| `src/game/PlayerController.tsx` | Mematikan kontrol jalan kaki dan collider selama di bus, hero dalam pose duduk, watchdog fallback. |
| `src/camera/followCamera.ts`, `CameraRig.tsx` | `BUS_CAMERA`: kamera mengikuti bus dari belakang, lebih jauh dan tinggi dari kamera mobil. |
| `src/state/gameStore.ts` | `busRide` (fase, halte berikutnya, tujuan, progres, ETA); tidak masuk save game. |
| `src/ui/Hud.tsx`, `ActionButtons.tsx`, `BusMenu.tsx`, `styles.css` | Panel perjalanan (status, halte berikutnya, progres, sisa waktu, tombol "Turun di sini"), tombol Turun, label mode "Naik bus", joystick disembunyikan. |

Parameter (di `busRide.ts`): kecepatan 18 m/s, jeda halte perantara 1.2 dtk, pintu 1.4 dtk, bus
muncul 28 m sebelum halte, batas perjalanan 150 dtk.

### Jaring pengaman

Pemain tidak bisa terjebak di bus. Fast travel lama dipakai kalau:

- rute bus kosong atau halte tidak bisa dicapai (`startBusRide` mengembalikan null);
- `AmbientLayer` belum mengambil permintaan dalam 3 detik (`PICKUP_WATCHDOG`);
- perjalanan melewati 150 detik (fase `gagal`).

Tombol "Turun di sini" selalu aktif; di tengah jalan pemain diturunkan di sisi pintu bus.
Selama di bus, dorongan kendaraan warga (B8) dan klakson ke pemain dimatikan.

## Verifikasi

- `npm run typecheck`, `npm run build`, `npx vitest run`: 30 file, 172 test lulus.
- `src/ambient/busRide.test.ts` (8 test baru): semua pasangan halte sampai tujuan dan berhenti
  < 15 m dari halte, perjalanan terlama < 2 menit, halte perantara dilewati berurutan, ETA turun,
  fallback rute kosong, timeout, serta pose dan warna pengendara.
- `npm run assets`: 22/22 aset lulus, termasuk `veh_moto_rider`.
- Di game (Chromium headless): perjalanan bus_0 → bus_11 diamati sampai progres 24%, posisi pemain
  ikut bus, HUD tampil; motor warga yang lewat terlihat dengan pengendara.

## Catatan

- Rute bus berupa loop satu arah, jadi tujuan yang dekat bisa ditempuh memutar (contoh di atas ±90 dtk).
- Saat turun di halte tujuan baru diverifikasi lewat unit test, belum diamati langsung di game.
- Kursi pemain diletakkan pada tinggi tanah di pivot bus; di jalan miring bisa meleset beberapa cm.

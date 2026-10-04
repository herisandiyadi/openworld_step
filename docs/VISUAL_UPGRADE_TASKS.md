# Openworld City — Visual Upgrade Task List

> Scope: meningkatkan visual game 3D mobile WebGL agar mendekati vibe GTA 3/4, tanpa mengorbankan readability, kontrol, dan performa HP.
>
> Status dokumen: task list implementasi setelah prototype daytime/nighttime disetujui.

## 1. Baseline dan target teknis

### P0 — Kunci baseline render

- [ ] Tentukan scene benchmark yang selalu sama: posisi player, kamera, kendaraan, NPC, props, cuaca, dan waktu.
- [ ] Catat baseline di minimal tiga kelas device:
  - [ ] Android low-end
  - [ ] Android mid-range
  - [ ] Desktop/browser modern
- [x] Tambahkan overlay/debug metrics untuk:
  - [x] FPS dan frame time CPU/GPU
  - [x] draw calls
  - [x] triangles
  - [x] texture count dan memory
  - [x] shadow map memory
  - [x] post-processing passes
  - [x] WebGL warnings dan shader compile time
- [x] Tetapkan quality tiers: `Low`, `Medium`, `High`.

### Target awal mobile

- Target utama: **30 FPS stabil** di Android mid-range.
- Visible triangles: sekitar **250k–400k** untuk scene kota aktif.
- Draw calls: target **di bawah 120** untuk gameplay normal.
- Texture memory: target **di bawah 200 MB**, memakai KTX2/Basis.
- Shadow-casting lights: maksimal **1 directional light**.
- Full-screen post-processing: target **1–2 pass gabungan** saat production.

> Prototype capture saat ini jauh di bawah budget geometry, tetapi post-processing dan jumlah texture perlu dipangkas sebelum masuk game utama.

---

## 2. Rendering foundation

### P0 — Renderer dan color pipeline

- [x] Pastikan `WebGLRenderer` memakai `SRGBColorSpace` untuk output.
- [x] Terapkan ACES/AgX tone mapping secara konsisten di semua scene.
- [x] Buat konfigurasi exposure per quality tier.
- [x] Pastikan albedo/color texture memakai sRGB.
- [x] Pastikan normal, roughness, metalness, dan AO map tetap linear.
- [ ] Buat satu konfigurasi lighting yang bisa dipakai siang dan malam.
- [x] Tambahkan renderer capability detection untuk WebGL2, MSAA, half-float render target, dan texture compression.

### P0 — Anti-aliasing

- [x] Aktifkan MSAA saat WebGL2 dan device mampu.
- [x] Sediakan FXAA fallback untuk device yang tidak mendukung MSAA.
- [x] Jangan menjalankan MSAA dan FXAA penuh secara bersamaan jika cost terlalu tinggi.
- [ ] Uji aliasing pada: tiang lampu, roofline, marka jalan, foliage, dan edge bangunan.

**Acceptance criteria:** diagonal edge tidak terlihat patah parah pada viewport mobile, tanpa frame-time spike yang mengganggu.

---

## 3. Daytime visual pass

### P0 — Lighting siang

- [ ] Gunakan hemisphere/sky fill untuk mencegah shadow-side menjadi hitam.
- [ ] Gunakan satu directional key light dengan shadow map.
- [ ] Fit shadow camera ke area gameplay aktif, jangan memakai frustum terlalu besar.
- [ ] Pakai PCF shadow yang kompatibel dengan Three.js r186.
- [ ] Tambahkan fog yang warnanya menyatu dengan horizon.
- [ ] Tambahkan sky gradient dan soft cloud layer tanpa seam atau hard dome arc.

### P0 — Material siang

- [ ] Buat material profile untuk:
  - [ ] Aspal: rough, grain, crack halus, normal map.
  - [ ] Trotoar: tile variation, roughness variation, normal map.
  - [ ] Beton/facade: panel seam, roughness variation, dirt mask.
  - [ ] Kaca: metalness/roughness rendah, environment reflection.
  - [ ] Mobil: painted metal/clearcoat look.
  - [ ] Kayu bench: roughness dan warna tidak seragam.
  - [ ] Foliage: material khusus dengan roughness tinggi.
- [ ] Variasikan material jendela agar tidak terlihat copy-paste.
- [ ] Gunakan atlas/texture sharing untuk props berulang.

### P1 — Contact grounding dan polish

- [ ] Bake AO ke lightmap, vertex color, atau AO texture per asset.
- [ ] Gunakan decal/quad AO hanya sebagai fallback untuk objek dinamis.
- [ ] Pastikan AO hanya muncul di bawah objek yang benar.
- [ ] Tambahkan bloom sangat tipis hanya pada highlight penting.
- [ ] Tambahkan vignette ringan.
- [ ] Gabungkan color grade ke pass post-processing utama saat production.
- [ ] Perbaiki label/debug overlay agar tidak menutupi foreground gameplay.

**Acceptance criteria:**

- [ ] Mobil, bench, pohon, dan lampu terlihat menapak ke permukaan.
- [ ] Tidak ada dark blob, sky seam, texture seam, atau overexposed highlight.
- [ ] Hasil tetap terbaca pada brightness HP sekitar 50–70%.

---

## 4. Night mode

### P0 — Lighting malam

- [ ] Buat state waktu `Day`, `Dusk`, dan `Night`.
- [ ] Gunakan blue-hour hemisphere fill agar scene tidak pitch black.
- [ ] Gunakan satu moon/directional light untuk shadow utama.
- [ ] Batasi point/spot light malam agar tidak semuanya cast shadow.
- [ ] Pool cahaya lampu jalan ke sidewalk dan aspal.
- [ ] Pastikan warna lampu jalan warm amber dan shadow/fill tetap cool blue.

### P0 — Emissive dan gameplay readability

- [ ] Buat lamp head emissive pada streetlamp.
- [ ] Buat jendela gedung dengan state menyala/mati yang bervariasi.
- [ ] Buat headlight mobil dengan emissive mesh + spot light.
- [ ] Buat tail light merah dengan emissive mesh.
- [ ] Tambahkan refleksi cahaya ke permukaan jalan basah secara terkontrol.
- [ ] Pastikan headlight tidak membuat hotspot di atap mobil.
- [ ] Pastikan lampu tidak membuat objek penting hilang dalam darkness.

### P1 — Night atmosphere

- [ ] Buat sky gradient biru-violet dengan stars yang seamless.
- [ ] Tambahkan fog malam yang match dengan warna horizon.
- [ ] Tambahkan bloom half-resolution dengan threshold yang ketat.
- [ ] Tambahkan night grade: cool shadows, warm highlights, vignette ringan.
- [ ] Pastikan tidak ada vertical sky seam, clipped dome, atau banding.
- [ ] Buat opsi kualitas bloom: full, half-res, off.

**Acceptance criteria:**

- [ ] Lampu jalan, jendela, headlight, dan tail light langsung terbaca.
- [ ] Ada pool cahaya yang terlihat di aspal.
- [ ] Jalan dan objek navigasi masih terlihat tanpa menaikkan brightness berlebihan.
- [ ] Tidak ada blown-out orb di kendaraan.
- [ ] Night mode tetap mencapai target FPS pada device mid-range.

---

## 5. Asset dan Blender pipeline

### P0 — Export pipeline

- [ ] Tetapkan Blender scene template untuk asset game.
- [ ] Terapkan transform dan pivot sebelum export.
- [ ] Tetapkan skala dunia: 1 Blender unit = 1 meter.
- [ ] Export runtime utama ke GLB/glTF.
- [ ] Pakai FBX hanya bila dibutuhkan oleh pipeline eksternal.
- [ ] Validasi orientation, scale, normals, tangents, material, dan animation clips.
- [ ] Pastikan asset tetap kompatibel dengan Meshopt decoder.

### P1 — Baked lighting dan AO

- [ ] Buat UV2/lightmap UV untuk bangunan, jalan, dan props statis.
- [ ] Bake indirect lighting dan AO di Blender.
- [ ] Pack lightmap secara efisien per chunk.
- [ ] Uji lightmap seam dan texel density.
- [ ] Pisahkan asset statis dan dinamis.
- [ ] Jangan bake shadow yang harus bergerak pada kendaraan/NPC.

### P1 — Texture compression

- [ ] Konversi albedo, normal, ORM, dan lightmap ke KTX2/Basis.
- [ ] Pack occlusion/roughness/metalness ke ORM texture.
- [ ] Sediakan fallback texture untuk browser tanpa compressed texture support.
- [ ] Tetapkan maximum texture size per asset class.
- [ ] Buat texture LOD untuk objek jauh.

### P2 — Asset quality

- [ ] Tambahkan facade kit modular: pintu, jendela, signage, balkon, AC unit, drainase.
- [ ] Buat variasi gedung agar kota tidak terasa seperti satu slab.
- [ ] Tambahkan props berulang dengan InstancedMesh.
- [ ] Buat LOD untuk tree, bench, lamp, kendaraan, dan bangunan.
- [ ] Tambahkan decal atlas untuk dirt, crack, road wear, dan signage.

---

## 6. World streaming dan kepadatan kota

### P0 — Chunk runtime

- [ ] Tetapkan ukuran chunk dan radius streaming berdasarkan device tier.
- [ ] Load GLB/chunk secara asynchronous.
- [ ] Unload chunk yang terlalu jauh dari player.
- [ ] Prefetch chunk berdasarkan arah gerak player.
- [ ] Pastikan NPC, kendaraan, dan lampu hanya aktif di chunk relevan.

### P1 — Culling dan instancing

- [ ] Frustum culling untuk seluruh chunk.
- [ ] Distance culling untuk props kecil.
- [ ] Occlusion strategy untuk bangunan besar.
- [ ] Instancing untuk lampu, pohon, bench, traffic light, dan trash bin.
- [ ] Batasi update AI/animation pada objek jauh.

**Acceptance criteria:** berpindah antarchunk tidak menyebabkan hitch besar, blank area, atau pop-in yang mengganggu.

---

## 7. Post-processing production pass

### P0 — Gabungkan pass mahal

- [ ] Audit lima composer pass pada prototype.
- [ ] Gabungkan tone grade + vignette + saturation/contrast ke satu shader pass.
- [ ] Jalankan bloom pada half/quarter resolution.
- [ ] Matikan bloom di Low tier.
- [ ] FXAA hanya sebagai fallback ketika MSAA tidak tersedia.
- [ ] Hindari SSAO/SSGI realtime di mobile.

### Target production

- [ ] High: maksimal 2 full-screen pass utama.
- [ ] Medium: 1 full-screen pass gabungan.
- [ ] Low: tanpa bloom atau hanya satu pass ringan.
- [ ] Tidak ada pass yang membaca framebuffer lebih dari yang diperlukan.

---

## 8. UI, controls, dan readability mobile

### P1 — Mobile visual QA

- [ ] Uji portrait dan landscape jika keduanya didukung.
- [ ] Pastikan HUD tidak tertutup oleh safe area/notch.
- [ ] Pastikan lampu malam tidak mengganggu target selection dan navigasi.
- [ ] Sediakan brightness/quality option yang jelas.
- [ ] Tambahkan reduced motion option bila ada camera/bloom effect.
- [ ] Pastikan pause/background return tidak merusak renderer atau light state.

### P1 — Debug versus release

- [ ] Pisahkan overlay debug dari build production.
- [ ] Jangan menampilkan renderer stats ke user biasa.
- [ ] Simpan screenshot benchmark per quality tier.
- [ ] Tambahkan capture test untuk day/night dan low/high quality.

---

## 9. QA dan acceptance checklist

### Visual QA

- [ ] Day before/after capture tersimpan.
- [ ] Night before/after capture tersimpan.
- [ ] Kamera dan asset sama saat perbandingan.
- [ ] Tidak ada mesh hitam atau hilang.
- [ ] Tidak ada sky seam, hard dome arc, atau texture seam.
- [ ] Tidak ada decal/road blob yang salah posisi.
- [ ] Tidak ada blown-out bloom yang menghilangkan siluet kendaraan.
- [ ] Contact shadow/AO berada di bawah objek yang tepat.
- [ ] Semua lampu malam terbaca dan scene tetap navigable.

### Performance QA

- [ ] FPS/frame time dicatat pada tiga kelas device.
- [ ] Cold shader compile time dicatat.
- [ ] Memory setelah 10 menit gameplay dicatat.
- [ ] Chunk streaming diuji dengan pergerakan cepat.
- [ ] Quality tier dapat berpindah tanpa reload scene.
- [ ] Tidak ada console error atau WebGL context loss.

### Regression QA

- [ ] Gameplay dan collision tidak berubah karena visual pass.
- [ ] Kamera tidak berubah.
- [ ] Spawn NPC/kendaraan tetap benar.
- [ ] Siang dan malam tidak mengubah navigability.
- [ ] Build APK/PWA/Web tetap bisa dijalankan pada target platform.

---

## 10. Urutan implementasi yang disarankan

### Milestone 1 — Production lighting base

- [ ] Renderer color pipeline
- [ ] ACES/exposure
- [ ] Hemisphere + directional light
- [ ] Shadow budget satu caster
- [ ] Fog dan sky siang
- [ ] Quality tier dasar

### Milestone 2 — Daytime material pass

- [ ] Asphalt, sidewalk, facade, window texture
- [ ] Roughness/metalness profiles
- [ ] AO/lightmap awal
- [ ] Anti-aliasing fallback
- [ ] Daytime QA capture

### Milestone 3 — Night mode playable

- [ ] Day/dusk/night state
- [ ] Streetlamp pools
- [ ] Window emissive variation
- [ ] Headlights/tail lights
- [ ] Blue-hour fill dan night fog
- [ ] Night QA capture

### Milestone 4 — Asset pipeline

- [ ] Blender template
- [ ] GLB export validation
- [ ] UV2/lightmap
- [ ] KTX2/Basis
- [ ] LOD dan atlas

### Milestone 5 — World scale dan optimization

- [ ] Chunk streaming
- [ ] Instancing
- [ ] Culling
- [ ] Post-pass merge
- [ ] Device matrix benchmark

### Milestone 6 — City density dan polish

- [ ] Modular facade kit
- [ ] Building variation
- [ ] More props and traffic
- [ ] Weather/time variation
- [ ] Final mobile QA dan release build

---

## Prototype reference metrics

### Daytime

- Current panel: 55 draw calls, 3,732 triangles, 5 programs, 5 textures, 0 composer pass.
- Maxed panel: 87 draw calls, 6,754 triangles, 22 programs, 32 textures, 5 composer passes.

### Nighttime

- Naive panel: 55 draw calls, 3,732 triangles, 5 programs, 5 textures, 0 composer pass.
- Art-directed panel: 101 draw calls, 6,822 triangles, 25 programs, 37 textures, 5 composer passes.
- Night lights: 1 shadow caster, 6 unshadowed point lights, 2 unshadowed spotlights, 6 emissive meshes, 15 glow quads.

> Angka prototype ini adalah referensi visual, bukan target production final. Fokus optimasi terbesar: bloom, full-screen passes, shader warmup, texture compression, dan shadow map.

## Definition of Done

Implementasi visual dianggap siap masuk build game bila:

- [ ] Day dan night mode menghasilkan look yang konsisten dengan approved capture.
- [ ] Tidak ada defect visual yang sudah ditemukan pada prototype.
- [ ] Semua asset runtime tervalidasi dan terkompresi.
- [ ] Target FPS tercapai pada device matrix.
- [ ] Tidak ada regression pada gameplay, collision, streaming, atau mobile controls.
- [ ] Debug metrics dan screenshot evidence tersimpan untuk setiap quality tier.

# MASTER PROMPT: ORCHESTRATOR GAME 3D OPEN WORLD (ANDROID, KONTROL MOBA)

## 0. PERAN
Kamu adalah **Lead Orchestrator** untuk proyek game Android 3D open world.
Kamu memecah pekerjaan ke peran sub-agent di bawah, menjalankannya per fase,
dan TIDAK lanjut ke fase berikutnya sebelum gerbang validasi fase saat ini lulus.
Setiap akhir fase, laporkan: apa yang selesai, apa yang diuji, hasil metrik, risiko.

## 1. TARGET PRODUK
- Platform: Android (WebView via Capacitor), mode landscape, target 30 FPS stabil
  di perangkat mid-range (setara Snapdragon 6xx/7xx, RAM 4 GB), 60 FPS di high-end.
- Genre: open world 3D, satu pemain, eksplorasi + combat ringan.
- Kontrol gaya MOBA:
  - Kamera isometrik/top-down miring (pitch ~50-60°, FOV 40-50°), mengikuti karakter dengan smoothing.
  - Gerak: tap/klik di dunia = karakter berjalan ke titik itu (click-to-move + pathfinding),
    DAN joystick virtual kiri-bawah sebagai alternatif.
  - Kanan-bawah: tombol serangan dasar (besar) + 3-4 tombol skill dengan cooldown radial,
    mendukung drag-to-aim (arah/area) seperti MOBA mobile.
  - Tap pada musuh/objek = auto-target dan auto-attack.
  - Multi-touch aman (joystick + skill bersamaan), tidak ada konflik gesture dengan WebView.
- UI wajib:
  - **Minimap di pojok KIRI ATAS**: bulat/persegi, rotasi tetap (north-up) dengan opsi follow,
    menampilkan posisi pemain, arah hadap, musuh (merah), NPC/quest (kuning), area terjelajahi
    (fog of war). Tap minimap = buka peta besar. Render via kamera ortografis ke
    render target kecil ATAU kanvas 2D (pilih yang lebih murah, justifikasi dengan benchmark).
  - HP/MP di dekat minimap atau bawah-tengah, indikator quest, tombol pause.

## 2. TECH STACK (WAJIB)
- three.js + React Three Fiber (R3F) + @react-three/drei, TypeScript, Vite.
- State: Zustand. Fisika: Rapier (@react-three/rapier) hanya untuk yang perlu
  (karakter kinematik, collider statis sederhana). Hindari fisika berat.
- Pathfinding: navmesh (three-pathfinding atau recast-navigation-js) dibake dari collider level.
- ECS ringan opsional (miniplex/bitecs) untuk musuh massal.
- Packaging: Capacitor Android, build APK/AAB, test di emulator dan perangkat nyata.
- Aset 3D: HANYA format **GLB** (glTF 2.0 binary).
- Tooling aset: gltf-transform (CLI) untuk optimasi, gltfjsx untuk generate komponen R3F bila perlu.

## 3. ANGGARAN PERFORMA MOBILE (HARD LIMIT)
- Draw call ≤ 150 per frame; segitiga di layar ≤ 300k (target 150k).
- Pixel ratio dibatasi: min(devicePixelRatio, 1.5); sediakan preset Low/Med/High + auto-adjust FPS (drei PerformanceMonitor).
- Tekstur: maks 1024 px untuk karakter, 512-1024 px untuk environment, format KTX2 (Basis Universal).
- Mesh: kompresi meshopt atau Draco; kuantisasi aktif.
- Bayangan: 1 directional light dengan shadow map ≤ 1024, hanya sekitar pemain
  (atau blob shadow murah untuk NPC/musuh). Tanpa post-processing berat
  (hindari SSAO, bloom mahal, DoF). Boleh: fog, vignette ringan, tone mapping.
- Memori JS+GPU total ≤ ~600 MB; wajib dispose geometri/material/tekstur saat chunk di-unload.
- Ukuran APK target ≤ 150 MB.

## 4. ARSITEKTUR OPEN WORLD
- Dunia dibagi **chunk grid** (mis. 64×64 unit). Streaming berdasarkan jarak pemain:
  load radius 2 chunk, unload di luar 3 chunk, di web worker bila memungkinkan, dengan prioritas antrean.
- Terrain: heightmap (displaced plane atau chunked mesh) + splat-map/triplanar tekstur ringan.
- Vegetasi/prop: InstancedMesh + frustum culling per chunk, LOD (3 level) atau impostor billboard jarak jauh.
- Biome minimal: 3 (mis. padang rumput, hutan, gurun/pegunungan), siklus siang-malam sederhana (hanya warna light + fog).
- Data dunia (posisi prop, spawn musuh, NPC, quest) disimpan sebagai JSON per chunk (data-driven), bukan hardcode.
- Save/load: localStorage/Capacitor Preferences (posisi, HP, quest, fog of war).
- Loading: GLB preload per chunk dengan useGLTF + cache, tampilkan loading screen awal saja, jangan ada freeze saat streaming (budget ≤ 4 ms/frame untuk proses loading).

## 5. STRUKTUR SUB-AGENT
1. **Architect**: struktur folder, tipe, kontrak antar modul, ADR singkat.
2. **Gameplay Engineer**: karakter, kamera MOBA, click-to-move, skill, combat, AI musuh (state machine: idle/patrol/chase/attack).
3. **World Engineer**: chunk streaming, terrain, instancing, LOD, navmesh.
4. **UI/UX Engineer**: HUD, joystick, skill button, minimap, peta besar, menu pause, responsif terhadap safe-area/notch.
5. **3D Asset Pipeline Agent**: lihat bagian 6.
6. **Performance/QA Engineer**: profiling, uji perangkat, regresi, checklist rilis.
7. **Build/Release Engineer**: Capacitor, signing, APK/AAB, ikon, splash.

## 6. PIPELINE ASET 3D GLB

### 6A. Pilih MODE (tanya saya sekali di awal, default: Mode B)
- **Mode A: Blender MCP** (detail lebih tinggi, perlu Blender + add-on MCP berjalan).
  Gunakan tool MCP Blender untuk: membuat/memodifikasi mesh, material PBR sederhana,
  rigging dasar, animasi (idle/walk/run/attack/hit/death), lalu ekspor GLB.
  Jika ada integrasi Poly Haven/Hyper3D/Sketchfab di MCP, boleh dipakai untuk tekstur/model dasar
  (cek lisensi, catat di ASSET_LICENSES.md).
- **Mode B: Pure AI/Prosedural** (tanpa Blender).
  Hasilkan aset lewat skrip: (1) primitive + merge geometri gaya low-poly stylized di three.js lalu ekspor
  dengan GLTFExporter, atau (2) skrip Python (bpy headless / trimesh) yang menghasilkan GLB,
  atau (3) generator parametrik (pohon, batu, rumah, pagar). Gaya visual: **low-poly stylized
  dengan palet warna terbatas** (agar konsisten, ringan, dan tidak butuh tekstur besar;
  gunakan vertex color atau 1 atlas palet).

### 6B. Spesifikasi aset
- Skala: 1 unit = 1 meter. Pivot di dasar objek. +Y up, -Z forward. Terapkan transform (apply scale/rotation).
- Nama node/material konsisten: `char_hero`, `enemy_slime`, `prop_tree_01`, `anim_Idle`, dst.
- Budget segitiga: hero ≤ 5k, musuh ≤ 2.5k, NPC ≤ 3k, prop kecil ≤ 500, pohon ≤ 800, bangunan ≤ 3k.
- Karakter: skeleton ≤ 40 tulang, animasi ber-clip terpisah di satu GLB, loop mulus.
- Material: PBR metallic-roughness sederhana, maks 1-2 material per objek, tanpa transparansi bila tidak perlu.
- Kolisi: sediakan collider sederhana terpisah (box/capsule/convex rendah) dalam metadata, bukan mesh visual.
- Set minimal v1: 1 hero, 3 tipe musuh, 2 NPC, ~12 prop environment per biome, 3 tipe pohon, batu, semak, bangunan kecil, pickup, efek skill (partikel diatur di kode, bukan aset berat).

### 6C. FINALISASI ASET (wajib per aset sebelum masuk /public/assets)
1. Validasi: `gltf-validator` tanpa error.
2. Optimasi: `gltf-transform optimize` (dedup, prune, weld, simplify bila perlu, join, instance),
   tekstur ke KTX2, kompresi meshopt/Draco.
3. Cek: ukuran file, jumlah segitiga, draw call, jumlah material, ukuran tekstur terhadap budget.
4. Render turntable/thumbnail untuk review visual, simpan ke /asset-previews.
5. Daftarkan di `assets/manifest.json` (id, path, tris, ukuran, tag biome, collider, lisensi).
6. Uji muat di game di perangkat/emulator, pastikan skala, orientasi, animasi benar.
Aset yang gagal salah satu langkah dikembalikan ke tahap pembuatan, bukan dipaksa masuk.

## 7. FASE KERJA & GERBANG VALIDASI
**Fase 0: Perencanaan.** Hasilkan GDD ringkas, daftar fitur MVP vs nanti, struktur folder, risiko.
Gerbang: saya setujui rencana.
**Fase 1: Prototype inti.** Scene kosong + terrain datar, karakter placeholder (kapsul), kamera MOBA,
joystick + click-to-move, HUD dasar, minimap kiri atas versi awal. Jalan di APK.
Gerbang: kontrol terasa responsif di perangkat, ≥ 45 FPS.
**Fase 2: Pipeline aset.** Bangun pipeline 6A-6C dan hasilkan aset hero + 1 musuh + 5 prop sebagai bukti.
Gerbang: aset lulus finalisasi dan tampil benar di game.
**Fase 3: World streaming.** Chunk streaming, terrain heightmap, instancing, navmesh, 2 biome.
Gerbang: berjalan lintas peta tanpa hitch > 50 ms, memori stabil (tidak bocor).
**Fase 4: Gameplay.** Skill + cooldown + drag-to-aim, combat, AI musuh, loot, quest sederhana, save/load, fog of war di minimap.
**Fase 5: Konten & polish.** Semua aset set minimal, biome ke-3, siang-malam, SFX/musik ringan, efek skill.
**Fase 6: Optimasi & rilis.** Profiling di perangkat low/mid/high, preset grafis, APK/AAB signed, checklist rilis.

## 8. ATURAN KERJA
- Kode TypeScript strict, modular, komentar seperlunya, tanpa dependensi berlebihan (jelaskan tiap dependensi baru).
- Jangan bangun semuanya sekaligus: kerjakan satu fase, jalankan, uji, baru lanjut.
- Selalu sertakan cara menjalankan (`npm run dev`, `npm run build`, `npx cap sync android`, `npx cap run android`).
- Jika ada keputusan ambigu yang memengaruhi arsitektur, ajukan MAKSIMAL 3 pertanyaan sekaligus
  dengan rekomendasi default; kalau saya tidak menjawab, pakai default.
- Dokumentasikan: README, ARCHITECTURE.md, ASSET_PIPELINE.md, PERF_BUDGET.md, ASSET_LICENSES.md.
- Setiap fase diakhiri laporan: ✅ selesai, 🧪 hasil uji + metrik FPS/memori, ⚠️ risiko, ➡️ langkah berikutnya.

## 9. MULAI
Mulai dari Fase 0. Sebelum menulis kode, tanyakan padaku: (1) Mode aset A atau B,
(2) tema/setting dunia, (3) apakah perlu multiplayer di masa depan (memengaruhi arsitektur state).
Lalu sajikan rencana Fase 0.
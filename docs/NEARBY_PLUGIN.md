# NearbyPlugin (Nearby Connections, multiplayer lokal)

Plugin Capacitor native untuk sesi "main bareng" tanpa internet, memakai **Nearby Connections**
(Google Play Services) dengan topologi **`Strategy.P2P_STAR`**: satu **host** yang advertise +
maksimal **4 klien** yang discover. Semua pesan game lewat host (lihat `MULTIPLAYER.md` bagian 4).

- Kode native: `web/android/app/src/main/java/com/openworld/city/NearbyPlugin.java`
- Deklarasi JS/TS: `web/src/net/nearbyPlugin.ts` (`registerPlugin<NearbyPluginApi>('Nearby')`)
- Didaftarkan di `MainActivity.java` bersama `AiStreamPlugin` dan `PlayerDbPlugin`
- Dependency: `com.google.android.gms:play-services-nearby:19.3.0` (versi di-pin, bukan `+`),
  kompatibel dengan `compileSdk`/`targetSdk` 35 dan `minSdk` 23 di `variables.gradle`
- `serviceId` Nearby: `com.openworld.city.session` (harus sama di semua HP)

## Method

| Method | Argumen | Hasil |
| --- | --- | --- |
| `startAdvertising` | `{ localName: string }` | `void` — host mulai advertise (P2P_STAR) |
| `startDiscovery` | — | `void` — klien mulai mencari host |
| `stopAll` | — | `void` — stopAdvertising + stopDiscovery + putus semua endpoint |
| `requestConnection` | `{ endpointId: string, localName?: string }` | `void` — minta sambung ke endpoint hasil `endpointFound` |
| `acceptConnection` | `{ endpointId: string }` | `void` — terima setelah kode 4 digit cocok |
| `rejectConnection` | `{ endpointId: string }` | `void` |
| `send` | `{ endpointId?: string, data: string (base64), reliable: boolean }` | `{ sentTo: number, reliable: true }` — `endpointId` kosong = broadcast ke semua yang tersambung |
| `connectedEndpoints` | — | `{ endpoints: { endpointId, name }[], advertising: boolean, discovering: boolean }` |
| `checkPermissions` | — | status izin (lihat bawah) |
| `requestPermissions` | — | status izin setelah dialog |

`data` adalah **string base64 dari `Uint8Array`**. Helper `bytesToBase64` / `base64ToBytes` ada di
`nearbyPlugin.ts` dan memakai `Base64.NO_WRAP` yang sama dengan sisi Java.

### Validasi input (semua membalas `call.reject` dengan pesan jelas)

- `localName` kosong/null → "localName wajib diisi" (dipotong ke 64 karakter kalau terlalu panjang)
- `endpointId` kosong → "endpointId wajib diisi"
- `endpointId` belum pernah muncul di `endpointFound`/`connectionInitiated` → "endpointId tidak dikenal: …"
- `send` ke endpoint yang tidak tersambung → "endpointId tidak tersambung: …"
- `data` null → "data (base64) wajib diisi"; bukan base64 valid → "data bukan base64 yang valid";
  kosong → "data kosong"; lebih dari 32 KB → "data terlalu besar (… byte, maksimal 32768)"
- Broadcast tanpa endpoint tersambung → "Tidak ada endpoint yang tersambung"
- Izin belum lengkap → "Izin `<alias>` belum diberikan. Panggil requestPermissions() lebih dulu."

## Event (`notifyListeners`)

| Event | Payload |
| --- | --- |
| `endpointFound` | `{ endpointId: string, name: string }` |
| `endpointLost` | `{ endpointId: string }` |
| `connectionInitiated` | `{ endpointId: string, name: string, authDigits: string }` |
| `connected` | `{ endpointId: string, name: string }` |
| `connectionFailed` | `{ endpointId: string, status: number, message: string }` |
| `disconnected` | `{ endpointId: string }` |
| `payload` | `{ endpointId: string, data: string (base64) }` |

Hanya `Payload.Type.BYTES` yang diteruskan ke JS; tipe FILE/STREAM diabaikan karena protokol game
tidak memakainya.

## Izin per versi Android

Diminta lewat anotasi `@Permission` Capacitor dengan alias, dan dipilih saat runtime berdasarkan
`Build.VERSION.SDK_INT`:

| Versi | Izin runtime yang diminta | Alias |
| --- | --- | --- |
| Android 13+ (API 33+) | `BLUETOOTH_SCAN`, `BLUETOOTH_ADVERTISE`, `BLUETOOTH_CONNECT`, `NEARBY_WIFI_DEVICES` | `bluetoothScan`, `bluetoothAdvertise`, `bluetoothConnect`, `nearbyWifiDevices` |
| Android 12 (API 31-32) | `BLUETOOTH_SCAN`, `BLUETOOTH_ADVERTISE`, `BLUETOOTH_CONNECT`, `ACCESS_FINE_LOCATION` | + `location` |
| Android 11 ke bawah (API 23-30) | `ACCESS_FINE_LOCATION` (Bluetooth lama = install-time di manifest) | `location` |

`checkPermissions()`/`requestPermissions()` mengembalikan `{ nearby: 'granted' | 'prompt' | … }`
sebagai ringkasan, plus state per alias yang relevan di versi itu.

Manifest (`web/android/app/src/main/AndroidManifest.xml`, izin lama tetap ada):
`BLUETOOTH`/`BLUETOOTH_ADMIN` (`maxSdkVersion="30"`), `BLUETOOTH_SCAN`, `BLUETOOTH_ADVERTISE`,
`BLUETOOTH_CONNECT`, `NEARBY_WIFI_DEVICES`, `ACCESS_COARSE_LOCATION` dan `ACCESS_FINE_LOCATION`
(keduanya `maxSdkVersion="32"`), `ACCESS_WIFI_STATE`, `CHANGE_WIFI_STATE`, dan `uses-feature`
`bluetooth`, `bluetooth_le`, `wifi`, `wifi.direct` (semua `required="false"`).

## Kode konfirmasi 4 digit

Sesuai `MULTIPLAYER.md` bagian 5, kedua HP harus menampilkan angka yang sama sebelum menerima koneksi:

1. Saat `onConnectionInitiated`, plugin mengambil `ConnectionInfo.getAuthenticationDigits()` —
   nilai ini dihitung Nearby dari token koneksi dan **identik di kedua perangkat**. Non-digit
   dibuang, lalu diambil 4 digit pertama.
2. Kalau API itu mengembalikan `null` (perangkat/versi Play Services lama), plugin mem-fold
   `getRawAuthenticationToken()` dengan FNV-1a 32-bit lalu `% 10000`, di-pad jadi 4 digit. Token
   mentahnya sama di kedua sisi dan fold-nya deterministik, jadi hasilnya tetap cocok.
3. Angka itu dikirim sebagai `authDigits` di event `connectionInitiated`. UI menampilkannya; kalau
   pemain setuju → `acceptConnection`, kalau tidak → `rejectConnection`.

## Keterbatasan

- **`reliable` tidak berpengaruh:** `Payload.Type.BYTES` di Nearby **selalu reliable dan terurut**.
  Tidak ada jalur unreliable, jadi paket posisi 10-15 Hz juga dikirim reliable. Untuk v1 lokal
  (5 HP, ~1 KB/s) ini aman; `send()` selalu membalas `reliable: true` supaya sisi JS tidak
  mengasumsikan ada mode lain.
- **Maksimal 5 perangkat** (host + 4 klien) pada `P2P_STAR`.
- **Butuh Google Play Services** di semua HP. Tidak jalan di emulator tanpa Play Services, dan
  tidak jalan di browser (`npm run dev`) — sisi JS harus pakai fallback/loopback transport di web.
- Payload dibatasi 32 KB per pesan oleh plugin (batas Nearby sendiri 1 MB untuk BYTES).
- Penemuan awal lewat Bluetooth makin lambat per perangkat tambahan sebelum upgrade ke Wi-Fi.

## Cara menguji di HP fisik

```bash
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export ANDROID_HOME=/opt/android-sdk
cd web && npm run build && npx cap sync android
cd android && bash ./gradlew assembleDebug   # gradlew tanpa bit executable → pakai `bash`
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

1. Pasang APK di **dua HP atau lebih** (Android 8+ dengan Play Services), nyalakan Bluetooth,
   Wi-Fi, dan Lokasi (Lokasi wajib aktif di Android 12 ke bawah).
2. Terima semua dialog izin pada pembukaan pertama (`requestPermissions`).
3. HP A: "Buat sesi lokal" → `startAdvertising({ localName })`.
   HP B: "Gabung sesi lokal" → `startDiscovery()`, tunggu entri dari `endpointFound`.
4. HP B pilih host → `requestConnection`. Kedua HP menampilkan 4 digit dari `connectionInitiated`;
   pastikan **angkanya sama**, lalu keduanya `acceptConnection`.
5. Setelah event `connected`, cek lalu lintas pesan dengan `adb logcat -s Capacitor:V NearbyConnections:V`.
6. Uji putus koneksi: matikan Wi-Fi/Bluetooth di satu HP atau jauhkan perangkat → harus muncul
   `disconnected`, dan `stopAll()` harus membersihkan semuanya.

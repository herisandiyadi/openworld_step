# Openworld City: web / Android

Kode game (three.js + React Three Fiber + Capacitor). Dokumentasi lengkap ada di [README utama](../README.md).

```
npm install
npm run dev          # browser
npm test             # unit test
npm run build        # typecheck + bundle
npx cap sync android # lalu: cd android && gradlew assembleDebug
```

## Catatan build di jaringan kantor

Jaringan memakai SSL inspection, jadi Gradle butuh truststore yang memuat CA tersebut
(`android/corp-cacerts.jks`, tidak di-commit) dan JDK 21 dari Android Studio:

```
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio1\jbr'
$env:JAVA_TOOL_OPTIONS = '-Djavax.net.ssl.trustStore=<path>\android\corp-cacerts.jks -Djavax.net.ssl.trustStorePassword=changeit'
```

## Uji performa

Menu jeda -> "Uji performa" (atau buka dengan `?soak`) menjalankan pemain keliling peta 2 putaran
(~3 menit) lalu menampilkan FPS, hitch > 50 ms, waktu pasang chunk, dan memori per putaran.
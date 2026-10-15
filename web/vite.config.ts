import { createReadStream, existsSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Dev-server only: layani /world/** langsung dari disk.
 *
 * Kenapa perlu: aktivasi peta menukar public/world/ (world.next -> world), tetapi Vite
 * men-cache daftar file publicDir saat startup. Setelah penukaran, path chunk yang belum
 * pernah diminta jatuh ke fallback SPA dan dibalas index.html -- game menerima HTML,
 * JSON.parse gagal, dan gedung/jalan tidak ter-render. Middleware ini membaca disk setiap
 * request sehingga peta yang baru diaktifkan langsung terpakai tanpa restart.
 */
function worldDir(): Plugin {
  const MIME: Record<string, string> = {
    '.json': 'application/json',
    '.bin': 'application/octet-stream',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.glb': 'model/gltf-binary',
  };
  return {
    name: 'world-dir',
    apply: 'serve',
    configureServer(server) {
      const root = resolve(server.config.publicDir ?? 'public');
      server.middlewares.use((req, res, next) => {
        const url = req.url || '';
        if (!url.startsWith('/world/')) return next();
        const rel = normalize(decodeURIComponent(url.split('?')[0].replace(/^\/world\//, '')));
        const file = resolve(join(root, 'world', rel));
        // Tolak path traversal: hasil resolve harus tetap di dalam public/world.
        if (file !== join(root, 'world') && !file.startsWith(join(root, 'world') + sep)) {
          res.statusCode = 403;
          return res.end('forbidden');
        }
        if (!existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-store');
        createReadStream(file).pipe(res);
      });
    },
  };
}

/** Dev-server only: receives the ?soak report (src/app/SoakTest.tsx) and writes it to soak-report.json. */
function soakReport(): Plugin {
  return {
    name: 'soak-report',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__soak', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        req.on('data', (part: Buffer) => {
          body += part.toString();
          if (body.length > 1_000_000) req.destroy();
        });
        req.on('end', () => {
          try {
            writeFileSync('soak-report.json', JSON.stringify(JSON.parse(body), null, 2));
            res.statusCode = 204;
          } catch {
            res.statusCode = 400;
          }
          res.end();
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), worldDir(), soakReport()],
  base: './',
  // Dev-only: izinkan akses via tunnel (cloudflared/ngrok). Tidak berpengaruh ke build.
  server: { allowedHosts: true },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tools/content/**/*.test.ts'],
  },
});
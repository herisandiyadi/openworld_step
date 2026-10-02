import { writeFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

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
  plugins: [react(), soakReport()],
  base: './',
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
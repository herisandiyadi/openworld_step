import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Scoped config for content-tooling tests. The root vite.config.ts only includes src/**,
 * so run these with: npx vitest run --config tools/content/vitest.config.ts
 */
export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  test: {
    environment: 'node',
    include: ['tools/content/**/*.test.ts'],
  },
});

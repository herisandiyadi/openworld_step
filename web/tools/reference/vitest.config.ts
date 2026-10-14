import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Scoped config for the reference-artefact tests (slim hero rig, Notion 11.6). */
export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  test: { environment: 'node', include: ['tools/reference/**/*.test.ts'] },
});

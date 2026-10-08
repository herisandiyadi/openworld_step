/**
 * `npm run content:check` – validate a content pack without modifying it.
 *
 * Usage:  vite-node tools/content/check.ts [pack-dir]
 *         pack-dir defaults to web/content/base
 */

import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { validatePack } from './validate';

const packDir = resolve(process.argv[2] ?? join(import.meta.dirname, '../../content/base'));

function readJson(name: string): unknown {
  const path = join(packDir, name);
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { throw new Error(`Unable to read ${path}: ${error instanceof Error ? error.message : String(error)}`); }
}

const raw: Record<string, unknown> = {
  manifest: readJson('manifest.json'),
  npcs: readJson('npcs.json'),
  quests: readJson('quests.json'),
  regions: readJson('regions.json'),
  shops: readJson('shops.json'),
  items: readJson('items.json'),
  economy: readJson('economy.json'),
  fishing: readJson('fishing.json'),
};
const result = validatePack(raw);
if (!result.ok) {
  console.error(`Content pack ${packDir} is invalid:`);
  for (const violation of result.violations) console.error(`- ${violation}`);
  process.exit(1);
}
console.log(`Content pack ${packDir} is valid.`);
console.log(`${(raw.npcs as unknown[]).length} NPCs, ${(raw.quests as unknown[]).length} quests, ${(raw.regions as unknown[]).length} regions.`);

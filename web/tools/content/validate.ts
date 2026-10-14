/**
 * Content pack validator – pure function, no filesystem, no side effects.
 *
 * Called by `npm run content:check` (tools/content/pack.ts main) and also
 * imported directly in unit tests from src/content/validate.test.ts.
 */

import {
  EconomySchema,
  FishingSchema,
  ItemSchema,
  ManifestSchema,
  NpcSchema,
  QuestSchema,
  RegionSchema,
  ShopSchema,
} from '../../src/content/schema';
import { z } from 'zod';
import { runFishingBalanceSimulation } from './simulate';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ValidationResult {
  ok: boolean;
  violations: string[];
}

// Any raw JSON object (validated through zod schemas below)
type RawPack = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

function schemaViolations<T>(label: string, items: unknown, schema: z.ZodType<T>): string[] {
  const violations: string[] = [];
  if (!Array.isArray(items)) {
    violations.push(`${label}: expected an array`);
    return violations;
  }
  for (const item of items) {
    const result = schema.safeParse(item);
    if (!result.success) {
      const idHint =
        item !== null && typeof item === 'object' && 'id' in item &&
        typeof (item as Record<string, unknown>).id === 'string'
          ? ` "${String((item as Record<string, unknown>).id)}"`
          : '';
      for (const issue of result.error.issues) {
        violations.push(`${label}${idHint}: ${issue.path.join('.') || '<root>'}: ${issue.message}`);
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Cross-reference checks
// ---------------------------------------------------------------------------

function referenceViolations(rawPack: {
  npcs: unknown[];
  quests: unknown[];
  shops: unknown[];
  items: unknown[];
}): string[] {
  const violations: string[] = [];

  const isObj = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === 'object';
  const safeStr = (v: unknown): string | undefined =>
    typeof v === 'string' ? v : undefined;
  const safeStrArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];

  const questIds = new Set<string>(
    rawPack.quests.filter(isObj).map(q => safeStr(q.id)).filter((s): s is string => s !== undefined),
  );
  const npcIds = new Set<string>(
    rawPack.npcs.filter(isObj).map(n => safeStr(n.id)).filter((s): s is string => s !== undefined),
  );
  const itemIds = new Set<string>(
    rawPack.items.filter(isObj).map(i => safeStr(i.id)).filter((s): s is string => s !== undefined),
  );

  // NPC.questGiver must reference known quest ids
  for (const npc of rawPack.npcs.filter(isObj)) {
    for (const qid of safeStrArr(npc.questGiver)) {
      if (!questIds.has(qid)) {
        violations.push(`npc "${String(npc.id)}".questGiver references unknown quest "${qid}"`);
      }
    }
  }

  // Quest.giver must reference a known NPC id
  for (const quest of rawPack.quests.filter(isObj)) {
    const giver = safeStr(quest.giver);
    if (giver && !npcIds.has(giver)) {
      violations.push(`quest "${String(quest.id)}".giver references unknown NPC "${giver}"`);
    }
    // Quest.requires must reference known quest ids
    for (const reqId of safeStrArr(quest.requires)) {
      if (!questIds.has(reqId)) {
        violations.push(`quest "${String(quest.id)}".requires references unknown quest "${reqId}"`);
      }
    }
    // Quest.rewards.items must reference known item ids
    const rewards = isObj(quest.rewards) ? quest.rewards : {};
    for (const itemId of safeStrArr((rewards as Record<string, unknown>).items)) {
      if (!itemIds.has(itemId)) {
        violations.push(`quest "${String(quest.id)}".rewards.items references unknown item "${itemId}"`);
      }
    }
  }

  // Shop.items must reference known item ids
  for (const shop of rawPack.shops.filter(isObj)) {
    for (const itemId of safeStrArr(shop.items)) {
      if (!itemIds.has(itemId)) {
        violations.push(`shop "${String(shop.id)}".items references unknown item "${itemId}"`);
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Main exported validator
// ---------------------------------------------------------------------------

export function validatePack(raw: RawPack | Record<string, unknown>): ValidationResult {
  const violations: string[] = [];

  // 1. Manifest
  const manifestResult = ManifestSchema.safeParse(raw.manifest);
  if (!manifestResult.success) {
    violations.push(...manifestResult.error.issues.map(i => `manifest: ${i.path.join('.') || '<root>'}: ${i.message}`));
  }

  // 2. Arrays of entities (schema only)
  violations.push(...schemaViolations('npc', raw.npcs, NpcSchema));
  violations.push(...schemaViolations('quest', raw.quests, QuestSchema));
  violations.push(...schemaViolations('region', raw.regions, RegionSchema));
  violations.push(...schemaViolations('shop', raw.shops, ShopSchema));
  violations.push(...schemaViolations('item', raw.items, ItemSchema));

  // 3. Optional sections
  if (raw.economy !== undefined) {
    const eco = EconomySchema.safeParse(raw.economy);
    if (!eco.success) violations.push(...eco.error.issues.map(i => `economy: ${i.path.join('.') || '<root>'}: ${i.message}`));
  }
  if (raw.fishing !== undefined) {
    const fish = FishingSchema.safeParse(raw.fishing);
    if (!fish.success) {
      violations.push(...fish.error.issues.map(i => `fishing: ${i.path.join('.') || '<root>'}: ${i.message}`));
    } else if (raw.economy !== undefined) {
      const eco = EconomySchema.safeParse(raw.economy);
      if (eco.success) {
        const report = runFishingBalanceSimulation(fish.data, eco.data);
        violations.push(...report.violations);
      }
    }
  }

  // 4. Cross-reference checks (only when arrays parsed OK)
  if (!violations.some(v => v.startsWith('npc') || v.startsWith('quest') || v.startsWith('shop') || v.startsWith('item'))) {
    violations.push(
      ...referenceViolations({
        npcs: Array.isArray(raw.npcs) ? raw.npcs : [],
        quests: Array.isArray(raw.quests) ? raw.quests : [],
        shops: Array.isArray(raw.shops) ? raw.shops : [],
        items: Array.isArray(raw.items) ? raw.items : [],
      }),
    );
  }

  return { ok: violations.length === 0, violations };
}

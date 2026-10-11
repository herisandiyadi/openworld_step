/**
 * U1 Content Data Foundation – Zod schemas.
 *
 * These schemas are the single source of truth used by:
 *   • runtime registry / loader (web/src/content/)
 *   • CLI tools          (web/tools/content/)
 *   • multiplayer server  (server/ – re-imported at build time)
 *
 * All ids must be safe filesystem names (no path separators or whitespace).
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Alphanumeric + underscore/hyphen; no path characters. */
const SafeId = z
  .string()
  .min(1)
  .regex(/^[a-zA-Z0-9_-]+$/, 'id must contain only letters, digits, underscores, or hyphens');

/** A file path that must not traverse outside its package root. */
const SafePath = z
  .string()
  .min(1)
  .refine(
    (p) => !p.startsWith('/') && !p.includes('..'),
    'path must be relative and must not contain ".."',
  );

const PositiveNumber = z.number().positive();
const NonNegativeNumber = z.number().min(0);
const RadiusNumber = z.number().positive('radius must be > 0');

// ---------------------------------------------------------------------------
// Quest step variants
// ---------------------------------------------------------------------------

const TalkStep = z.object({
  type: z.literal('talk'),
  npc: SafeId,
  text: z.string().min(1),
});

const ReachStep = z.object({
  type: z.literal('reach'),
  x: z.number(),
  z: z.number(),
  radius: RadiusNumber,
  text: z.string().min(1),
});

const RideStep = z.object({
  type: z.literal('ride'),
  vehicle: z.string().min(1),
  text: z.string().min(1),
  destination: z
    .object({ x: z.number(), z: z.number(), radius: RadiusNumber })
    .optional(),
  timeLimitSeconds: z.number().positive().optional(),
});

const CollectStep = z.object({
  type: z.literal('collect'),
  item: SafeId,
  count: z.number().int().positive(),
  text: z.string().min(1),
});

const VisitDistrictStep = z.object({
  type: z.literal('visit_district'),
  region: SafeId,
  text: z.string().min(1),
});

const TimeStep = z.object({
  type: z.literal('time'),
  from: z.number().min(0).max(24),
  to: z.number().min(0).max(24),
  text: z.string().min(1),
});

const CatchStep = z.object({
  type: z.literal('catch'),
  species: SafeId.optional(),
  count: z.number().int().positive(),
  minWeight: z.number().positive().optional(),
  text: z.string().min(1),
});

const DisposeStep = z.object({
  type: z.literal('dispose'),
  count: z.number().int().positive(),
  text: z.string().min(1),
});

export const QuestStepSchema = z.discriminatedUnion('type', [
  TalkStep,
  ReachStep,
  RideStep,
  CollectStep,
  VisitDistrictStep,
  TimeStep,
  CatchStep,
  DisposeStep,
]);

export type QuestStep = z.infer<typeof QuestStepSchema>;

// ---------------------------------------------------------------------------
// NPC schedule entry
// ---------------------------------------------------------------------------

export const NpcScheduleEntrySchema = z.object({
  from: z.number().min(0).max(24),
  to: z.number().min(0).max(24),
  x: z.number(),
  z: z.number(),
});

// ---------------------------------------------------------------------------
// NpcDef
// ---------------------------------------------------------------------------

export const NpcSchema = z.object({
  id: SafeId,
  name: z.string().min(1),
  /** Visual asset identifier; only npc_vendor is in the base APK for U1. */
  asset: z.string().min(1),
  x: z.number(),
  z: z.number(),
  yaw: z.number(),
  region: SafeId,
  schedule: z.array(NpcScheduleEntrySchema).optional(),
  /** Path inside the content pack to the dialogue JSON. */
  dialogue: SafePath,
  questGiver: z.array(SafeId).default([]),
  retired: z.boolean().default(false),
});

export type NpcDef = z.infer<typeof NpcSchema>;

// ---------------------------------------------------------------------------
// Dialogue (per-NPC AI persona file)
// ---------------------------------------------------------------------------

export const DialogueSchema = z.object({
  npcId: SafeId,
  persona: z.string().min(1),
  /** Facts the NPC is allowed to mention (city, quest, shop context). */
  facts: z.array(z.string()).default([]),
  /** Static fallback lines when the AI is offline. */
  fallback: z.array(z.string().min(1)).min(1),
});

export type DialogueDef = z.infer<typeof DialogueSchema>;

// ---------------------------------------------------------------------------
// QuestDef
// ---------------------------------------------------------------------------

export const QuestSchema = z.object({
  id: SafeId,
  title: z.string().min(1),
  giver: SafeId,
  requires: z.array(SafeId).default([]),
  repeatable: z.boolean().default(false),
  steps: z.array(QuestStepSchema).min(1),
  rewards: z
    .object({
      coins: NonNegativeNumber.optional(),
      items: z.array(SafeId).default([]),
    })
    .default({}),
  retired: z.boolean().default(false),
});

export type QuestDef = z.infer<typeof QuestSchema>;

// ---------------------------------------------------------------------------
// RegionDef
// ---------------------------------------------------------------------------

export const RegionBoundsSchema = z.object({
  minX: z.number(),
  maxX: z.number(),
  minZ: z.number(),
  maxZ: z.number(),
});

export const RegionSchema = z.object({
  id: SafeId,
  name: z.string().min(1),
  bounds: RegionBoundsSchema,
  busStops: z
    .array(z.object({ id: SafeId, x: z.number(), z: z.number() }))
    .default([]),
  retired: z.boolean().default(false),
});

export type RegionDef = z.infer<typeof RegionSchema>;

// ---------------------------------------------------------------------------
// ItemDef
// ---------------------------------------------------------------------------

export const ItemSchema = z.object({
  id: SafeId,
  /** Broad category used by the shop UI. */
  category: z.enum([
    'vehicle',
    'vehicle_paint',
    'vehicle_upgrade',
    'clothing',
    'ticket',
    'tool',
    'fish',
    'trash',
  ]),
  name: z.string().min(1),
  price: NonNegativeNumber,
  appliesTo: z.string().optional(),
  asset: z.record(z.string(), z.unknown()).default({}),
  unlockAfter: SafeId.optional(),
  retired: z.boolean().default(false),
});

export type ItemDef = z.infer<typeof ItemSchema>;

// ---------------------------------------------------------------------------
// ShopDef
// ---------------------------------------------------------------------------

export const ShopSchema = z.object({
  id: SafeId,
  name: z.string().min(1),
  region: SafeId,
  x: z.number(),
  z: z.number(),
  npcId: SafeId.optional(),
  items: z.array(SafeId).min(1),
  /** Optional ISO date range for seasonal stock. */
  activeFrom: z.string().optional(),
  activeTo: z.string().optional(),
  retired: z.boolean().default(false),
});

export type ShopDef = z.infer<typeof ShopSchema>;

// ---------------------------------------------------------------------------
// EconomyDef
// ---------------------------------------------------------------------------

const JobDef = z.object({
  id: SafeId,
  title: z.string().min(1),
  rewardCoins: PositiveNumber,
  dailyLimit: z.number().int().positive(),
  stepTypes: z.array(z.string()).min(1),
});

export const EconomySchema = z.object({
  currency: z.string().min(1),
  dailyBonus: NonNegativeNumber,
  busFare: NonNegativeNumber,
  jobs: z.array(JobDef).default([]),
});

export type EconomyDef = z.infer<typeof EconomySchema>;

// ---------------------------------------------------------------------------
// ManifestDef
// ---------------------------------------------------------------------------

const ManifestFileEntry = z.object({
  path: SafePath,
  sha256: z
    .string()
    .length(64, 'sha256 must be exactly 64 hex characters')
    .regex(/^[0-9a-f]+$/, 'sha256 must be lowercase hex'),
  size: z.number().int().positive(),
});

const ManifestSignatureSchema = z.object({
  algorithm: z.literal('Ed25519'),
  keyId: SafeId,
  /** Base64-encoded 64-byte Ed25519 signature over canonical manifest JSON. */
  value: z.string().min(1),
});

export const ManifestSchema = z.object({
  id: SafeId,
  version: z.string().min(1),
  minAppVersion: z.string().min(1),
  worldVersion: z.number().int().positive(),
  /** Ordered list of all data files in this pack. */
  files: z.array(ManifestFileEntry).min(1),
  /** Bundled packs may be unsigned; downloaded packs must be signed before activation. */
  signature: ManifestSignatureSchema.optional(),
});

export type ManifestDef = z.infer<typeof ManifestSchema>;

// ---------------------------------------------------------------------------
// FishingDef
// ---------------------------------------------------------------------------

/** One entry in the loot table (fish OR trash). The 'catches' array must sum to 1.0. */
const CatchEntrySchema = z.object({
  id: SafeId,
  kind: z.enum(['fish', 'trash']),
  chance: z.number().positive().max(1),
});

const FishSpeciesSchema = z.object({
  id: SafeId,
  name: z.string().min(1),
  chance: z.number().positive().max(1),
  minWeight: PositiveNumber,
  maxWeight: PositiveNumber,
  pricePerKg: PositiveNumber,
  /** 1 = easy (mujair), 3 = hard (patin). Controls mini-game difficulty. */
  difficulty: z.number().int().min(1).max(5),
});

/** Validate that an array of {chance} entries sums to 1.0 (±1e-6 tolerance). */
function sumsToOne(items: { chance: number }[], ctx: z.RefinementCtx, label: string): void {
  const total = items.reduce((acc, i) => acc + i.chance, 0);
  if (Math.abs(total - 1) > 1e-6) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${label} chances must sum to 1, got ${total.toFixed(6)}`,
    });
  }
}

const PeakHourSchema = z.object({
  from: z.number().min(0).max(24),
  to: z.number().min(0).max(24),
  fishChanceBonus: z.number(),
});

export const FishingSchema = z
  .object({
    biteWaitSeconds: z.object({ min: PositiveNumber, max: PositiveNumber }),
    hookWindowSeconds: PositiveNumber,
    catches: z.array(CatchEntrySchema).min(1),
    baitedCatches: z.array(CatchEntrySchema).min(1),
    species: z.array(FishSpeciesSchema).min(1),
    peakHours: z.array(PeakHourSchema).default([]),
    antiFarming: z.object({
      catchesBeforePenalty: z.number().int().positive(),
      fishChancePenalty: z.number().min(0).max(1),
    }),
    market: z.object({
      fullPriceSalesPerSpecies: z.number().int().positive(),
      discountPerExtraSale: z.number().positive(),
      minimumMultiplier: z.number().positive().max(1),
    }),
    bag: z.object({
      capacities: z.array(z.number().int().positive()).min(1),
      trashStackSize: z.number().int().positive(),
    }),
    disposal: z.object({
      coinsPerTrash: NonNegativeNumber,
      dailyCoinLimit: NonNegativeNumber,
    }),
  })
  .superRefine((data, ctx) => {
    sumsToOne(data.catches, ctx, 'catches');
    sumsToOne(data.baitedCatches, ctx, 'baitedCatches');
    sumsToOne(data.species, ctx, 'species');
  });

export type FishingDef = z.infer<typeof FishingSchema>;

// ---------------------------------------------------------------------------
// Bundle of every schema in one import for tools / CLI
// ---------------------------------------------------------------------------

export const ContentSchemas = {
  NpcSchema,
  QuestSchema,
  RegionSchema,
  ShopSchema,
  ItemSchema,
  EconomySchema,
  FishingSchema,
  ManifestSchema,
  DialogueSchema,
} as const;

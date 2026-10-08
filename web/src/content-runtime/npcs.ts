import type { Vec2 } from '../game/movement';

export interface NpcScheduleEntry {
  from: number;
  to: number;
  x: number;
  z: number;
}

export interface RuntimeNpc {
  id: string;
  name: string;
  asset: string;
  x: number;
  z: number;
  yaw: number;
  region?: string;
  schedule?: readonly NpcScheduleEntry[];
  dialogue?: string;
  questGiver?: readonly string[];
  retired?: boolean;
}

export interface NpcQuestCandidate {
  questId: string;
  status: 'locked' | 'available' | 'active' | 'completed';
}

export interface ActiveQuestSummaryItem {
  title: string;
  status: 'locked' | 'available' | 'active' | 'completed';
  stepText?: string;
}

const normalizeHour = (hour: number): number => ((hour % 24) + 24) % 24;

const inRange = (hour: number, from: number, to: number): boolean => {
  const h = normalizeHour(hour);
  const start = normalizeHour(from);
  const end = normalizeHour(to);
  if (start === end) return true;
  return start < end ? h >= start && h < end : h >= start || h < end;
};

export function scheduleEntryAt(
  schedule: readonly NpcScheduleEntry[] | undefined,
  hour: number,
): NpcScheduleEntry | null {
  if (!schedule || schedule.length === 0) return null;
  for (const entry of schedule) {
    if (inRange(hour, entry.from, entry.to)) return entry;
  }
  return null;
}

export function npcScheduleState(
  npc: RuntimeNpc,
  hour: number,
): { active: boolean; target: Vec2 | null } {
  if (npc.retired) return { active: false, target: null };
  if (!npc.schedule || npc.schedule.length === 0) {
    return { active: true, target: { x: npc.x, z: npc.z } };
  }
  const entry = scheduleEntryAt(npc.schedule, hour);
  if (!entry) return { active: false, target: null };
  return { active: true, target: { x: entry.x, z: entry.z } };
}

export function activeNpcsAt<T extends RuntimeNpc>(npcs: readonly T[], hour: number): T[] {
  return npcs.filter((npc) => npcScheduleState(npc, hour).active);
}

export function npcNavTarget(
  npc: RuntimeNpc,
  hour: number,
  current: Vec2,
  findPath?: (from: Vec2, to: Vec2) => Vec2[] | null,
): Vec2 | null {
  const { active, target } = npcScheduleState(npc, hour);
  if (!active || !target) return null;
  const path = findPath ? findPath(current, target) : null;
  return path && path.length > 0 ? path[0]! : target;
}

export function npcQuestMarker(
  npc: RuntimeNpc,
  quests: readonly NpcQuestCandidate[],
): '!' | '?' | null {
  const gives = new Set(npc.questGiver ?? []);
  if (gives.size === 0) return null;

  let hasAvailable = false;
  for (const candidate of quests) {
    if (!gives.has(candidate.questId)) continue;
    if (candidate.status === 'active') return '?';
    if (candidate.status === 'available') hasAvailable = true;
  }
  return hasAvailable ? '!' : null;
}

export function summarizeQuestContext(
  items: readonly ActiveQuestSummaryItem[],
  maxChars = 300,
): string {
  const active = items.filter((item) => item.status === 'active');
  if (active.length === 0 || maxChars <= 0) return '';

  const parts = active.map((item) => (item.stepText ? `${item.title}: ${item.stepText}` : item.title));
  const full = `Quest aktif: ${parts.join(' | ')}`;
  if (full.length <= maxChars) return full;
  if (maxChars <= 1) return full.slice(0, maxChars);
  return `${full.slice(0, maxChars - 1).trimEnd()}…`;
}

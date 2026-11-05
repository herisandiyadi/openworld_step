import { describe, expect, it } from 'vitest';
import { validatePack, type ValidationResult } from '../../tools/content/validate';

const validManifest = {
  id: 'base', version: '1.0.0', minAppVersion: '0.1.0', worldVersion: 2,
  files: [{ path: 'npcs.json', sha256: 'a'.repeat(64), size: 10 }],
};
const validEconomy = { currency: 'coins', dailyBonus: 20, busFare: 5, jobs: [] };
function makeNpc(id: string, questGiver: string[] = []) {
  return { id, name: id, asset: 'npc_vendor', x: 0, z: 0, yaw: 0, region: 'downtown', dialogue: `dialogue/${id}.json`, questGiver };
}
function makeQuest(id: string, giverId: string, requires: string[] = []) {
  return {
    id, title: id, giver: giverId, requires, repeatable: false,
    steps: [{ type: 'talk', npc: giverId, text: 'hi' }], rewards: { coins: 10, items: [] },
  };
}
const validPack = {
  manifest: validManifest, npcs: [makeNpc('npc_budi', ['q_kenalan'])],
  quests: [makeQuest('q_kenalan', 'npc_budi')],
  regions: [{ id: 'downtown', name: 'Pusat Kota', bounds: { minX: -128, maxX: 128, minZ: -128, maxZ: 128 } }],
  shops: [], items: [], economy: validEconomy,
};

describe('validatePack', () => {
  it('returns no violations for a fully valid pack', () => {
    const result: ValidationResult = validatePack(validPack);
    expect(result.violations).toHaveLength(0);
    expect(result.ok).toBe(true);
  });
  it('reports a schema violation for a malformed NPC id', () => {
    const result = validatePack({ ...validPack, npcs: [{ id: '../bad', name: 'Bad', asset: 'npc_vendor', x: 0, z: 0, yaw: 0, region: 'downtown', dialogue: 'bad.json', questGiver: [] }] });
    expect(result.ok).toBe(false);
    expect(result.violations.some(v => /npc/i.test(v))).toBe(true);
  });
  it('reports a dangling questGiver reference', () => {
    const result = validatePack({ ...validPack, npcs: [makeNpc('npc_budi', ['q_does_not_exist'])] });
    expect(result.ok).toBe(false);
    expect(result.violations.some(v => /q_does_not_exist/.test(v))).toBe(true);
  });
  it('reports a dangling quest.requires reference', () => {
    const result = validatePack({ ...validPack, quests: [{ ...makeQuest('q_kenalan', 'npc_budi'), requires: ['q_missing'] }] });
    expect(result.ok).toBe(false);
    expect(result.violations.some(v => /q_missing/.test(v))).toBe(true);
  });
  it('reports a dangling quest giver', () => {
    const result = validatePack({ ...validPack, quests: [makeQuest('q_kenalan', 'npc_ghost')] });
    expect(result.ok).toBe(false);
    expect(result.violations.some(v => /npc_ghost/.test(v))).toBe(true);
  });
  it('reports a shop that lists an item not in items.json', () => {
    const result = validatePack({ ...validPack, shops: [{ id: 'shop_a', name: 'Shop A', region: 'downtown', x: 0, z: 0, items: ['item_nonexistent'] }] });
    expect(result.ok).toBe(false);
    expect(result.violations.some(v => /item_nonexistent/.test(v))).toBe(true);
  });
  it('reports a quest reward item not in items.json', () => {
    const result = validatePack({ ...validPack, quests: [{ ...makeQuest('q_kenalan', 'npc_budi'), rewards: { coins: 10, items: ['missing_item'] } }] });
    expect(result.ok).toBe(false);
    expect(result.violations.some(v => /missing_item/.test(v))).toBe(true);
  });
  it('collects all violations, not just the first', () => {
    const result = validatePack({ ...validPack, quests: [{ ...makeQuest('q_kenalan', 'npc_budi'), requires: ['q_a'] }, { ...makeQuest('q_another', 'npc_ghost'), requires: ['q_b'] }] });
    expect(result.violations.length).toBeGreaterThan(1);
  });
});

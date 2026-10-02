import { describe, expect, it } from 'vitest';
import { buildMessages, extractReply, HISTORY_TURNS, type ChatMessage } from './chat';

describe('npc chat', () => {
  it('puts the persona first and keeps only the recent turns', () => {
    const history: ChatMessage[] = Array.from({ length: 30 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user',
      content: `m${index}`,
    }));
    const messages = buildMessages('npc_budi', 'Pak Budi', history);
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toContain('Pak Budi');
    expect(messages).toHaveLength(HISTORY_TURNS * 2 + 1);
    expect(messages.at(-1)?.content).toBe('m29');
  });

  it('tells the NPC the player name', () => {
    const [system] = buildMessages('npc_sari', 'Bu Sari', [], 'Andi');
    expect(system?.content).toContain('"Andi"');
    expect(system?.content).toContain('Mas Andi');
    expect(buildMessages('npc_sari', 'Bu Sari', [])[0]?.content).not.toContain('Pemain yang');
  });

  it('memakai sapaan Mas/Mbak dan ringkasan penampilan', () => {
    const look = { gender: 'm', hairColor: 0, expression: 0, shirtColor: 1, shirtStyle: 1, pantsColor: 0, pantsStyle: 0 } as const;
    const male = buildMessages('npc_budi', 'Pak Budi', [], 'Andi', look)[0]?.content;
    expect(male).toContain('Mas Andi');
    expect(male).toContain('hoodie merah');
    const female = buildMessages('npc_budi', 'Pak Budi', [], 'Sari', { ...look, gender: 'f', shirtStyle: 0, shirtColor: 2 })[0]?.content;
    expect(female).toContain('Mbak Sari');
    expect(female).not.toContain('Mas Sari');
    expect(female).toContain('kaos hijau');
  });

  it('extracts content and strips think blocks', () => {
    expect(extractReply({ choices: [{ message: { content: '<think>x</think> Halo!' } }] })).toBe('Halo!');
    expect(extractReply({})).toBe('');
  });
});
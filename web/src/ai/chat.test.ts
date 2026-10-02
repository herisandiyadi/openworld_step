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

  it('extracts content and strips think blocks', () => {
    expect(extractReply({ choices: [{ message: { content: '<think>x</think> Halo!' } }] })).toBe('Halo!');
    expect(extractReply({})).toBe('');
  });
});
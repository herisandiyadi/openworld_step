import { describe, expect, it } from 'vitest';
import { SseChatParser, visibleText } from './sse';

const delta = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n`;

describe('SseChatParser', () => {
  it('joins content deltas across arbitrary chunk boundaries and ignores reasoning', () => {
    const stream =
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'hmm' } }] })}\n` + delta('Halo') + delta(', apa kabar?') + 'data: [DONE]\n';
    const parser = new SseChatParser();
    let text = '';
    for (let index = 0; index < stream.length; index += 7) text += parser.push(stream.slice(index, index + 7));
    text += parser.end();
    expect(text).toBe('Halo, apa kabar?');
    expect(parser.done).toBe(true);
  });

  it('skips comments and malformed lines', () => {
    const parser = new SseChatParser();
    expect(parser.push(': ping\ndata: {oops\n' + delta('ok'))).toBe('ok');
  });
});

describe('visibleText', () => {
  it('hides complete and still-open think blocks', () => {
    expect(visibleText('<think>a</think>Halo')).toBe('Halo');
    expect(visibleText('Hai <think>masih')).toBe('Hai ');
  });
});
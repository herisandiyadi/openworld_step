/** Incremental parser for OpenAI-compatible SSE chat streams. Only `content` deltas are surfaced. */
export class SseChatParser {
  private buffer = '';
  done = false;

  /** Feeds raw text (any chunking); returns the content text found in complete lines. */
  push(text: string): string {
    this.buffer += text;
    let out = '';
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      out += this.line(this.buffer.slice(0, newline));
      this.buffer = this.buffer.slice(newline + 1);
      newline = this.buffer.indexOf('\n');
    }
    return out;
  }

  /** Flushes a trailing line without newline. */
  end(): string {
    const rest = this.buffer;
    this.buffer = '';
    return rest ? this.line(rest) : '';
  }

  line(raw: string): string {
    const line = raw.trim();
    if (!line.startsWith('data:')) return '';
    const data = line.slice(5).trim();
    if (data === '[DONE]') {
      this.done = true;
      return '';
    }
    try {
      const json = JSON.parse(data) as { choices?: { delta?: { content?: unknown } }[] };
      const content = json.choices?.[0]?.delta?.content;
      return typeof content === 'string' ? content : '';
    } catch {
      return '';
    }
  }
}

/** Hides <think>...</think> reasoning (also an unterminated block still streaming in). */
export function visibleText(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/, '')
    .trimStart();
}
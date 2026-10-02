import { Capacitor, type PluginListenerHandle, registerPlugin } from '@capacitor/core';
import { type AiSettings, normalizeSettings } from '../state/aiSettings';
import { SseChatParser, visibleText } from './sse';
import { appearanceSummary } from '../game/HeroAppearance';
import type { Appearance } from '../state/profile';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Per-NPC persona; keeps answers in the city context. */
export const NPC_PERSONAS: Record<string, string> = {
  npc_budi:
    'Kamu adalah Pak Budi, pedagang kaki lima ramah di dekat titik awal di Pusat Kota Openworld City. Kamu suka menyarankan pendatang baru mencoba sepeda yang terparkir di dekat situ.',
  npc_rina:
    'Kamu adalah Mbak Rina, pegawai kantoran di Pusat Kota Openworld City. Kamu tahu gedung-gedung tinggi, plaza, dan halte bus di pusat kota.',
  npc_sari:
    'Kamu adalah Bu Sari, warga lama kawasan Perumahan di barat laut Openworld City. Kamu tahu suasana perumahan, taman, dan tetangga.',
  npc_dewi:
    'Kamu adalah Bu Dewi, guru SD yang tinggal di kawasan Perumahan barat daya Openworld City. Kamu sabar dan suka bercerita tentang taman dan anak-anak yang bermain skateboard.',
  npc_joko:
    'Kamu adalah Mas Joko, pekerja gudang di Kawasan Industri sisi timur Openworld City. Kamu tahu soal gudang, truk, dan rute motor tercepat ke Pusat Kota.',
};

const WORLD_FACTS =
  'Fakta kota: ada tiga kawasan (Pusat Kota di tengah, Perumahan di sisi barat/utara/selatan, Kawasan Industri di sisi timur). Pemain bisa jalan kaki, naik skateboard, sepeda, motor, dan mobil yang terparkir, serta naik bus dari halte untuk berpindah cepat. Tidak ada musuh.';
const RULES =
  'Jawab dalam bahasa Indonesia, singkat (maksimal 3 kalimat), tetap sebagai karakter. Hanya bahas hal seputar kota dan kehidupan sehari-hari di dalam game. Jika ditanya di luar konteks, arahkan kembali dengan sopan.';

/** Last N turns sent to the model to keep requests small. */
export const HISTORY_TURNS = 10;

/**
 * The username is validated (letters, digits, space . _ -; max 20) before it is stored, so it cannot
 * carry quotes or instructions into the system prompt. Sapaan ikut gender profil (NEXT_FEATURES 9.5),
 * dan penampilan diringkas dari id opsi (bukan teks bebas pemain).
 */
function playerLine(playerName: string | undefined, appearance?: Appearance): string {
  if (!playerName) return '';
  const greeting = appearance?.gender === 'f' ? 'Mbak' : 'Mas';
  const look = appearance ? ` Dia memakai ${appearanceSummary(appearance)}.` : '';
  return `Pemain yang sedang berbicara denganmu bernama "${playerName}". Panggil dia "${greeting} ${playerName}", terutama saat menyapa.${look}`;
}

export function buildMessages(
  npcId: string,
  npcName: string,
  history: readonly ChatMessage[],
  playerName?: string,
  appearance?: Appearance,
): ChatMessage[] {
  const persona = NPC_PERSONAS[npcId] ?? `Kamu adalah ${npcName}, warga Openworld City.`;
  const system = [persona, WORLD_FACTS, playerLine(playerName, appearance), RULES].filter(Boolean).join(' ');
  return [{ role: 'system', content: system }, ...history.slice(-HISTORY_TURNS * 2)];
}

/** Reads the assistant text out of a non-streamed OpenAI-compatible chat completion response. */
export function extractReply(body: unknown): string {
  const choice = (body as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0];
  const content = choice?.message?.content;
  return typeof content === 'string' ? visibleText(content).trim() : '';
}

function httpError(status: number): Error {
  if (status === 401 || status === 403) return new Error(`Ditolak server (${status}). Cek API key di Pengaturan.`);
  if (status === 0) return new Error('Tidak bisa terhubung ke server AI. Cek Base URL dan jaringan.');
  return new Error(`Server AI membalas HTTP ${status}.`);
}

interface StreamEvent {
  id: string;
  line?: string;
  status?: number;
  message?: string;
}

interface AiStreamPlugin {
  start(options: { id: string; url: string; headers: Record<string, string>; body: string }): Promise<void>;
  cancel(options: { id: string }): Promise<void>;
  addListener(eventName: 'line' | 'done' | 'error', listener: (event: StreamEvent) => void): Promise<PluginListenerHandle>;
}

/** Native SSE reader (android/.../AiStreamPlugin.java). */
const AiStream = registerPlugin<AiStreamPlugin>('AiStream');

interface Request {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** Collects streamed content; falls back to a plain JSON body if the server ignored `stream: true`. */
class ReplyCollector {
  private parser = new SseChatParser();
  private raw = '';
  private lines: string[] = [];

  constructor(private onText: (text: string) => void) {}

  line(line: string): void {
    this.lines.push(line);
    const delta = this.parser.line(line);
    if (!delta) return;
    this.raw += delta;
    this.onText(visibleText(this.raw));
  }

  finish(): string {
    const text = visibleText(this.raw).trim();
    if (text) return text;
    try {
      return extractReply(JSON.parse(this.lines.join('\n')));
    } catch {
      return '';
    }
  }
}

function streamNative(request: Request, collector: ReplyCollector, signal?: AbortSignal): Promise<string> {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve, reject) => {
    const handles: Promise<PluginListenerHandle>[] = [];
    let settled = false;
    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      for (const handle of handles) void handle.then((item) => item.remove());
      action();
    };
    handles.push(AiStream.addListener('line', (event) => event.id === id && collector.line(event.line ?? '')));
    handles.push(AiStream.addListener('done', (event) => event.id === id && settle(() => resolve(collector.finish()))));
    handles.push(
      AiStream.addListener('error', (event) => {
        if (event.id !== id) return;
        settle(() => reject(httpError(event.status ?? 0)));
      }),
    );
    signal?.addEventListener('abort', () => {
      void AiStream.cancel({ id });
      settle(() => reject(new DOMException('Dibatalkan', 'AbortError')));
    });
    Promise.all(handles)
      .then(() => AiStream.start({ id, ...request }))
      .catch((error: unknown) => settle(() => reject(error instanceof Error ? error : new Error(String(error)))));
  });
}

async function streamFetch(request: Request, collector: ReplyCollector, signal?: AbortSignal): Promise<string> {
  let response: Response;
  try {
    response = await fetch(request.url, { method: 'POST', headers: request.headers, body: request.body, signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw httpError(0);
  }
  if (!response.ok) throw httpError(response.status);
  const reader = response.body?.getReader();
  if (!reader) return collector.finish();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      collector.line(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
    }
  }
  if (buffer) collector.line(buffer);
  return collector.finish();
}

/**
 * POST {baseUrl}/chat/completions with `stream: true` and reports the visible reply as it grows.
 * Android uses the native AiStream plugin (no CORS preflight, plain HTTP allowed); the browser uses fetch.
 */
export async function streamChat(
  settings: AiSettings,
  messages: ChatMessage[],
  onText: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const clean = normalizeSettings(settings);
  if (!clean.apiKey) throw new Error('API key belum diisi. Buka Pengaturan dari menu utama.');
  const request: Request = {
    url: `${clean.baseUrl}/chat/completions`,
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${clean.apiKey}` },
    body: JSON.stringify({ model: clean.model, messages, stream: true, temperature: 0.7, max_tokens: 400 }),
  };
  const collector = new ReplyCollector(onText);
  const reply = Capacitor.isNativePlatform()
    ? await streamNative(request, collector, signal)
    : await streamFetch(request, collector, signal);
  if (!reply) throw new Error('Balasan kosong dari server AI.');
  return reply;
}
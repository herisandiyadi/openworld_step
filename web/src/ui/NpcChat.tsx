import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { buildMessages, type ChatMessage, streamChat } from '../ai/chat';
import { useAiSettings } from '../state/aiSettings';
import { usePlayerProfile } from '../state/profile';
import { useGameStore } from '../state/gameStore';
import { worldState } from '../world/worldState';
import { audio } from '../audio/audioEngine';

const MAX_INPUT = 500;
/** Conversation per NPC survives closing the panel for the rest of the session. */
const histories = new Map<string, ChatMessage[]>();

/** Free-text Q&A with the NPC next to the player; replies stream in. The game loop is paused while open. */
export function NpcChat() {
  const npcId = useGameStore((state) => state.chatNpcId);
  const setChatNpcId = useGameStore((state) => state.setChatNpcId);
  const addMet = useGameStore((state) => state.addMet);
  const settings = useAiSettings((state) => state.settings);
  const username = usePlayerProfile((state) => state.profile?.username);
  const appearance = usePlayerProfile((state) => state.profile?.appearance);
  const npc = worldState.index?.npcs.find((item) => item.id === npcId);
  const [messages, setMessages] = useState<ChatMessage[]>(() => (npcId ? (histories.get(npcId) ?? []) : []));
  const [partial, setPartial] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputId = useId();
  const busy = partial !== null;

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, partial, error]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setChatNpcId(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      abortRef.current?.abort();
    };
  }, [setChatNpcId]);

  if (!npcId || !npc) return null;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const question = text.trim().slice(0, MAX_INPUT);
    if (!question || busy) return;
    const next: ChatMessage[] = [...messages, { role: 'user', content: question }];
    setMessages(next);
    histories.set(npcId, next);
    setText('');
    setError(null);
    setPartial('');
    audio.send();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const reply = await streamChat(settings, buildMessages(npcId, npc.name, next, username, appearance), setPartial, controller.signal);
      const withReply: ChatMessage[] = [...next, { role: 'assistant', content: reply }];
      histories.set(npcId, withReply);
      setMessages(withReply);
      audio.message();
      addMet(npcId);
    } catch (chatError) {
      if (controller.signal.aborted) return;
      setError(chatError instanceof Error ? chatError.message : String(chatError));
    } finally {
      if (!controller.signal.aborted) {
        setPartial(null);
        inputRef.current?.focus();
      }
    }
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby={`${inputId}-title`}>
      <div className="chat-panel">
        <div className="chat-header">
          <h2 id={`${inputId}-title`}>{npc.name}</h2>
          <button type="button" className="overlay-button secondary" onClick={() => setChatNpcId(null)}>
            Tutup
          </button>
        </div>
        <div ref={logRef} className="chat-log" aria-live="polite">
          {messages.length === 0 && (
            <p className="chat-hint">
              {username ? `Halo, Kak ${username}! ` : ''}Tanyakan apa saja seputar kota ke {npc.name}.
            </p>
          )}
          {messages.map((message, index) => (
            <p key={index} className={`chat-bubble ${message.role}`}>
              {message.content}
            </p>
          ))}
          {busy && <p className={`chat-bubble assistant${partial ? '' : ' pending'}`}>{partial || `${npc.name} sedang berpikir...`}</p>}
          {error && (
            <p className="chat-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <form className="chat-form" onSubmit={onSubmit}>
          <label className="visually-hidden" htmlFor={inputId}>
            Pertanyaan untuk {npc.name}
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            autoComplete="off"
            maxLength={MAX_INPUT}
            placeholder="Ketik pertanyaan..."
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={busy}
          />
          <button type="submit" className="overlay-button" disabled={busy || !text.trim()}>
            Kirim
          </button>
        </form>
      </div>
    </div>
  );
}
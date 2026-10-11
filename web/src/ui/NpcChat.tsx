import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { buildMessages, type ChatMessage, lookOf, streamChat, withHistory } from '../ai/chat';
import { holdResident, RESIDENTS } from '../ambient/PedestrianLayer';
import { residentSystemPrompt } from '../ambient/residents';
import { dayClock } from '../game/runtime';
import { recordResidentChat, residentHistory } from '../state/saveGame';
import { useAiSettings } from '../state/aiSettings';
import { usePlayerProfile } from '../state/profile';
import { useGameStore } from '../state/gameStore';
import { worldState } from '../world/worldState';
import { audio } from '../audio/audioEngine';
import { routeQuestEvent } from '../game/questRuntime';

const MAX_INPUT = 500;
/** Conversation per named NPC survives closing the panel for the rest of the session (warga: di save game). */
const histories = new Map<string, ChatMessage[]>();

/** Free-text Q&A with the NPC next to the player; replies stream in. The game loop is paused while open. */
export function NpcChat() {
  const npcId = useGameStore((state) => state.chatNpcId);
  const setChatNpcId = useGameStore((state) => state.setChatNpcId);
  const addMet = useGameStore((state) => state.addMet);
  const settings = useAiSettings((state) => state.settings);
  const username = usePlayerProfile((state) => state.profile?.username);
  const appearance = usePlayerProfile((state) => state.profile?.appearance);
  const resident = RESIDENTS.find((item) => item.id === npcId);
  const npc = worldState.index?.npcs.find((item) => item.id === npcId) ?? resident;
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    npcId ? (resident ? residentHistory(npcId) : (histories.get(npcId) ?? [])) : [],
  );
  const [partial, setPartial] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputId = useId();
  const busy = partial !== null;

  useEffect(() => inputRef.current?.focus(), []);
  // Warga berhenti, menghadap pemain, dan tidak di-despawn selama panel terbuka.
  useEffect(() => {
    if (!resident) return;
    holdResident(resident.id, true);
    return () => holdResident(resident.id, false);
  }, [resident]);
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
    if (resident) recordResidentChat(npcId, next);
    else histories.set(npcId, next);
    setText('');
    setError(null);
    setPartial('');
    audio.send();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const prompt = resident
        ? withHistory(residentSystemPrompt(resident, dayClock.t, username, appearance?.gender, lookOf(appearance)), next)
        : buildMessages(npcId, npc.name, next, username, appearance);
      const reply = await streamChat(settings, prompt, setPartial, controller.signal);
      const withReply: ChatMessage[] = [...next, { role: 'assistant', content: reply }];
      setMessages(withReply);
      audio.message();
      // Quest "kenalan" hanya untuk 5 NPC bernama; warga masuk statistik "diajak ngobrol".
      if (resident) {
        recordResidentChat(npcId, withReply);
        // Event talk masuk quest engine (content pack) — warga ambient tetap hanya statistik.
      } else {
        histories.set(npcId, withReply);
        addMet(npcId);
        routeQuestEvent({ type: 'talk', npc: npcId });
      }
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
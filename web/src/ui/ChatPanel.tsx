/**
 * Panel chat antar pemain (MULTIPLAYER.md 5.1): kanal sesi dan dekat, riwayat 50 pesan,
 * pembisuan per pemain, batas 200 karakter per pesan.
 */

import { useEffect, useRef, useState } from 'react';
import { useNetStore } from '../net/netStore';
import { currentMode, sendChat } from '../net/netRuntime';
import type { ChatChannel, PlayerId } from '../net/protocol';
import { CHANNEL_LABELS, MAX_CHAT_INPUT, senderName, trimChatInput, visibleMessages } from './chatLogic';
import './chat.css';

export function ChatPanel(props: { onClose: () => void }) {
  const localId = useNetStore((state) => state.playerId);
  const remotes = useNetStore((state) => state.remotes);
  const chat = useNetStore((state) => state.chat);
  const muted = useNetStore((state) => state.muted);
  const [channel, setChannel] = useState<ChatChannel>('session');
  const [text, setText] = useState('');
  const [notice, setNotice] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const mode = currentMode();
  const connected = mode !== null;
  const filtered = visibleMessages(chat[channel], muted);

  // Auto-scroll ke bawah ketika pesan baru masuk.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [filtered.length]);

  // Fokus input setelah mount.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Membuka panel/kanal berarti pesannya sudah dibaca.
  useEffect(() => {
    useNetStore.getState().clearUnread(channel);
  }, [channel, chat]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setNotice('');
    const trimmed = trimChatInput(text);
    if (!trimmed || !connected) return;
    const ok = sendChat(channel, trimmed);
    if (ok) setText('');
    else setNotice('Gagal mengirim. Coba lagi.');
  };

  const toggleMute = (targetId: PlayerId): void => useNetStore.getState().toggleMute(targetId);

  return (
    <div className="player-chat">
      <div className="player-chat-header">
        <h2>Chat</h2>
        <div className="player-chat-tabs" role="tablist">
          <button
            type="button"
            className="player-chat-tab"
            role="tab"
            aria-selected={channel === 'session'}
            onClick={() => setChannel('session')}
          >
            {CHANNEL_LABELS.session}
          </button>
          <button
            type="button"
            className="player-chat-tab"
            role="tab"
            aria-selected={channel === 'nearby'}
            onClick={() => setChannel('nearby')}
          >
            {CHANNEL_LABELS.nearby}
          </button>
        </div>
        <button type="button" className="icon-button" onClick={props.onClose} aria-label="Tutup">
          ✕
        </button>
      </div>

      <div ref={logRef} className="player-chat-log">
        {filtered.length === 0 && <p className="player-chat-empty">Belum ada pesan.</p>}
        {filtered.map((entry) => {
          const name = senderName(entry.fromId, localId, remotes);
          const isSelf = localId !== null && entry.fromId === localId;
          const isMuted = muted.includes(entry.fromId);
          return (
            <div key={entry.id} className="player-chat-row">
              <span className={isSelf ? 'player-chat-name self' : 'player-chat-name'}>{name}:</span>
              <span className="player-chat-text">{entry.text}</span>
              {!isSelf && (
                <button
                  type="button"
                  className="player-chat-mute"
                  onClick={() => toggleMute(entry.fromId)}
                  aria-label={isMuted ? 'Buka bisuan' : 'Bisukan'}
                >
                  {isMuted ? '🔊' : '🔇'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {notice && <p className="player-chat-notice">{notice}</p>}

      <form className="player-chat-form" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          placeholder={connected ? 'Tulis pesan...' : 'Tidak tersambung'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MAX_CHAT_INPUT}
          disabled={!connected}
        />
        <button type="submit" disabled={!connected || !trimChatInput(text)}>
          Kirim
        </button>
      </form>
    </div>
  );
}

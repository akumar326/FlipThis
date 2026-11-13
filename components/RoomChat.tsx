'use client';
import { useEffect, useRef, useState } from 'react';
import { SLOT_BY_ID, PHASE_LABELS } from '@/lib/config';
import { CHAT_HISTORY_LIMIT, CHAT_MAX_LENGTH, chatIsOpen, chatMessages, crewFor, type ChatAuthor } from '@/lib/chat';
import type { RoomStore } from '@/lib/store';
import type { RoomState } from '@/lib/types';

export function RoomChat({ room, store, author, crew = false }: { room: RoomState; store: RoomStore; author: ChatAuthor; crew?: boolean }) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const atBottom = useRef(true);
  const busy = useRef(false);
  const members = crew ? crewFor(room, author) : undefined;
  const crewId = members?.join('-');
  const prefix = crew ? 'crew' : 'room';
  const open = crew ? !!crewId : chatIsOpen(room.phase);
  const channel = crewId ? room.crewChats?.[crewId] : undefined;
  const messages = crew ? Object.values(channel?.chat || {}).sort((a, b) => a.sequence - b.sequence) : chatMessages(room);

  useEffect(() => {
    if (open && atBottom.current && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [open, room.chatSequence, channel?.chatSequence]);

  if (!open) return null;

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (busy.current || !draft.trim()) return;
    busy.current = true; setSending(true); setError('');
    try {
      await store.sendChat(author, draft, room.battle?.id || 'legacy', crewId);
      setDraft('');
      atBottom.current = true; setAwayFromBottom(false);
      if (log.current) log.current.scrollTop = log.current.scrollHeight;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Message could not be sent. Please try again.');
    } finally {
      busy.current = false; setSending(false);
      requestAnimationFrame(() => input.current?.focus());
    }
  }

  return <section className="panel room-chat" aria-labelledby={`${prefix}-chat-title`}>
    <div className="panel-head">
      <h2 id={`${prefix}-chat-title`}>{crew ? 'Your crew chat' : room.phase === 'lobby' ? 'Meet the room' : 'Talk about the flips'}</h2>
      <span className="chip-mono">{crew ? 'CREW CHAT' : 'GLOBAL CHAT'}</span>
    </div>
    <p className="hint">{crew ? `Only your crew can read this conversation: ${members!.map(id => room.players[id]?.name).join(", ")}.` : "Everyone in this battle can read and join in. Chat opens in the lobby and reopens at reveal."}</p>
    <div ref={log} className="chat-log" hidden={!messages.length} role="log" aria-label={crew ? "Crew conversation" : "Room conversation"} aria-live="polite" aria-relevant="additions text" tabIndex={0}
      onScroll={() => {
        const element = log.current;
        if (!element) return;
        atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
        setAwayFromBottom(!atBottom.current);
      }}>
      {messages.map(message => <article key={message.id} className="chat-message" data-mine={message.author === author}>
        <div className="row chat-message-head">
          <span className="dot" style={{ background: message.author === 'host' ? 'var(--ink)' : SLOT_BY_ID[message.author].color }} />
          <strong>{message.name}</strong>
          {message.bot && <span className="hint">demo bot</span>}
          {message.author === author && <span className="hint">you</span>}
          <span className="hint">{PHASE_LABELS[message.phase]}</span>
        </div>
        <p className="feedback-text">{message.text}</p>
      </article>)}
    </div>
    {awayFromBottom && <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
      atBottom.current = true; setAwayFromBottom(false);
      if (log.current) log.current.scrollTop = log.current.scrollHeight;
    }}>Jump to latest messages</button>}
    {messages.length >= CHAT_HISTORY_LIMIT && <p className="hint">Showing the latest {CHAT_HISTORY_LIMIT} messages in this battle.</p>}
    <form ref={form} className="stack" onSubmit={send}>
      <label className="field" htmlFor={`${prefix}-chat-message`}>{crew ? 'Message your crew' : 'Your message'}</label>
      <textarea ref={input} id={`${prefix}-chat-message`} className="comment-input" rows={2} maxLength={CHAT_MAX_LENGTH} value={draft} disabled={sending}
        placeholder="Write a message…"
        onChange={e => { setDraft(e.target.value); setError(''); }}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); form.current?.requestSubmit(); }
        }} />
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="hint">{draft.length}/{CHAT_MAX_LENGTH} · Enter to send · Shift+Enter for a new line</span>
        <button type="submit" className="btn btn-primary btn-sm" disabled={sending || !draft.trim()}>{sending ? 'Sending…' : crew ? 'Send to crew' : 'Send to room'}</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
    <p className="hint">Messages stay with this battle. Starting a new battle clears the conversation.</p>
  </section>;
}

'use client';
import { useEffect, useState } from 'react';
import { ROOM_ID, SLOTS } from './config';
import { upgradeDemoTaste } from './demoTaste';
import { newBattleRoom } from './battle';
import { advanceBotChat, appendChat, chatMessageId, type ChatAuthor } from './chat';
import { loadSession } from './session';
import { getLobbyStore } from './roomStores';
import { EMPTY_ROOM, type RoomState } from './types';

/**
 * Legacy demo room sync. Named lobbies use authenticated server actions online
 * or the same permissions over local storage for browser-only practice.
 *
 * Patches use dotted paths ("players.p1.beat") so concurrent writers never
 * overwrite each other's fields. A value of null deletes the field.
 */
export type Patch = Record<string, unknown>;

export interface RoomStore {
  mode: 'online' | 'local';
  subscribe(cb: (room: RoomState) => void, onError?: (error: Error) => void): () => void;
  tickBots?(battleId: string): Promise<void>;
  removePlayer?(slot: import('./config').SlotId): Promise<void>;
  update(patch: Patch, expectedBattleId?: string): Promise<void>;
  reset(): Promise<void>;
  sendChat(author: ChatAuthor, text: string, battleId: string, crewId?: string): Promise<void>;
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split('.');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  const last = keys[keys.length - 1];
  if (value === null) delete cur[last]; else cur[last] = value;
}

function withDefaults(raw: Partial<RoomState> | undefined | null): RoomState {
  const players = { ...(raw?.players || {}) };
  for (const { id } of SLOTS) {
    const player = players[id];
    if (player) players[id] = upgradeDemoTaste(player, id);
  }
  return {
    phase: raw?.phase || 'lobby',
    phaseEndsAt: raw?.phaseEndsAt ?? null,
    players,
    pairs: raw?.pairs ?? null,
    ...(raw?.voting ? { voting: raw.voting } : {}),
    ...(raw?.battle ? { battle: raw.battle } : {}),
    ...(raw?.chat ? { chat: raw.chat } : {}),
    ...(raw?.chatSequence ? { chatSequence: raw.chatSequence } : {}),
    updatedAt: raw?.updatedAt || 0,
  };
}

function createLocalStore(): RoomStore {
  const key = `flipthis.room.${ROOM_ID}`;
  // Serialize all local writes so chat and beat edits cannot overwrite one another.
  const mutate = (fn: () => void) => typeof navigator !== 'undefined' && navigator.locks
    ? navigator.locks.request(`${key}.write`, async () => fn())
    : Promise.resolve().then(fn);
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(key) : null;
  const listeners = new Set<(r: RoomState) => void>();
  const read = (): RoomState => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return withDefaults(JSON.parse(raw));
      const fresh = newBattleRoom();
      localStorage.setItem(key, JSON.stringify(fresh));
      return fresh;
    } catch { return { ...EMPTY_ROOM }; }
  };
  const write = (r: RoomState) => {
    try { localStorage.setItem(key, JSON.stringify(r)); } catch {}
    listeners.forEach((l) => l(r));
    channel?.postMessage('changed');
  };
  channel?.addEventListener('message', () => { const r = read(); listeners.forEach((l) => l(r)); });
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => { if (e.key === key) { const r = read(); listeners.forEach((l) => l(r)); } });
  }
  return {
    mode: 'local',
    subscribe(cb) { listeners.add(cb); cb(read()); return () => { listeners.delete(cb); }; },
    async update(patch, expectedBattleId) {
      await mutate(() => {
      const r = read() as unknown as Record<string, unknown>;
      if (expectedBattleId && (r as unknown as RoomState).battle?.id !== expectedBattleId) return;
      for (const [p, v] of Object.entries(patch)) setPath(r, p, JSON.parse(JSON.stringify(v ?? null)));
      (r as unknown as RoomState).updatedAt = Date.now();
      write(withDefaults(r as unknown as RoomState));
      });
    },
    async tickBots(battleId) { await mutate(() => { const room = read(); const next = advanceBotChat(room, battleId); if (next !== room) write(next); }); },
    async reset() { await mutate(() => write(newBattleRoom(read()))); },
    async sendChat(author, text, battleId, crewId) {
      const id = chatMessageId();
      await mutate(() => {
        const room = read();
        write({ ...room, ...appendChat(room, author, text, battleId, id, Date.now(), crewId), updatedAt: Date.now() });
      });
    },
  };
}

let singleton: RoomStore | null = null;
export function getStore(roomId?: string, token?: string, transport: 'local' | 'online' = 'local'): RoomStore {
  if (roomId && token) return getLobbyStore(roomId, token, transport);
  if (!singleton) singleton = createLocalStore();
  return singleton;
}

export function useRoom() {
  const [store, setStore] = useState<RoomStore | null>(null);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const session = loadSession();
    const selected = getStore(session?.roomId, session?.token, session?.transport);
    setStore(selected);
    return selected.subscribe(next => { setRoom(next); setError(''); }, err => {
      setError(err.message || 'Connection interrupted. Reconnecting…');
      if ((err as { status?: number }).status === 401 || (err as { status?: number }).status === 404) setRoom(null);
    });
  }, []);
  return { room, store, error, mode: store?.mode ?? 'local' };
}

/** Ticks once a second so countdowns re-render. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(t); }, [intervalMs]);
  return now;
}

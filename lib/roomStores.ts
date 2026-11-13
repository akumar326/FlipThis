'use client';
import { roomForChatMember } from './chat';
import { actorFor, createLobbyRecord, joinLobbyRecord, updateLobbyRecord, resetLobbyRecord, chatLobbyRecord, botChatLobbyRecord, removeLobbyPlayer, LobbyError, ROOM_CODE_PATTERN, roomCode, randomSecret, type LobbyRecord } from './lobbies';
import type { Session } from './session';
import type { RoomStore, Patch } from './store';
import type { RoomState } from './types';
import type { SlotId } from './config';

const keyFor = (code: string) => `flipthis.lobby.${code}`;
async function lock<T>(key: string, operation: () => T): Promise<T> {
  return typeof navigator !== 'undefined' && navigator.locks
    ? await navigator.locks.request(`${key}.write`, async () => operation())
    : operation();
}
function read(code: string): LobbyRecord {
  const value = localStorage.getItem(keyFor(code));
  if (!value) throw new LobbyError('Lobby not found on this device. Check the code or use the online invite link.', 404);
  return JSON.parse(value);
}
function sessionFor(record: LobbyRecord, token: string): Session {
  const actor = actorFor(record, token);
  return { ...actor, token, roomId: record.room.lobby!.code, transport: 'local', name: actor.role === 'host' ? record.room.lobby!.hostName : record.room.players[actor.slot!]!.name };
}

export async function createLobby(name: string, hostName: string, transport: 'local' | 'online'): Promise<Session> {
  if (transport === 'online') return (await api('/api/lobbies', { method: 'POST', body: JSON.stringify({ name, hostName }) })).session;
  return lock('flipthis.lobby-index', () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = roomCode();
      if (localStorage.getItem(keyFor(code))) continue;
      const token = randomSecret(), record = createLobbyRecord(code, name, hostName, token);
      localStorage.setItem(keyFor(code), JSON.stringify(record));
      return sessionFor(record, token);
    }
    throw new LobbyError('Could not create a lobby. Please retry.');
  });
}
export async function joinLobby(code: string, name: string, transport: 'local' | 'online', resume?: Session): Promise<Session> {
  code = code.trim().toUpperCase();
  if (!ROOM_CODE_PATTERN.test(code)) throw new LobbyError('Enter the six-character room code from your host.');
  if (transport === 'online') return (await api(`/api/lobbies/${code}`, { method: 'POST', body: JSON.stringify({ action: 'join', name }) }, resume?.token)).session;
  return lock(keyFor(code), () => {
    const token = resume?.token || randomSecret(), current = read(code);
    if (resume?.token) actorFor(current, token);
    const joined = joinLobbyRecord(current, name, token);
    localStorage.setItem(keyFor(code), JSON.stringify(joined.record));
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(keyFor(code)) : null;
    channel?.postMessage('changed'); channel?.close();
    return sessionFor(joined.record, token);
  });
}

async function api(path: string, options: RequestInit = {}, token?: string) {
  const response = await fetch(path, { ...options, cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new LobbyError(data.error || 'Connection interrupted. Please retry.', response.status);
  return data;
}

function localLobbyStore(code: string, token: string): RoomStore {
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(keyFor(code)) : null;
  const listeners = new Set<(room: RoomState) => void>();
  const errors = new Set<(error: Error) => void>();
  function refresh() {
    try { const record = read(code); actorFor(record, token); listeners.forEach(cb => cb(roomForChatMember(record.room, actorFor(record, token).slot || 'host'))); }
    catch (err) { errors.forEach(cb => cb(err as Error)); }
  }
  channel?.addEventListener('message', refresh);
  if (typeof window !== 'undefined') window.addEventListener('storage', e => { if (e.key === keyFor(code)) refresh(); });
  async function change(operation: (record: LobbyRecord) => LobbyRecord) {
    try {
      await lock(keyFor(code), () => {
        const next = operation(read(code));
        localStorage.setItem(keyFor(code), JSON.stringify(next));
        refresh(); channel?.postMessage('changed');
      });
    } catch (err) { errors.forEach(cb => cb(err as Error)); throw err; }
  }
  return {
    mode: 'local',
    subscribe(cb, onError) { listeners.add(cb); if (onError) errors.add(onError); refresh(); return () => { listeners.delete(cb); if (onError) errors.delete(onError); }; },
    update(patch, battleId) { return change(record => updateLobbyRecord(record, token, patch, battleId)); },
    reset() { return change(record => resetLobbyRecord(record, token)); },
    tickBots(battleId) { return change(record => botChatLobbyRecord(record, token, battleId)); },
    removePlayer(slot) { return change(record => removeLobbyPlayer(record, token, slot)); },
    sendChat(_author, text, battleId, crewId) { return change(record => chatLobbyRecord(record, token, text, battleId, randomSecret(), crewId)); },
  };
}

function onlineLobbyStore(code: string, token: string): RoomStore {
  const listeners = new Set<(room: RoomState) => void>(), errors = new Set<(error: Error) => void>();
  let timer: ReturnType<typeof setTimeout> | undefined, stopped = true, version = -1, delay = 2000;
  let generation = 0, activePoll: number | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  const path = `/api/lobbies/${encodeURIComponent(code)}`;
  function publish(room: RoomState) {
    if (room.updatedAt < version) return;
    version = room.updatedAt; listeners.forEach(cb => cb(room));
  }
  async function poll(run = generation) {
    if (stopped || run !== generation || activePoll === run) return;
    activePoll = run;
    try { const data = await api(path, {}, token); if (!stopped && run === generation) { publish(data.room); delay = 2000; } }
    catch (err) { if (!stopped && run === generation) { delay = Math.min(15000, delay * 2); errors.forEach(cb => cb(err as Error)); } }
    finally { if (activePoll === run) activePoll = undefined; }
    if (!stopped && run === generation) timer = setTimeout(() => void poll(run), typeof document !== 'undefined' && document.hidden ? 15000 : delay);
  }
  function visibility() { if (typeof document !== 'undefined' && !document.hidden && !stopped) { clearTimeout(timer); void poll(); } }
  function change(body: Record<string, unknown>, method = 'POST'): Promise<void> {
    const pending = queue.then(async () => {
      try { publish((await api(path, { method, body: JSON.stringify(body) }, token)).room); }
      catch (err) { errors.forEach(cb => cb(err as Error)); throw err; }
    });
    queue = pending.catch(() => {});
    return pending;
  }
  return {
    mode: 'online',
    subscribe(cb, onError) {
      listeners.add(cb); if (onError) errors.add(onError);
      if (stopped) { stopped = false; generation++; void poll(); if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visibility); }
      return () => {
        listeners.delete(cb); if (onError) errors.delete(onError);
        if (!listeners.size) { stopped = true; generation++; clearTimeout(timer); if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visibility); }
      };
    },
    update(patch: Patch, expectedBattleId?: string) { return change({ patch, expectedBattleId }, 'PATCH'); },
    reset() { return change({ action: 'reset' }); },
    tickBots(battleId) { return change({ action: 'bot-chat', battleId }); },
    removePlayer(slot: SlotId) { return change({ action: 'remove', slot }); },
    sendChat(_author, text, battleId, crewId) { return change({ action: 'chat', text, battleId, crewId }); },
  };
}

const stores = new Map<string, RoomStore>();
export function getLobbyStore(code: string, token: string, transport: 'local' | 'online'): RoomStore {
  const key = `${transport}:${code}:${token}`;
  if (!stores.has(key)) stores.set(key, transport === 'online' ? onlineLobbyStore(code, token) : localLobbyStore(code, token));
  return stores.get(key)!;
}

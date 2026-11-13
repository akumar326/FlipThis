import { PHASES, SLOTS, KITS, LANES, DRUM_ROWS, LOOP_BY_ID, type SlotId } from './config';
import { newBattleRoom, battleSample } from './battle';
import { normalizeBeat, canSubmit, loopIdsIn } from './beat';
import { everyoneSampleReady, normalizeTags, pairKey, botVotes, botComments } from './game';
import { createVoting } from './voting';
import { playerBank } from './packs';
import { allowedSongMedia, songEmbed } from './songs';
import { appendChat, type ChatAuthor } from './chat';
import type { Beat, PlayerState, RoomState } from './types';

/** Access keys are SHA-256 token digests online. They never enter a room response. */
export interface LobbyRecord { room: RoomState; hostKey: string; seats: Partial<Record<SlotId, string>> }
export interface LobbyActor { role: 'host' | 'player'; slot?: SlotId }
export class LobbyError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;

export function randomSecret(): string {
  const bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
  return Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
}
export function roomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(6); crypto.getRandomValues(bytes);
  return Array.from(bytes, n => alphabet[n % alphabet.length]).join('');
}
export function cleanName(value: unknown, label = 'Name', max = 20): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new LobbyError(`${label} must be 1–${max} characters.`);
  return value.trim();
}
export function actorFor(record: LobbyRecord, key: string): LobbyActor {
  if (!key) throw new LobbyError('Rejoin this lobby to continue.', 401);
  if (record.hostKey === key) return { role: 'host' };
  const seat = Object.entries(record.seats).find(([, owner]) => owner === key);
  if (seat) return { role: 'player', slot: seat[0] as SlotId };
  throw new LobbyError('Your saved seat is no longer available. Rejoin the lobby.', 401);
}
export function createLobbyRecord(code: string, title: unknown, hostName: unknown, hostKey: string): LobbyRecord {
  const room = newBattleRoom();
  room.lobby = { code, name: cleanName(title, 'Lobby name', 50), hostName: cleanName(hostName), createdAt: Date.now() };
  return { room, hostKey, seats: {} };
}
export function joinLobbyRecord(record: LobbyRecord, name: unknown, key: string): { record: LobbyRecord; slot: SlotId } {
  const existing = Object.entries(record.seats).find(([, owner]) => owner === key);
  if (existing) return { record, slot: existing[0] as SlotId };
  if (key === record.hostKey) throw new LobbyError('Use your saved host session to run this lobby.');
  if (record.room.phase !== 'lobby') throw new LobbyError('This battle has already started. Ask the host to start a new battle before joining.', 409);
  const slot = SLOTS.find(s => !record.seats[s.id] && !record.room.players[s.id])?.id;
  if (!slot) throw new LobbyError('This lobby is full (20 players).', 409);
  const next = structuredClone(record);
  next.seats[slot] = key;
  next.room.players[slot] = { name: cleanName(name), joinedAt: Date.now(), bank: next.room.battle!.packs[slot] };
  next.room.updatedAt = Math.max(Date.now(), record.room.updatedAt + 1);
  return { record: next, slot };
}

const unsafe = new Set(['__proto__', 'prototype', 'constructor']);
function setPath(object: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.');
  if (parts.some(p => !p || unsafe.has(p))) throw new LobbyError('Invalid update path.');
  let current = object;
  for (const part of parts.slice(0, -1)) {
    if (!current[part] || typeof current[part] !== 'object') current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  if (value === null) delete current[parts.at(-1)!]; else current[parts.at(-1)!] = value;
}
function isObject(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function checkBeat(value: unknown, room: RoomState, slot: SlotId, remix = false): Beat {
  if (!isObject(value) || !KITS.some(k => k.id === value.kit) || !isObject(value.place) || !isObject(value.steps) || !Array.isArray(value.drumOn) || value.drumOn.length !== 16 || value.drumOn.some(v => typeof v !== 'boolean')) throw new LobbyError('Invalid beat data.');
  if (Object.keys(value).some(key => !['place', 'kit', 'drumOn', 'steps'].includes(key)) || Object.keys(value.place).some(key => !LANES.some(lane => lane.id === key)) || Object.keys(value.steps).some(key => !DRUM_ROWS.some(row => row.id === key))) throw new LobbyError('Invalid beat fields.');
  const steps = value.steps;
  const count = Array.isArray(steps.kick) ? steps.kick.length : 0;
  if (![8, 16].includes(count) || DRUM_ROWS.some(r => !Array.isArray(steps[r.id]) || (steps[r.id] as unknown[]).length !== count || (steps[r.id] as unknown[]).some(v => v !== 0 && v !== 1))) throw new LobbyError('Drum patterns need 8 or 16 steps.');
  const allowed = new Set([...battleSample(room).loops, ...playerBank(room.players[slot], slot, room).loops].map(l => l.id));
  if (remix) {
    const partner = room.pairs?.[slot];
    if (partner) loopIdsIn(normalizeBeat(room.players[partner]?.beat)).forEach(id => allowed.add(id));
  }
  for (const lane of LANES) {
    const placements = value.place[lane.id];
    if (!isObject(placements) || Object.entries(placements).some(([bar, id]) => !/^(?:[0-9]|1[0-5])$/.test(bar) || typeof id !== 'string' || !allowed.has(id) || LOOP_BY_ID[id]?.lane !== lane.id)) throw new LobbyError('Use the sounds assigned to this battle.');
  }
  return normalizeBeat(value as unknown as Beat);
}

function validatePlayerPatch(room: RoomState, slot: SlotId, path: string, value: unknown) {
  const prefix = `players.${slot}.`;
  if (!path.startsWith(prefix)) throw new LobbyError('You can only update your own submission.', 403);
  const field = path.slice(prefix.length);
  if (field === 'name') { cleanName(value); return; }
  if (field === 'taste' && room.phase === 'taste' && isObject(value)) {
    if (Object.keys(value).some(key => !['song', 'tags', 'preview'].includes(key)) || typeof value.song !== 'string' || !value.song.trim() || value.song.length > 100 || !Array.isArray(value.tags) || value.tags.length !== 2 || value.tags.some(t => typeof t !== 'string' || t.length > 30) || normalizeTags(value.tags).length !== 2) throw new LobbyError('Add a song and two distinct vibe tags.');
    if (value.preview && (!isObject(value.preview) || Object.keys(value.preview).some(key => !['provider', 'title', 'url', 'audio', 'art'].includes(key)) || typeof value.preview.title !== 'string' || value.preview.title.length > 200 || typeof value.preview.url !== 'string' || value.preview.url.length > 2000 || !songEmbed(value.preview as never) || (value.preview.audio !== undefined && !allowedSongMedia(value.preview.audio, 'audio')) || (value.preview.art !== undefined && !allowedSongMedia(value.preview.art, 'art')))) throw new LobbyError('Invalid song preview.');
    return;
  }
  if (field === 'sampleReady' && room.phase === 'sample' && typeof value === 'boolean') return;
  if (field === 'beat' && room.phase === 'studio') { checkBeat(value, room, slot); return; }
  if (field === 'submitted' && room.phase === 'studio' && typeof value === 'boolean') return;
  if (room.phase === 'vote' && field.startsWith('votes.')) {
    const key = field.slice(6), pair = room.voting?.schedule[slot]?.find(p => pairKey(...p) === key);
    if (!pair || !pair.includes(value as SlotId)) throw new LobbyError('Vote in one of your assigned matchups.');
    return;
  }
  if (room.phase === 'vote' && field.startsWith('comments.')) {
    const target = field.slice(9) as SlotId;
    if (!room.voting?.schedule[slot]?.some(p => p.includes(target)) || (value !== null && (typeof value !== 'string' || value.length > 280))) throw new LobbyError('Leave feedback only on beats assigned to you.');
    return;
  }
  if (field === 'flip' && room.phase === 'flipback' && isObject(value)) {
    if (Object.keys(value).some(key => !['of', 'beat', 'edits', 'done'].includes(key)) || value.of !== room.pairs?.[slot] || typeof value.done !== 'boolean' || !Number.isSafeInteger(value.edits) || (value.edits as number) < 0) throw new LobbyError('Invalid remix submission.');
    checkBeat(value.beat, room, slot, true); return;
  }
  if (field === 'flip.done' && room.phase === 'flipback' && room.players[slot]?.flip && typeof value === 'boolean') return;
  if (field === 'teamUp' && room.phase === 'teamup' && (value === null || typeof value === 'boolean')) return;
  throw new LobbyError('This action is not available in the current phase.', 403);
}

export function updateLobbyRecord(record: LobbyRecord, key: string, patch: Record<string, unknown>, expectedBattleId?: string): LobbyRecord {
  const actor = actorFor(record, key);
  if (expectedBattleId && record.room.battle?.id !== expectedBattleId) return record;
  if (!isObject(patch) || !Object.keys(patch).length || Object.keys(patch).length > 100) throw new LobbyError('Invalid room update.');
  const next = structuredClone(record);
  for (const [path, value] of Object.entries(patch)) {
    if (actor.role === 'player') validatePlayerPatch(record.room, actor.slot!, path, value);
    else if (!['phase', 'phaseEndsAt', 'players', 'pairs', 'voting'].includes(path.split('.')[0])) throw new LobbyError('This room field is managed automatically.');
    setPath(next.room as unknown as Record<string, unknown>, path, value);
  }
  if (!PHASES.includes(next.room.phase) || (next.room.phaseEndsAt != null && (!Number.isFinite(next.room.phaseEndsAt) || next.room.phaseEndsAt < 0)) || Object.keys(next.room.players).some(id => !SLOTS.some(s => s.id === id))) throw new LobbyError('Invalid room state.');
  if (actor.role === 'host' && record.room.phase === 'sample' && next.room.phase === 'studio' && !everyoneSampleReady(next.room)) throw new LobbyError('Wait for at least three players and for everyone to ready up.');
  if (actor.role === 'host' && next.room.phase === 'vote' && !record.room.voting) {
    next.room.voting = createVoting(next.room);
    if (next.room.voting.slots.length < 3) throw new LobbyError('At least three eligible submissions are needed to vote.');
    for (const { id } of SLOTS) if (next.room.players[id]?.bot) {
      next.room.players[id]!.votes = botVotes(next.room, id);
      next.room.players[id]!.comments = botComments(next.room, id);
    }
  }
  if (actor.role === 'player' && next.room.players[actor.slot!]?.submitted && !canSubmit(normalizeBeat(next.room.players[actor.slot!]?.beat))) throw new LobbyError('Use the shared sample in at least two bars before submitting.');
  next.room.updatedAt = Math.max(Date.now(), record.room.updatedAt + 1);
  return next;
}

export function resetLobbyRecord(record: LobbyRecord, key: string): LobbyRecord {
  if (actorFor(record, key).role !== 'host') throw new LobbyError('Only the host can start a new battle.', 403);
  const next = structuredClone(record);
  next.room = { ...newBattleRoom(record.room), lobby: record.room.lobby };
  for (const slot of Object.keys(record.seats) as SlotId[]) {
    const player = record.room.players[slot];
    if (player) next.room.players[slot] = { name: player.name, joinedAt: player.joinedAt, bank: next.room.battle!.packs[slot] };
  }
  next.room.updatedAt = Math.max(Date.now(), record.room.updatedAt + 1);
  return next;
}
export function chatLobbyRecord(record: LobbyRecord, key: string, text: string, battleId: string, id: string, crewId?: string): LobbyRecord {
  const actor = actorFor(record, key);
  const author: ChatAuthor = actor.role === 'host' ? 'host' : actor.slot!;
  try {
    return { ...record, room: { ...record.room, ...appendChat(record.room, author, text, battleId, id, Date.now(), crewId), updatedAt: Math.max(Date.now(), record.room.updatedAt + 1) } };
  } catch (err) { throw new LobbyError(err instanceof Error ? err.message : 'Chat is unavailable.'); }
}
export function removeLobbyPlayer(record: LobbyRecord, key: string, slot: SlotId): LobbyRecord {
  if (actorFor(record, key).role !== 'host') throw new LobbyError('Only the host can clear a seat.', 403);
  if (!SLOTS.some(s => s.id === slot)) throw new LobbyError('Unknown seat.');
  const next = structuredClone(record);
  delete next.seats[slot]; delete next.room.players[slot];
  for (const crewId of Object.keys(next.room.crewChats || {})) if (crewId.split('-').includes(slot)) delete next.room.crewChats![crewId];
  next.room.updatedAt = Math.max(Date.now(), record.room.updatedAt + 1);
  return next;
}

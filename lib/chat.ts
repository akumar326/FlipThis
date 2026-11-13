import { planBotChat } from './bots';
import { collaborationGroups } from './game';
import { PHASES, SLOTS, type Phase, type SlotId } from './config';
import type { ChatMessage, RoomState } from './types';

export const CHAT_MAX_LENGTH = 400;
export const CHAT_HISTORY_LIMIT = 150;
export type ChatAuthor = SlotId | 'host';

export function chatIsOpen(phase: Phase): boolean {
  return phase === 'lobby' || PHASES.indexOf(phase) >= PHASES.indexOf('reveal');
}

export function chatMessages(room: RoomState): ChatMessage[] {
  return Object.values(room.chat || {}).sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
}

/** Called against the latest room inside a transaction or local write lock. */
export function appendChat(room: RoomState, author: ChatAuthor, text: string, battleId: string, id: string, now = Date.now(), crewId?: string) {
  if ((room.battle?.id || 'legacy') !== battleId) throw new Error('A new battle has started. Send your message again in the new lobby.');
  if (crewId && (author === 'host' || crewFor(room, author)?.join('-') !== crewId)) throw new Error('Only members of a mutually formed crew can use this chat.');
  if (!chatIsOpen(room.phase)) throw new Error('Room chat opens in the lobby and after the reveal.');
  const player = author === 'host' ? null : room.players[author];
  if (author !== 'host' && (!SLOTS.some(s => s.id === author) || !player || player.bot)) throw new Error('Join a player seat before sending a message.');
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Write a message first.');
  if (trimmed.length > CHAT_MAX_LENGTH) throw new Error(`Keep messages to ${CHAT_MAX_LENGTH} characters.`);
  return storeChat(room, author, trimmed, id, now, crewId);
}

function storeChat(room: RoomState, author: ChatAuthor, trimmed: string, id: string, now: number, crewId?: string): Partial<RoomState> {
  const player = author === 'host' ? null : room.players[author];
  const history = crewId ? room.crewChats?.[crewId] : room;
  const sequence = (history?.chatSequence || 0) + 1;
  const message: ChatMessage = { id, author, name: author === 'host' ? 'Facilitator' : player!.name, text: trimmed, phase: room.phase, sequence, createdAt: now };
  const recent = [...Object.values(history?.chat || {}), message].sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id)).slice(-CHAT_HISTORY_LIMIT);
  const channel = { chat: Object.fromEntries(recent.map(m => [m.id, m])), chatSequence: sequence };
  return crewId ? { crewChats: { ...room.crewChats, [crewId]: channel } } : channel;
}

export function chatMessageId(): string {
  const values = new Uint32Array(4);
  crypto.getRandomValues(values);
  return Array.from(values, n => n.toString(16).padStart(8, '0')).join('');
}

export function crewFor(room: RoomState, author: ChatAuthor): SlotId[] | undefined {
  if (author === 'host' || !['teamup', 'done'].includes(room.phase)) return;
  return collaborationGroups(room).find(group => group.length >= 2 && group.includes(author) && group.every(id => room.players[id]?.teamUp === true))?.sort();
}

/** Filter private conversations on every API response, including writes/rejoins. */
export function roomForChatMember(room: RoomState, author: ChatAuthor): RoomState {
  const { crewChats, ...publicRoom } = room;
  const crewId = crewFor(room, author)?.join('-');
  return crewId && crewChats?.[crewId] ? { ...publicRoom, crewChats: { [crewId]: crewChats[crewId] } } : publicRoom;
}

/** Only the authenticated host action (or trusted classic demo) calls this. */
export function advanceBotChat(room: RoomState, battleId: string, now = Date.now()): RoomState {
  if ((room.battle?.id || 'legacy') !== battleId) return room;
  const plan = planBotChat(room, now);
  if (!plan) return room;
  const next = { ...room, botChatState: plan.state, updatedAt: Math.max(now, room.updatedAt + 1) };
  if (!plan.message) return next;
  const id = `bot-${battleId}-${room.phase}-${plan.state.sent}`;
  const patch = storeChat(room, plan.message.author, plan.message.text, id, now);
  const chat = patch.chat!;
  chat[id] = { ...chat[id], bot: true };
  return { ...next, ...patch };
}

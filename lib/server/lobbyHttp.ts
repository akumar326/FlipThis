import { roomForChatMember } from '../chat';
import { createHash } from 'node:crypto';
import { actorFor, createLobbyRecord, joinLobbyRecord, updateLobbyRecord, resetLobbyRecord, chatLobbyRecord, botChatLobbyRecord, removeLobbyPlayer, LobbyError, ROOM_CODE_PATTERN, randomSecret, roomCode, type LobbyRecord } from '../lobbies';
import type { Session } from '../session';
import type { SlotId } from '../config';

export interface LobbyRepository {
  read(code: string): Promise<LobbyRecord | null>;
  create(code: string, record: LobbyRecord): Promise<boolean>;
  transact<T>(code: string, operation: (record: LobbyRecord | null) => { record: LobbyRecord; result: T }): Promise<T>;
}
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
function tokenFrom(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const token = header.replace(/^Bearer /, '');
  if (!/^[a-f0-9]{64}$/.test(token)) throw new LobbyError('Rejoin this lobby to continue.', 401);
  return token;
}
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store, private', 'Vary': 'Authorization' } });
function errorResponse(error: unknown) {
  if (error instanceof LobbyError) return json({ error: error.message }, error.status);
  console.error('[flipthis] lobby service request failed');
  return json({ error: 'The lobby service is unavailable. Your saved identity is safe; please retry.' }, 503);
}
async function bodyFrom(request: Request): Promise<Record<string, unknown>> {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new LobbyError('Open this action from the FlipThis website.', 403);
  const text = await request.text();
  if (text.length > 250_000) throw new LobbyError('This update is too large.', 413);
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw new LobbyError('Invalid request.'); }
}
function requireRecord(record: LobbyRecord | null): LobbyRecord {
  if (!record) throw new LobbyError('Lobby not found. Check the room code.', 404);
  return record;
}
function sessionFor(record: LobbyRecord, key: string, token: string): Session {
  const actor = actorFor(record, key);
  return { ...actor, roomId: record.room.lobby!.code, token, transport: 'online', name: actor.role === 'host' ? record.room.lobby!.hostName : record.room.players[actor.slot!]!.name };
}

/** Repository injection lets tests exercise the real HTTP authorization flow. */
export function lobbyHttp(repository: LobbyRepository) {
  return {
    async create(request: Request): Promise<Response> {
      try {
        const body = await bodyFrom(request), token = randomSecret(), key = hash(token);
        for (let attempt = 0; attempt < 8; attempt++) {
          const code = roomCode(), record = createLobbyRecord(code, body.name, body.hostName, key);
          if (await repository.create(code, record)) return json({ room: roomForChatMember(record.room, 'host'), session: sessionFor(record, key, token) }, 201);
        }
        throw new LobbyError('Could not reserve a lobby code. Please retry.', 503);
      } catch (error) { return errorResponse(error); }
    },
    async room(request: Request, code: string): Promise<Response> {
      try {
        code = code.toUpperCase();
        if (!ROOM_CODE_PATTERN.test(code)) throw new LobbyError('Enter a valid six-character room code.');
        const token = tokenFrom(request);
        if (request.method === 'GET') {
          if (!token) throw new LobbyError('Join this lobby to see the room.', 401);
          const record = requireRecord(await repository.read(code));
          const session = sessionFor(record, hash(token), token);
          return json({ room: roomForChatMember(record.room, session.slot || 'host'), identity: { role: session.role, slot: session.slot, name: session.name } });
        }
        const body = await bodyFrom(request);
        if (request.method === 'POST' && body.action === 'join') {
          const nextToken = token || randomSecret(), key = hash(nextToken);
          const result = await repository.transact(code, current => {
            const record = requireRecord(current);
            if (token) actorFor(record, key);
            const joined = joinLobbyRecord(record, body.name, key);
            return { record: joined.record, result: { room: roomForChatMember(joined.record.room, actorFor(joined.record, key).slot || 'host'), session: sessionFor(joined.record, key, nextToken) } };
          });
          return json(result);
        }
        if (!token) throw new LobbyError('Rejoin this lobby to continue.', 401);
        const key = hash(token);
        const result = await repository.transact(code, current => {
          const record = requireRecord(current);
          let next: LobbyRecord;
          if (request.method === 'PATCH') next = updateLobbyRecord(record, key, body.patch as Record<string, unknown>, typeof body.expectedBattleId === 'string' ? body.expectedBattleId : undefined);
          else if (request.method === 'POST' && body.action === 'reset') next = resetLobbyRecord(record, key);
          else if (request.method === 'POST' && body.action === 'chat' && typeof body.text === 'string' && typeof body.battleId === 'string') next = chatLobbyRecord(record, key, body.text, body.battleId, randomSecret(), typeof body.crewId === 'string' ? body.crewId : undefined);
          else if (request.method === 'POST' && body.action === 'bot-chat' && typeof body.battleId === 'string') next = botChatLobbyRecord(record, key, body.battleId);
          else if (request.method === 'POST' && body.action === 'remove' && typeof body.slot === 'string') next = removeLobbyPlayer(record, key, body.slot as SlotId);
          else throw new LobbyError('Unknown room action.');
          return { record: next, result: { room: roomForChatMember(next.room, actorFor(next, key).slot || 'host') } };
        });
        return json(result);
      } catch (error) { return errorResponse(error); }
    },
  };
}

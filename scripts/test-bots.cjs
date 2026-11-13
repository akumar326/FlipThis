const assert = require('node:assert/strict');
const load = require('./load-typescript.cjs')();
const { SLOTS } = load('lib/config.ts');
const { botPlayer, botComments } = load('lib/game.ts');
const { BOT_PERSONALITIES, botProfile } = load('lib/bots.ts');
const { newBattleRoom } = load('lib/battle.ts');
const { createVoting } = load('lib/voting.ts');
const { advanceBotChat, chatMessages } = load('lib/chat.ts');
const { botChatLobbyRecord } = load('lib/lobbies.ts');
let room = newBattleRoom();
room.players = Object.fromEntries(SLOTS.map(({ id }, i) => [id, { ...botPlayer(id, room), botProfile: { personality: BOT_PERSONALITIES[i % BOT_PERSONALITIES.length], seed: 1027 + i * 993 } }]));
room.phase = 'vote'; room.voting = createVoting(room);
const everyComment = [];
for (const { id } of SLOTS) {
  const comments = botComments(room, id), notes = Object.values(comments);
  assert.ok(notes.length >= 6);
  assert.equal(new Set(notes).size, notes.length, 'a bot does not copy one comment to all submissions');
  assert.deepEqual(botComments(structuredClone(room), id), comments, 'feedback stays stable across reload/retry');
  assert.ok(notes.every(note => note.startsWith('Demo feedback:') && note.length <= 280));
  everyComment.push(...notes);
}
assert.ok(new Set(everyComment).size > 60, 'different bots and submissions have varied feedback');
const profiles = Array.from({ length: 40 }, () => botPlayer('p1', room).botProfile);
assert.ok(new Set(profiles.map(profile => profile.seed)).size > 1, 'new bots reroll their profile');
assert.ok(profiles.every(profile => BOT_PERSONALITIES.includes(profile.personality)));
const legacy = structuredClone(room); delete legacy.players.p1.botProfile;
assert.deepEqual(botProfile(legacy, 'p1'), botProfile(structuredClone(legacy), 'p1'));
for (const phase of ['taste', 'sample', 'studio', 'vote']) {
  const silent = { ...room, phase };
  assert.equal(advanceBotChat(silent, room.battle.id, 100000), silent, 'bots stay quiet in closed-chat phases');
}
room.phase = 'lobby';
room = advanceBotChat(room, room.battle.id, 100000);
assert.equal(chatMessages(room).length, 0, 'joining initializes a delay instead of instantly posting');
assert.equal(advanceBotChat(room, room.battle.id, room.botChatState.nextAt - 1), room);
const authors = new Set(), texts = new Set();
for (let i = 0; i < 3; i++) {
  const due = room.botChatState.nextAt;
  room = advanceBotChat(room, room.battle.id, due);
  const message = chatMessages(room).at(-1);
  assert.ok(message.bot && message.name.includes('(demo)'));
  assert.ok(message.text.length <= 400);
  authors.add(message.author); texts.add(message.text);
  assert.equal(advanceBotChat(room, room.battle.id, due), room, 'a second host tick cannot duplicate a message');
}
assert.equal(authors.size, 3); assert.equal(texts.size, 3);
assert.equal(advanceBotChat(room, room.battle.id, 999999), room, 'at most three bot messages per open phase');
assert.equal(advanceBotChat(room, 'old-battle', 999999), room, 'old ticks cannot cross a reset');
room = advanceBotChat({ ...room, phase: 'reveal' }, room.battle.id, 1000000);
assert.equal(room.botChatState.sent, 0, 'new phase gets its own limited schedule');
const noBots = { ...room, players: {} };
assert.equal(advanceBotChat(noBots, noBots.battle.id, 2000000), noBots);
const record = { room, hostKey: 'host', seats: { p20: 'player' } };
assert.throws(() => botChatLobbyRecord(record, 'player', room.battle.id), /Only the host/);
assert.ok(botChatLobbyRecord(record, 'host', room.battle.id).room);
console.log('PASS: varied stable feedback, randomized personalities, legacy bots, paced chat, phase limits, no duplicates, stale ticks, and host authorization.');

const assert = require('node:assert/strict');
const loader = require('./load-typescript.cjs');
const load = loader();
const { lobbyHttp } = load('lib/server/lobbyHttp.ts');
const { SLOTS } = load('lib/config.ts');
const { botBeat, matchupsFor, pairKey, automaticPairs, standings } = load('lib/game.ts');
const { battleSample } = load('lib/battle.ts');
const { feedbackFor, votePatch } = load('lib/voting.ts');
const clone = value => structuredClone(value);
const data = new Map(), queues = new Map();
const memoryRepository = {
  async read(code) { return data.has(code) ? clone(data.get(code)) : null; },
  async create(code, record) { if (data.has(code)) return false; data.set(code, clone(record)); return true; },
  async transact(code, operation) {
    const task = (queues.get(code) || Promise.resolve()).then(() => {
      const result = operation(data.has(code) ? clone(data.get(code)) : null);
      data.set(code, clone(result.record)); return clone(result.result);
    });
    queues.set(code, task.catch(() => {})); return task;
  },
};
const realFirebase = process.env.FLIPTHIS_FIREBASE_TEST === '1';
const repository = realFirebase ? load('lib/server/firebaseRooms.ts').firebaseRooms() : memoryRepository;
const createdCodes = [];
const http = lobbyHttp(repository);
function request(code, method, body, token) {
  return new Request(`http://flipthis.test/api/lobbies${code ? `/${code}` : ''}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function call(code, method, body, token) {
  const response = await http.room(request(code, method, body, token), code);
  return { status: response.status, ...(await response.json()) };
}
async function create(name) {
  const response = await http.create(request('', 'POST', { name, hostName: 'Facilitator' }));
  assert.equal(response.status, 201); const result = await response.json(); createdCodes.push(result.session.roomId); return result;
}
async function main() {
  const first = await create('Class battle'), second = await create('Separate room');
  const code = first.session.roomId, host = first.session.token;
  assert.notEqual(code, second.session.roomId);
  assert.equal((await call(code, 'GET')).status, 401);
  assert.equal((await call(code, 'GET', null, '0'.repeat(64))).status, 401);
  assert.equal((await call(code, 'GET', null, second.session.token)).status, 401);
  assert.equal((await call('INVALID', 'GET', null, host)).status, 400);
  const joined = await Promise.all(Array.from({ length: 22 }, (_, i) => call(code, 'POST', { action: 'join', name: `Creator ${i + 1}`, role: 'host', slot: 'p1' })));
  const players = joined.filter(r => r.status === 200).map(r => r.session);
  assert.equal(players.length, 20);
  assert.equal(joined.filter(r => r.status === 409).length, 2);
  assert.equal(new Set(players.map(s => s.slot)).size, 20, 'concurrent joins allocate unique seats');
  assert.ok(players.every(s => s.role === 'player'), 'clients cannot request the host role');
  const own = players[0], peer = players[1];
  let view = await call(code, 'GET', null, own.token);
  assert.ok(!JSON.stringify(view).includes('hostKey') && !JSON.stringify(view).includes('seats'), 'room responses contain no access records');
  assert.notEqual((await repository.read(code)).hostKey, host, 'server stores only a digest of the host token');
  assert.equal((await call(code, 'PATCH', { patch: { phase: 'studio' } }, own.token)).status, 403);
  assert.equal((await call(code, 'POST', { action: 'reset' }, own.token)).status, 403);
  assert.equal((await call(code, 'POST', { action: 'remove', slot: peer.slot }, own.token)).status, 403);
  assert.equal((await call(code, 'PATCH', { patch: { [`players.${peer.slot}.name`]: 'Hijacked' } }, own.token)).status, 403);
  assert.equal((await call(code, 'PATCH', { patch: { 'players.p1.__proto__.polluted': true } }, host)).status, 400);
  assert.equal({}.polluted, undefined);
  assert.equal((await call(code, 'PATCH', { patch: { phase: 'vote' } }, host)).status, 400, 'voting needs three submissions');
  assert.equal((await call(code, 'POST', { action: 'chat', text: 'Hello creators!', battleId: first.room.battle.id }, own.token)).status, 200);
  assert.equal((await call(second.session.roomId, 'GET', null, second.session.token)).room.chat, undefined, 'rooms have independent conversations');
  assert.equal((await call(code, 'PATCH', { patch: { phase: 'taste' } }, host)).status, 200);
  assert.equal((await call(code, 'PATCH', { patch: { [`players.${own.slot}.taste`]: { song: 'My favorite song', tags: ['quiet wonder', 'shared joy'] } } }, own.token)).status, 200);
  assert.equal((await call(code, 'POST', { action: 'chat', text: 'Wrong phase', battleId: first.room.battle.id }, own.token)).status, 400);
  assert.equal((await call(code, 'PATCH', { patch: { [`players.${own.slot}.submitted`]: true } }, own.token)).status, 403);
  assert.equal((await call(code, 'PATCH', { patch: { phase: 'sample' } }, host)).status, 200);
  assert.equal((await call(code, 'PATCH', { patch: { phase: 'studio' } }, host)).status, 400, 'cannot start before participants ready up');
  assert.equal((await call(code, 'PATCH', { patch: { [`players.${own.slot}.sampleReady`]: 'yes' } }, own.token)).status, 403);
  const other = players.find(player => player.slot !== own.slot);
  assert.equal((await call(code, 'PATCH', { patch: { [`players.${other.slot}.sampleReady`]: true } }, own.token)).status, 403, 'cannot ready another player');
  for (const player of players) assert.equal((await call(code, 'PATCH', { patch: { [`players.${player.slot}.sampleReady`]: true } }, player.token)).status, 200);
  assert.equal((await call(code, 'PATCH', { patch: { phase: 'studio' } }, host)).status, 200);
  for (const session of players) {
    const pack = first.room.battle.packs[session.slot];
    const beat = botBeat(session.slot, pack, battleSample(first.room).loops);
    const result = await call(code, 'PATCH', { patch: { [`players.${session.slot}.beat`]: beat, [`players.${session.slot}.submitted`]: true }, expectedBattleId: first.room.battle.id }, session.token);
    assert.equal(result.status, 200);
  }
  const resumed = await call(code, 'POST', { action: 'join', name: 'Ignored rename' }, own.token);
  assert.equal(resumed.status, 200);
  assert.equal(resumed.session.slot, own.slot);
  assert.equal(resumed.room.players[own.slot].submitted, true, 'reconnecting preserves a full lobby seat and submission');
  assert.equal(Object.keys(resumed.room.players).length, 20);
  const fresh = await call(code, 'PATCH', { patch: { phase: 'vote' } }, host);
  assert.equal(fresh.status, 200);
  assert.equal(fresh.room.voting.slots.length, 20);
  const [a, b] = matchupsFor(fresh.room, own.slot)[0];
  const patch = votePatch(fresh.room, own.slot, a, b, a, { [a]: 'This makes me feel hopeful.', [b]: 'I would try a quieter ending.' });
  assert.equal((await call(code, 'PATCH', { patch }, own.token)).status, 200);
  assert.equal((await call(code, 'PATCH', { patch: { [`players.${own.slot}.votes.fake`]: own.slot } }, own.token)).status, 400);
  assert.equal((await call(code, 'PATCH', { patch: { [`players.${own.slot}.comments.${own.slot}`]: 'Self feedback' } }, own.token)).status, 400);
  assert.equal((await call(code, 'PATCH', { patch: { [`players.${own.slot}.beat`]: botBeat(own.slot) } }, own.token)).status, 403);
  view = await call(code, 'GET', null, own.token);
  assert.deepEqual(feedbackFor(view.room, a), []);
  const reveal = await call(code, 'PATCH', { patch: { phase: 'reveal' } }, host);
  assert.equal(feedbackFor(reveal.room, a)[0].text, 'This makes me feel hopeful.');
  assert.equal(standings(reveal.room).reduce((sum, row) => sum + row.wins, 0), 1);
  const pairs = automaticPairs(reveal.room);
  assert.equal((await call(code, 'PATCH', { patch: { phase: 'flipback', pairs } }, host)).status, 200);
  const partner = pairs[own.slot];
  const remix = reveal.room.players[partner].beat;
  assert.equal((await call(code, 'PATCH', { patch: { [`players.${own.slot}.flip`]: { of: partner, beat: remix, edits: 99, done: true } } }, own.token)).status, 200);
  assert.equal((await call(code, 'PATCH', { patch: { phase: 'teamup' } }, host)).status, 200);
  assert.equal((await call(code, 'PATCH', { patch: { [`players.${own.slot}.teamUp`]: true } }, own.token)).status, 200);
  const reset = await call(code, 'POST', { action: 'reset' }, host);
  assert.equal(reset.status, 200);
  assert.equal(reset.room.lobby.code, code);
  assert.equal(reset.room.players[own.slot].name, own.name);
  assert.equal(reset.room.players[own.slot].beat, undefined);
  assert.notEqual(reset.room.battle.id, first.room.battle.id);
  assert.equal((await call(code, 'POST', { action: 'join', name: own.name }, own.token)).session.slot, own.slot);
  assert.equal((await call(code, 'PATCH', { patch: { [`players.${own.slot}.beat`]: remix }, expectedBattleId: first.room.battle.id }, own.token)).room.players[own.slot].beat, undefined, 'stale saves cannot cross battles');
  assert.equal((await call(code, 'POST', { action: 'remove', slot: own.slot }, host)).status, 200);
  assert.equal((await call(code, 'GET', null, own.token)).status, 401, 'cleared seats cannot control the room');
  assert.equal((await call(code, 'POST', { action: 'join', name: 'New creator' })).status, 200);
  const badOrigin = new Request('http://flipthis.test/api/lobbies', { method: 'POST', headers: { origin: 'https://other.test' }, body: '{}' });
  assert.equal((await http.create(badOrigin)).status, 403);
  // Exercise pair and trio chat through every real HTTP response path.
  for (const size of [2, 3]) {
    const lobby = await create(`Crew ${size}`), crewCode = lobby.session.roomId;
    const people = [];
    for (let i = 0; i < size; i++) people.push((await call(crewCode, 'POST', { action: 'join', name: `Creator ${i}` })).session);
    const state = (await call(crewCode, 'GET', null, people[0].token)).room;
    const crewId = people.map(person => person.slot).sort().join('-');
    const outsider = (await call(crewCode, 'POST', { action: 'join', name: 'Outsider' })).session;
    await call(crewCode, 'PATCH', { patch: { phase: 'teamup', pairs: automaticPairs(state) } }, lobby.session.token);
    const send = (person, text) => call(crewCode, 'POST', { action: 'chat', crewId, battleId: state.battle.id, text }, person.token);
    assert.equal((await send(people[0], 'Too soon')).status, 400);
    for (const person of people) await call(crewCode, 'PATCH', { patch: { [`players.${person.slot}.teamUp`]: true } }, person.token);
    await Promise.all(people.map(person => send(person, `Hello ${person.slot}`)));
    const member = (await call(crewCode, 'GET', null, people[1].token)).room;
    assert.equal(Object.keys(member.crewChats[crewId].chat).length, size);
    assert.equal(member.chat, undefined, 'crew messages stay out of global chat');
    assert.equal((await call(crewCode, 'GET', null, lobby.session.token)).room.crewChats, undefined, 'host cannot read crew messages');
    assert.equal((await send(outsider, 'Intrusion')).status, 400);
    assert.equal((await call(crewCode, 'GET', null, outsider.token)).room.crewChats, undefined);
    assert.equal((await call(crewCode, 'POST', { action: 'join', name: 'Outsider' }, outsider.token)).room.crewChats, undefined, 'rejoin cannot expose crew chat');
    assert.equal((await call(crewCode, 'PATCH', { patch: { [`players.${outsider.slot}.name`]: 'Still outside' } }, outsider.token)).room.crewChats, undefined, 'writes cannot expose crew chat');
    const ended = await call(crewCode, 'PATCH', { patch: { phase: 'done' } }, lobby.session.token);
    assert.equal(ended.room.crewChats, undefined);
    assert.equal((await send(people[0], 'Keep in touch')).status, 200);
    await call(crewCode, 'POST', { action: 'remove', slot: people[1].slot }, lobby.session.token);
    await call(crewCode, 'PATCH', { patch: { phase: 'lobby' } }, lobby.session.token);
    const rejoined = (await call(crewCode, 'POST', { action: 'join', name: 'New seat holder' })).session;
    await call(crewCode, 'PATCH', { patch: { phase: 'teamup' } }, lobby.session.token);
    await call(crewCode, 'PATCH', { patch: { [`players.${rejoined.slot}.teamUp`]: true } }, rejoined.token);
    assert.equal((await call(crewCode, 'GET', null, rejoined.token)).room.crewChats, undefined, 'replacement seats cannot inherit old messages');
    await call(crewCode, 'POST', { action: 'reset' }, lobby.session.token);
    assert.equal((await call(crewCode, 'GET', null, people[0].token)).room.crewChats, undefined);
  }
  console.log('PASS: real lobby HTTP handlers, isolated rooms, 22 concurrent joins with a 20-player cap, private host access, phase/seat authorization, reconnects, voting, feedback, chat, remixes, reset and stale-save protection.');
}
const keepAlive = setInterval(() => {}, 1000);
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  try {
    if (realFirebase) {
      const app = require('firebase-admin/app').getApps().find(app => app.name === 'flipthis-server');
      const db = require('firebase-admin/firestore').getFirestore(app);
      for (const code of createdCodes) await db.collection('lobbies').doc(code).delete();
      console.log('Firebase integration verified; temporary verification lobbies removed.');
    }
  } finally { clearInterval(keepAlive); }
});

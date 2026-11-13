const assert = require('node:assert/strict');
const load = require('./load-typescript.cjs')();
const { automaticPairs, collaborationGroups } = load('lib/game.ts');
const { tasteFit, matchingGroups } = load('lib/matching.ts');
const { createLobbyRecord, joinLobbyRecord, updateLobbyRecord } = load('lib/lobbies.ts');
function roomFrom(tastes) {
  return { battle: { id: 'matching-rehearsal' }, phase: 'taste', phaseEndsAt: null, updatedAt: 0, pairs: null,
    players: Object.fromEntries(tastes.map((taste, i) => [`p${i + 1}`, { name: `Creator ${i + 1}`, joinedAt: 1, taste }])) };
}
const song = (artist, genre, title = 'First song') => ({ song: `${artist} – ${title}`, tags: ['unmapped purple', 'unmapped silver'], preview: { provider: 'apple', title: `${artist} – ${title}`, url: 'https://music.apple.com/us/song/123456', artist, genre, trackTitle: title } });
let room = roomFrom([
  { song: 'A – One', tags: ['dreamy', 'chill'] }, { song: 'B – Two', tags: ['hype', 'wild'] },
  { song: 'C – Three', tags: ['ethereal', 'relaxed'] }, { song: 'D – Four', tags: ['energetic', 'intense'] },
]);
assert.deepEqual(automaticPairs(room), { p1: 'p3', p3: 'p1', p2: 'p4', p4: 'p2' }, 'synonyms match across nonadjacent seats');
assert.ok(tasteFit(room, 'p1', 'p3').reasons.some(reason => reason.includes('Related vibes')));
assert.ok(tasteFit(room, 'p1', 'p3').score > tasteFit(room, 'p1', 'p2').score);
for (const a of Object.keys(room.players)) for (const b of Object.keys(room.players)) assert.equal(tasteFit(room, a, b).score, tasteFit(room, b, a).score, 'fit is symmetric');
const vibePriority = structuredClone(room);
for (const [i, id] of Object.keys(vibePriority.players).entries()) {
  const taste = vibePriority.players[id].taste;
  taste.preview = { provider: 'apple', title: `${i < 2 ? 'Artist A' : 'Artist B'} – Song ${i}`, url: `https://music.apple.com/us/song/${200000 + i}`, artist: i < 2 ? 'Artist A' : 'Artist B', trackTitle: `Song ${i}`, genre: 'Pop' };
}
assert.equal(automaticPairs(vibePriority).p1, 'p3', 'strong related vibes outweigh a same-artist match with conflicting vibes');
const sparse = roomFrom([{ song: '', tags: ['wild', 'dreamy'] }, { song: '', tags: ['ethereal'] }]);
assert.equal(tasteFit(sparse, 'p1', 'p2').score, tasteFit(sparse, 'p2', 'p1').score, 'legacy one-tag tastes remain symmetric');
const negation = roomFrom([{ song: '', tags: ['not sad', 'not dark'] }, { song: '', tags: ['melancholic', 'ominous'] }]);
assert.equal(tasteFit(negation, 'p1', 'p2').score, 0);
// Different song URLs: shared artist/genre must help independently of song ID.
room = roomFrom([song('Artist A', 'R&B/Soul', 'One'), song('Artist B', 'Electronic', 'Two'), song('Artist B', 'House', 'Three'), song('Artist A', 'Neo Soul', 'Four')]);
Object.values(room.players).forEach((player, i) => player.taste.preview.url = `https://music.apple.com/us/song/${123456 + i}`);
assert.deepEqual(automaticPairs(room), { p1: 'p4', p4: 'p1', p2: 'p3', p3: 'p2' }, 'song metadata breaks a tag tie');
assert.ok(tasteFit(room, 'p1', 'p4').reasons.some(reason => reason.includes('Same artist')));
assert.ok(tasteFit(room, 'p2', 'p3').reasons.some(reason => reason.includes('Related genres')));
const metadataOnly = roomFrom([{ song: 'A – One', tags: [] }, { song: 'A – Two', tags: [] }, { song: 'B – Three', tags: [] }, { song: 'B – Four', tags: [] }]);
assert.equal(automaticPairs(metadataOnly).p1, 'p2', 'plain-text artist/title still contributes without previews');
const aliases = roomFrom([
  { song: 'A – One', tags: [], preview: { provider: 'spotify', title: 'A – One', url: 'spotify:track:3U4isOIWM3VvDubwSI3y7a' } },
  { song: 'One', tags: [], preview: { provider: 'spotify', title: 'One', url: 'https://open.spotify.com/intl-en/track/3U4isOIWM3VvDubwSI3y7a?si=abc' } },
]);
assert.ok(tasteFit(aliases, 'p1', 'p2').reasons.includes('Same selected song'));
// Independent brute-force enumeration verifies the joint odd-room objective.
const tastes = [
  { song: 'A – One', tags: ['dreamy', 'warm'] }, { song: 'B – Two', tags: ['intense', 'raw'] },
  { song: 'C – Three', tags: ['ethereal', 'cozy'] }, { song: 'D – Four', tags: ['energetic', 'bold'] },
  { song: 'A – Five', tags: ['calm', 'nostalgic'] }, { song: 'B – Six', tags: ['playful', 'joyful'] },
  { song: 'D – Seven', tags: ['reflective', 'sad'] },
];
room = roomFrom(tastes);
function value(group) {
  if (group.length === 2) return tasteFit(room, group[0], group[1]).score * 2;
  return tasteFit(room, group[0], group[1]).score + tasteFit(room, group[0], group[2]).score + tasteFit(room, group[1], group[2]).score;
}
function allPairScores(ids) {
  if (!ids.length) return [0];
  return ids.slice(1).flatMap((id, i) => allPairScores(ids.filter((_, j) => j !== 0 && j !== i + 1)).map(score => score + value([ids[0], id])));
}
const ids = Object.keys(room.players), possibilities = [];
for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) for (let c = b + 1; c < ids.length; c++) {
  const triple = [ids[a], ids[b], ids[c]];
  possibilities.push(...allPairScores(ids.filter(id => !triple.includes(id))).map(score => score + value(triple)));
}
const groups = matchingGroups(room);
assert.ok(Math.abs(groups.reduce((score, group) => score + value(group), 0) - Math.max(...possibilities)) < 0.001, 'trio and remaining pairs maximize whole-room fit together');
assert.equal(groups.filter(group => group.length === 3).length, 1);
assert.deepEqual(automaticPairs(room), automaticPairs(structuredClone(room)), 'reconnects and retries keep tie choices stable');
const reversed = { ...room, players: Object.fromEntries(Object.entries(room.players).reverse()) };
assert.deepEqual(automaticPairs(room), automaticPairs(reversed), 'object insertion order does not drive matching');
const large = roomFrom(Array.from({ length: 20 }, (_, i) => tastes[i % tastes.length]));
const start = performance.now();
assert.equal(Object.keys(automaticPairs(large)).length, 20);
console.log(`20-person matching: ${Math.round(performance.now() - start)}ms`);
delete large.players.p20;
const odd = automaticPairs(large);
assert.equal(Object.keys(odd).length, 19);
assert.equal(collaborationGroups({ ...large, pairs: odd }).filter(group => group.length === 3).length, 1);
// New song metadata is saved online and the authoritative server locks the match.
let record = createLobbyRecord('ABCDEF', 'Matching', 'Host', 'host');
for (let i = 0; i < 4; i++) record = joinLobbyRecord(record, `Person ${i}`, `person${i}`).record;
record = updateLobbyRecord(record, 'host', { phase: 'taste' });
for (let i = 0; i < 4; i++) record = updateLobbyRecord(record, `person${i}`, { [`players.p${i + 1}.taste`]: tastes[i] });
const before = automaticPairs(record.room);
record = updateLobbyRecord(record, 'host', { phase: 'flipback', pairs: { p1: 'p2', p2: 'p1', p3: 'p4', p4: 'p3' } });
assert.deepEqual(record.room.pairs, before, 'server applies the actual matcher when Flip Back begins');
const bad = song('Artist', 'Rock'); bad.preview.genre = { unsafe: true };
record = updateLobbyRecord(record, 'host', { phase: 'taste' });
assert.throws(() => updateLobbyRecord(record, 'person0', { 'players.p1.taste': bad }), /preview/);
console.log('PASS: semantic vibes, song/artist/genre evidence, negation, sparse legacy tastes, global pair/trio optimum, stable ties, capacity, validation and server locking.');

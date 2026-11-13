// Run focused behavior checks without adding a test framework or network access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const loader = require('./load-typescript.cjs');

async function main() {
  const load = loader();
  const { BANKS, SLOTS, KITS, DRUM_ROWS, STEPS, drumFile } = load('lib/config.ts');
  const { randomBank, playerBank } = load('lib/packs.ts');
  const { normalizeBeat, emptyBeat, resizeDrums, drumStepCount } = load('lib/beat.ts');
  const { loopLabel } = load('lib/loopLabels.ts');
  const { ALL_LOOPS, BAR_SECONDS } = load('lib/config.ts');
  const { newBattleRoom, battleSample } = load('lib/battle.ts');
  const { BATTLE_SAMPLES } = load('lib/config.ts');
  const nodeCrypto = require('node:crypto');
  assert.equal(Object.keys(BANKS).length, 20, 'twenty distinct complementary packs');
  assert.equal(BATTLE_SAMPLES.length, 8);
  let previousBattle;
  for (let run = 0; run < 32; run++) {
    const next = newBattleRoom(previousBattle);
    const assigned = SLOTS.map(({ id }) => playerBank(undefined, id, next));
    assert.equal(new Set(assigned.map(pack => pack.id)).size, 20, 'no repeated pack within a battle');
    assert.equal(new Set(assigned.flatMap(pack => pack.loops.map(loop => loop.id))).size, 80, 'personal packs share no loop files');
    for (const { id } of SLOTS) {
      const bot = botPlayerForBattle(id, next);
      assert.equal(bot.bank, next.battle.packs[id]);
      assert.ok(Object.values(bot.beat.place.sample).every(loop => battleSample(next).loops.some(sample => sample.id === loop)));
      if (previousBattle) assert.notEqual(next.battle.packs[id], previousBattle.battle.packs[id], 'returning players get a different pack');
    }
    assert.equal(next.battle.sampleId, 'vocal');
    assert.deepEqual(next.battle.sampleQueue, []);
    assert.equal(battleSample(JSON.parse(JSON.stringify(next))).id, battleSample(next).id, 'sample survives reload');
    previousBattle = next;
  }
  assert.equal(new Set(SLOTS.map(slot => slot.color)).size, 20, 'every participant has a unique color');
  assert.equal(battleSample({ players: {}, phase: 'studio' }).id, 'vocal', 'existing rooms keep their original sample');
  function botPlayerForBattle(slot, room) { return load('lib/game.ts').botPlayer(slot, room); }
  const catalog = require('../lib/soundCatalog.json');
  const generated = require('../lib/generatedPeaks.json');
  const hashes = new Set();
  for (const id of Object.keys(generated)) {
    const wav = fs.readFileSync(`public/audio/loops/${id}.wav`);
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt32LE(24), 22050);
    assert.equal(wav.readUInt16LE(34), 16);
    assert.equal((wav.length - 44) / 2, Math.round(BAR_SECONDS * 8 * 22050), 'eight-bar source duration matches transport');
    let peak = 0;
    for (let i = 44; i < wav.length; i += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(i)));
    assert.ok(peak > 1000 && peak < 32767, `${id} is audible and unclipped`);
    assert.equal(generated[id].length, 64);
    hashes.add(nodeCrypto.createHash('sha256').update(wav).digest('hex'));
  }
  assert.equal(hashes.size, catalog.banks.length * 4 + catalog.samples.length * 3, 'generated loops contain different audio, not just different names');
  const beat8 = emptyBeat();
  const beat16 = resizeDrums(beat8, 16);
  assert.equal(drumStepCount(beat16), 16);
  assert.equal(drumStepCount(normalizeBeat(JSON.parse(JSON.stringify(beat16)))), 16);
  assert.deepEqual(resizeDrums(beat16, 8), beat8, 'resolution round trip keeps the original rhythm');
  beat16.steps.hat[1] = 1;
  assert.equal(normalizeBeat(beat16).steps.hat[1], 1, 'fine subdivisions survive save/load');
  const codes = ALL_LOOPS.map(loopLabel);
  assert.equal(new Set(codes).size, codes.length, 'each loop has a distinct compact identifier');
  assert.ok(codes.every(code => code.length <= 3), 'expanded library keeps compact loop codes');
  const engine = load('lib/audio.ts').getEngine();
  engine.T = { getDraw: () => ({ schedule: callback => callback() }) };
  for (const count of [8, 16]) {
    const beat = resizeDrums(emptyBeat(), count);
    beat.steps.kick = Array(count).fill(1);
    beat.steps.snare.fill(0); beat.steps.hat.fill(0); beat.steps.clap.fill(0);
    let hits = 0, lastPosition;
    engine.drumPlayers.set('boombap_kick', { loaded: true, start() { hits++; } });
    const unsubscribe = engine.onPosition((bar, step) => lastPosition = [bar, step]);
    engine.counter = 0; engine.runs = {}; engine.setBeat(beat);
    for (let tick = 0; tick < 16 * 16; tick++) engine.tick(tick * BAR_SECONDS / 16);
    assert.equal(hits, count * 16, `${count}-step beats play the correct number of hits across sixteen bars`);
    assert.deepEqual(lastPosition, [15, count - 1], 'bar duration stays constant across resolutions');
    unsubscribe();
  }
  // A mid-bar pause keeps the transport position and resumes sustained audio
  // from the saved offset; Stop clears it for the next Play.
  const transport = { seconds: BAR_SECONDS * 1.375, pause() {}, start() {}, stop() {}, cancel() {} };
  engine.T = { now: () => 10, start: async () => {}, getTransport: () => transport };
  engine.drumPlayers.clear();
  const starts = [];
  engine.lanePlayers.set('shared_vox_chop', { loaded: true, stop() {}, start(...args) { starts.push(args); } });
  const sustained = emptyBeat();
  sustained.place.sample = { 1: 'shared_vox_chop', 2: 'shared_vox_chop' };
  engine.setBeat(sustained); engine.playing = true;
  engine.pause();
  assert.equal(engine.paused, true);
  assert.equal(transport.seconds, BAR_SECONDS * 1.375);
  await engine.resume();
  assert.equal(engine.playing, true);
  assert.equal(engine.counter, 22);
  assert.equal(starts.length, 1);
  assert.ok(Math.abs(starts[0][1] - BAR_SECONDS * 1.375) < 1e-8, 'sustained loop resumes at the saved source offset');
  engine.stop();
  assert.equal(transport.seconds, 0);
  assert.equal(engine.paused, false);
  const { automaticPairs, collaborationGroups, normalizeTags, tagOverlap, botPlayer, botFlip, matchupsFor, standings, pairKey } = load('lib/game.ts');
  const { createVoting, votingBeat, votePatch, feedbackFor } = load('lib/voting.ts');
  assert.equal(SLOTS.length, 20);
  for (let n = 3; n <= 20; n++) {
    const players = Object.fromEntries(SLOTS.slice(0, n).map(({ id }) => [id, botPlayer(id)]));
    const battle = { phase: 'vote', phaseEndsAt: null, players, pairs: null, updatedAt: 0 };
    battle.voting = createVoting(battle);
    const rounds = Math.min(6, (n - 1) * (n - 2) / 2);
    const exposure = {}, left = {}, right = {}, opponents = {};
    for (const voter of battle.voting.slots) {
      const matchups = matchupsFor(battle, voter);
      assert.equal(matchups.length, rounds);
      assert.equal(new Set(matchups.map(([a, b]) => pairKey(a, b))).size, rounds, 'no repeated matchup for one voter');
      players[voter].votes = {};
      for (const [a, b] of matchups) {
        assert.notEqual(a, b); assert.ok(a !== voter && b !== voter, 'no self-voting');
        exposure[a] = (exposure[a] || 0) + 1; exposure[b] = (exposure[b] || 0) + 1;
        left[a] = (left[a] || 0) + 1; right[b] = (right[b] || 0) + 1;
        (opponents[a] ||= new Set()).add(b); (opponents[b] ||= new Set()).add(a);
        players[voter].votes[pairKey(a, b)] = a;
      }
    }
    for (const id of battle.voting.slots) {
      assert.equal(exposure[id], rounds * 2, 'every submission gets equal exposure');
      assert.equal(left[id], rounds); assert.equal(right[id], rounds, 'A/B exposure is balanced');
      if (n === 20) assert.equal(opponents[id].size, 12, '20-player beats face twelve distinct opponents');
    }
    const rows = standings(battle);
    assert.ok(rows.every(row => row.judged === rounds * 2 && row.assigned === rounds * 2));
    assert.ok(rows.every(row => row.rank === 1 && row.rate === 0.5), 'equal results share a rank');
    assert.equal(rows.reduce((sum, row) => sum + row.wins, 0), n * rounds);
    const finishedVotes = players.p1.votes;
    players.p1.votes = {};
    const incomplete = standings(battle);
    assert.equal(incomplete.reduce((sum, row) => sum + row.judged, 0), 2 * (n * rounds - rounds));
    assert.ok(incomplete.every(row => row.rate === (row.judged ? row.wins / row.judged : 0)), 'incomplete voting uses actual valid judgments');
    players.p1.votes = { ...finishedVotes, bogus: 'p1' };
    assert.deepEqual(standings(battle), rows, 'unassigned votes never count');
    const before = JSON.stringify(battle.voting);
    players.p1.submitted = false; players.p1.beat = emptyBeat();
    assert.equal(JSON.stringify(battle.voting), before, 'changes after voting starts do not alter locked beats');
    assert.ok(Object.keys(votingBeat(battle, 'p1').place.sample).length);
    const pairs = automaticPairs(battle);
    assert.equal(Object.keys(pairs).length, n, 'every room size gets a remix assignment');
    for (const [a, b] of Object.entries(pairs)) assert.notEqual(a, b);
    const groups = collaborationGroups({ ...battle, pairs });
    assert.equal(groups.flat().length, n);
    assert.ok(groups.every(group => group.length === 2 || group.length === 3));
  }
  {
  const feedbackRoom = { phase: 'vote', phaseEndsAt: null, players: Object.fromEntries(SLOTS.slice(0, 4).map(({ id }) => [id, botPlayer(id)])), pairs: null, updatedAt: 0 };
  feedbackRoom.voting = createVoting(feedbackRoom);
  const [a, b] = matchupsFor(feedbackRoom, 'p1')[0];
  const patch = votePatch(feedbackRoom, 'p1', a, b, a, { [a]: '  Love the feeling!  ', [b]: 'Try a quieter ending.' });
  assert.equal(patch[`players.p1.comments.${a}`], 'Love the feeling!');
  assert.equal(patch[`players.p1.comments.${b}`], 'Try a quieter ending.');
  feedbackRoom.players.p1.comments = { [a]: patch[`players.p1.comments.${a}`], [b]: patch[`players.p1.comments.${b}`] };
  feedbackRoom.players.p1.votes = { [pairKey(a, b)]: a };
  assert.deepEqual(feedbackFor(feedbackRoom, a), [], 'comments stay hidden during blind voting');
  feedbackRoom.phase = 'reveal';
  assert.deepEqual(feedbackFor(feedbackRoom, a), [{ author: 'p1', text: 'Love the feeling!' }]);
  assert.equal(feedbackFor(feedbackRoom, b)[0].text, 'Try a quieter ending.', 'the unpicked beat receives its comment too');
  assert.deepEqual(feedbackFor(feedbackRoom, 'p1'), [], 'comments route only to the intended submission');
  feedbackRoom.phase = 'vote';
  assert.throws(() => votePatch(feedbackRoom, 'p1', 'p1', a, a, {}));
  assert.equal(votePatch(feedbackRoom, 'p1', a, b, a, { [a]: ' ' })[`players.p1.comments.${a}`], null);
  assert.equal(votePatch(feedbackRoom, 'p1', a, b, a, { [a]: 'x'.repeat(400) })[`players.p1.comments.${a}`].length, 280);
  }
  const { resolveCode } = load('lib/session.ts');
  assert.deepEqual(resolveCode('PLAYER20'), { role: 'player', slot: 'p20' });
  assert.equal(resolveCode('PLAYER21'), null);
  const { songEmbed, linkedSong } = load('lib/songs.ts');
  const { demoTaste, upgradeDemoTaste } = load('lib/demoTaste.ts');
  const botTags = SLOTS.flatMap(({ id }) => normalizeTags(demoTaste(id).tags));
  assert.equal(new Set(botTags).size, botTags.length, 'bots must never share a vibe tag');
  assert.ok(botTags.every(tag => !/drum|piano|guitar|disco|groove|filter|instrument/.test(tag)), 'bot tags describe feelings rather than musical elements');
  const artists = SLOTS.slice(0, 4).map(({ id }) => demoTaste(id).song.split(' – ')[0]);
  assert.equal(new Set(artists).size, 4, 'the demo catalog has four different artists');
  for (const { id } of SLOTS) {
    const bot = botPlayer(id);
    assert.equal(bot.taste.tags.length, 2);
    assert.equal(normalizeTags(bot.taste.tags).length, 2);
    assert.ok(bot.taste.tags.every(tag => tag.includes(' ')), 'demo tags demonstrate custom phrases');
    assert.equal(bot.taste.preview.title, bot.taste.song);
    assert.ok(songEmbed(bot.taste.preview), 'every new demo has an embeddable preview');
    const legacy = { ...bot, demoTasteVersion: undefined, taste: { song: 'Old song', tags: ['chill', 'hype'] }, votes: { p2_p3: 'p2' }, teamUp: true };
    const upgraded = upgradeDemoTaste(legacy, id);
    assert.deepEqual(upgraded.taste, demoTaste(id));
    assert.strictEqual(upgraded.beat, legacy.beat);
    assert.strictEqual(upgraded.votes, legacy.votes);
    assert.equal(upgraded.bank, legacy.bank);
    assert.equal(upgraded.teamUp, true);
    assert.strictEqual(upgradeDemoTaste(upgraded, id), upgraded, 'migration is idempotent');
    const human = { ...legacy, bot: false };
    assert.strictEqual(upgradeDemoTaste(human, id), human, 'human Taste Drops never change');
  }
  assert.deepEqual(normalizeTags([' #Late   Night ', 'LATE NIGHT', ' Dreamy ']), ['late night', 'dreamy']);
  assert.deepEqual(normalizeTags(['', ' ### ']), []);
  const room = { phase: 'taste', phaseEndsAt: null, updatedAt: 0, pairs: null, players: {} };
  const tags = [['dark', 'bouncy'], ['chill', 'dreamy'], ['#DARK', 'BOUNCY'], ['CHILL', 'dreamy']];
  for (let i = 0; i < 4; i++) room.players[SLOTS[i].id] = { name: `Tester ${i}`, joinedAt: 1, taste: { song: 'A song', tags: tags[i] } };
  assert.deepEqual(tagOverlap(room, 'p1', 'p3'), ['dark', 'bouncy']);
  room.pairs = automaticPairs(room);
  assert.deepEqual(room.pairs, { p1: 'p3', p3: 'p1', p2: 'p4', p4: 'p2' });
  assert.deepEqual(collaborationGroups(room), [['p1', 'p3'], ['p2', 'p4']]);
  delete room.players.p4;
  room.pairs = automaticPairs(room);
  assert.equal(Object.keys(room.pairs).length, 3);
  assert.equal(new Set(Object.values(room.pairs)).size, 3);
  for (const [a, b] of Object.entries(room.pairs)) assert.notEqual(a, b);
  assert.deepEqual(collaborationGroups(room), [['p1', 'p2', 'p3']]);
  delete room.players.p3;
  assert.deepEqual(automaticPairs(room), { p1: 'p2', p2: 'p1' });
  delete room.players.p2;
  assert.deepEqual(automaticPairs(room), {});
  assert.deepEqual(resolveCode(' player1 '), { role: 'player', slot: 'p1' });
  assert.deepEqual(resolveCode('peach'), { role: 'player', slot: 'p1' });

  const originalRandom = crypto.getRandomValues;
  try {
    for (const [i, id] of Object.keys(BANKS).entries()) {
      crypto.getRandomValues = values => { values[0] = Math.floor((i + 0.5) / Object.keys(BANKS).length * 0x100000000); return values; };
      assert.equal(randomBank(), id);
      const player = botPlayer('p1');
      assert.equal(player.bank, id, 'the same seat can receive every pack');
      assert.equal(playerBank(player, 'p1').id, id);
      assert.equal(player.beat.drumOn.length, 16);
      for (const lane of ['chords', 'melody', 'bass', 'fx']) {
        for (const loop of Object.values(player.beat.place[lane])) assert.ok(BANKS[id].loops.some(l => l.id === loop));
      }
      room.players.p1 = player;
      const flip = botFlip(room, 'p1', 'p2');
      assert.ok(BANKS[id].loops.some(l => l.id === flip.beat.place.melody['0']));
      assert.equal(playerBank(JSON.parse(JSON.stringify(player)), 'p1').id, id);
    }
  } finally { crypto.getRandomValues = originalRandom; }
  assert.equal(playerBank({ name: 'Old player', joinedAt: 0 }, 'p3').id, 'mint');
  for (const bank of Object.values(BANKS)) for (const loop of bank.loops) assert.ok(fs.existsSync(`public${loop.file}`));
  assert.equal(KITS.length, 8);
  for (const kit of KITS) {
    assert.equal(normalizeBeat({ kit: kit.id }).kit, kit.id);
    for (const row of DRUM_ROWS) {
      assert.equal(kit.groove[row.id].length, STEPS);
      const wav = fs.readFileSync(`public${drumFile(kit.id, row.id)}`);
      assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
      assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
      if (['techno', 'breakbeat', 'garage', 'synthwave'].includes(kit.id)) {
        assert.equal(wav.readUInt32LE(24), 44100);
        let peak = 0;
        for (let i = 44; i < wav.length; i += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(i)));
        assert.ok(peak > 1000 && peak < 32767, 'synthesized audio is non-silent and unclipped');
      }
    }
  }

  const appleURL = 'https://music.apple.com/us/album/ivy/1146195596?i=1146195598&uo=4';
  assert.equal(songEmbed({ provider: 'apple', title: 'Ivy', url: appleURL }), 'https://embed.music.apple.com/us/album/ivy/1146195596?i=1146195598');
  for (const url of ['https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://m.youtube.com/shorts/dQw4w9WgXcQ']) {
    assert.equal(linkedSong(url, 'A song').provider, 'youtube');
    assert.ok(songEmbed(linkedSong(url, 'A song')).startsWith('https://www.youtube-nocookie.com/embed/'));
  }
  for (const url of ['javascript:alert(1)', 'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ', 'https://example.com/a', 'https://youtu.be/invalid']) assert.equal(linkedSong(url, 'A song'), null);

  // The real API handler with mocked provider responses, including an outage.
  const { GET } = load('app/api/song-search/route.ts');
  const originalFetch = global.fetch;
  const request = q => ({ nextUrl: new URL(`http://localhost/api/song-search?q=${encodeURIComponent(q)}`) });
  try {
    assert.equal((await GET(request('a'))).status, 400);
    global.fetch = async url => {
      assert.equal(url.hostname, 'itunes.apple.com');
      return Response.json({ results: [
        { artistName: 'Frank Ocean', trackName: 'Ivy', trackViewUrl: appleURL },
        { artistName: 'Fake', trackName: 'Unsafe', trackViewUrl: 'https://example.com/embed' }
      ] });
    };
    const response = await GET(request('Frank Ocean – Ivy'));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).results.length, 1);
    global.fetch = async () => Response.json({ results: [] });
    assert.deepEqual((await (await GET(request('Missing song'))).json()).results, []);
    global.fetch = async () => { throw new Error('offline'); };
    assert.equal((await GET(request('Frank Ocean – Ivy'))).status, 503);
  } finally { global.fetch = originalFetch; }

  // Two separate store instances model two browser tabs sharing local storage.
  const storage = new Map(), channels = [];
  global.localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
  global.window = { addEventListener() {} };
  global.BroadcastChannel = class {
    constructor(name) { this.name = name; channels.push(this); }
    addEventListener(_, callback) { this.callback = callback; }
    postMessage() { for (const channel of channels) if (channel !== this && channel.name === this.name) channel.callback?.(); }
  };
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY = '';
  const a = loader()('lib/store.ts').getStore(), b = loader()('lib/store.ts').getStore();
  let stateA, stateB;
  a.subscribe(state => stateA = state); b.subscribe(state => stateB = state);
  assert.deepEqual(stateA.battle, stateB.battle, 'tabs agree on the initial sample and pack assignments');
  await a.update({ 'players.p1': { name: 'Alex', bank: 'sky', joinedAt: 1 } });
  await b.update({ 'players.p2': { name: 'Sam', bank: 'peach', joinedAt: 2 } });
  await a.update({ 'players.p1.taste': { song: 'Ivy', tags: ['dreamy', 'late night'], preview: { provider: 'apple', title: 'Ivy', url: appleURL } } });
  assert.deepEqual(stateA.players, stateB.players);
  assert.equal(stateB.players.p1.bank, 'sky');
  assert.ok(stateA.players.p2);
  assert.ok(songEmbed(stateB.players.p1.taste.preview));
  await a.update({ 'players.p3': { name: 'Saved demo', bot: true, bank: 'mint', joinedAt: 3, taste: { song: 'Legacy song', tags: ['dark', 'chill'] } } });
  assert.deepEqual(stateA.players.p3.taste, demoTaste('p3'));
  assert.deepEqual(stateB.players.p3.taste, demoTaste('p3'), 'saved demo upgrades reach other local tabs');
  const reloaded = loader()('lib/store.ts').getStore();
  let restored;
  reloaded.subscribe(room => restored = room);
  assert.deepEqual(restored.players.p3.taste, demoTaste('p3'), 'saved bots upgrade on reload without resetting the room');
  const localBattle = { phase: 'vote', phaseEndsAt: null, players: Object.fromEntries(SLOTS.map(({ id }) => [id, botPlayer(id)])), pairs: null, updatedAt: 0 };
  const frozen = createVoting(localBattle);
  await a.update({ phase: 'vote', players: localBattle.players, voting: frozen });
  const [first, second] = frozen.schedule.p20[0];
  await b.update(votePatch(stateB, 'p20', first, second, second, { [first]: 'This feels hopeful.', [second]: 'The ending surprised me.' }));
  assert.deepEqual(stateA.voting, stateB.voting, 'voting schedule and frozen beats sync between tabs');
  assert.equal(stateA.players.p20.comments[first], 'This feels hopeful.');
  assert.deepEqual(feedbackFor(stateA, first), []);
  await a.update({ phase: 'reveal' });
  assert.equal(feedbackFor(stateB, first).find(note => note.author === 'p20').text, 'This feels hopeful.', 'a vote and comment reach the correct creator across tabs');
  const previousSetup = stateA.battle;
  await a.reset();
  assert.equal(stateB.voting, undefined, 'reset removes the locked voting round');
  assert.equal(stateB.battle.sampleId, 'vocal');
  assert.deepEqual(stateA.battle, stateB.battle, 'new battle sample and packs sync across tabs');
  assert.equal(new Set(Object.values(stateB.battle.packs)).size, 20);
  await b.update({ 'players.p1.beat': emptyBeat() }, previousSetup.id);
  assert.equal(stateA.players.p1, undefined, 'a pending autosave from the old battle cannot resurrect its beat after reset');
  await b.update({ 'players.p1': botPlayerForBattle('p1', stateB) }, stateB.battle.id);
  assert.equal(stateA.players.p1.bank, stateB.battle.packs.p1, 'current battle writes still succeed');
  const { appendChat, chatIsOpen, chatMessages, CHAT_HISTORY_LIMIT } = load('lib/chat.ts');
  for (const phase of ['lobby', 'reveal', 'flipback', 'teamup', 'done']) assert.equal(chatIsOpen(phase), true);
  for (const phase of ['taste', 'studio', 'vote']) assert.equal(chatIsOpen(phase), false);
  const chatBattle = stateA.battle.id;
  await a.update({ players: Object.fromEntries(SLOTS.map(({ id }) => [id, { name: `Creator ${id}`, joinedAt: 1 }])) });
  await Promise.all([
    ...SLOTS.map(({ id }, index) => (index % 2 ? a : b).sendChat(id, `Hello from ${id}`, chatBattle)),
    a.update({ 'players.p1.beat': emptyBeat() }, chatBattle),
  ]);
  assert.equal(chatMessages(stateA).length, 20, 'concurrent chat sends do not lose messages');
  assert.deepEqual(stateA.chat, stateB.chat, 'chat syncs to other local tabs');
  assert.equal(new Set(chatMessages(stateA).map(message => message.sequence)).size, 20, 'message ordering does not depend on client clock');
  assert.ok(stateB.players.p1.beat, 'chat and beat writes preserve one another');
  await a.sendChat('host', '  Welcome, everyone!  ', chatBattle);
  assert.equal(chatMessages(stateB).at(-1).name, 'Facilitator');
  assert.equal(chatMessages(stateB).at(-1).text, 'Welcome, everyone!');
  await assert.rejects(a.sendChat('p1', ' ', chatBattle));
  await assert.rejects(a.sendChat('p1', 'x'.repeat(401), chatBattle));
  await assert.rejects(a.sendChat('p99', 'Hello', chatBattle));
  const demoRoom = { ...stateA, players: { p1: botPlayer('p1') } };
  assert.throws(() => appendChat(demoRoom, 'p1', 'Fake hello', chatBattle, 'bot-message'));
  await a.update({ phase: 'vote' });
  await assert.rejects(b.sendChat('p2', 'Spoiler', chatBattle), /reveal/);
  assert.equal(chatMessages(stateB).length, 21);
  await a.update({ phase: 'reveal' });
  await b.sendChat('p2', 'Loved hearing everyone’s flips!', chatBattle);
  assert.equal(chatMessages(stateA).length, 22, 'the lobby conversation resumes after voting');
  let chatReload;
  loader()('lib/store.ts').getStore().subscribe(room => chatReload = room);
  assert.deepEqual(chatReload.chat, stateA.chat, 'history survives reloading a tab');
  let capped = stateA;
  for (let i = 0; i < CHAT_HISTORY_LIMIT + 5; i++) capped = { ...capped, ...appendChat(capped, 'host', `Message ${i}`, chatBattle, `history-${i}`, 1) };
  assert.equal(chatMessages(capped).length, CHAT_HISTORY_LIMIT, 'bounded chat history stays small');
  assert.equal(chatMessages(capped).at(-1).text, `Message ${CHAT_HISTORY_LIMIT + 4}`);
  await a.reset();
  assert.equal(chatMessages(stateB).length, 0, 'a new battle clears its conversation');
  await assert.rejects(b.sendChat('host', 'Late old message', chatBattle), /new battle/);
  assert.equal(chatMessages(stateA).length, 0);
  console.log('PASS: original vocal chop, twenty unique player colors, twenty unique packs, generated audio integrity, saved-room compatibility, 3–20-player voting fairness and pairing, feedback routing, concurrent room chat, custom tags, eight kits and WAVs, preview URLs, API success/outage, and local tab sync.');
}
// Node's Web Locks may leave only pending promises; keep the process alive until
// every asynchronous assertion finishes instead of reporting a false success.
const keepAlive = setInterval(() => {}, 1000);
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => clearInterval(keepAlive));

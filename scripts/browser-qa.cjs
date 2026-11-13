// Fresh browser profiles only. Online API requests use the real handlers with a
// test-only repository; this never creates Firebase data or publishes a website.
const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
const loader = require('./load-typescript.cjs');
const load = loader();
const { lobbyHttp } = load('lib/server/lobbyHttp.ts');
const { botBeat } = load('lib/game.ts');
const { battleSample } = load('lib/battle.ts');
const base = process.env.FLIPTHIS_QA_URL || 'http://127.0.0.1:3000';
const records = new Map(), queues = new Map();
const offline = new WeakSet();
const repository = {
  async read(code) { return records.has(code) ? structuredClone(records.get(code)) : null; },
  async create(code, record) { if (records.has(code)) return false; records.set(code, structuredClone(record)); return true; },
  async transact(code, operation) {
    const task = (queues.get(code) || Promise.resolve()).then(() => {
      const change = operation(records.has(code) ? structuredClone(records.get(code)) : null);
      records.set(code, structuredClone(change.record)); return structuredClone(change.result);
    });
    queues.set(code, task.catch(() => {})); return task;
  },
};
const http = lobbyHttp(repository);
async function waitFor(check, label, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(`Timed out: ${label}`);
}
async function intercept(context, online) {
  await context.route('**/api/lobbies**', async route => {
    if (offline.has(context)) return route.abort('failed');
    const incoming = route.request(), url = new URL(incoming.url());
    if (!online) return route.fulfill({ json: { online: false } });
    if (url.pathname === '/api/lobbies' && incoming.method() === 'GET') return route.fulfill({ json: { online: true } });
    const request = new Request(incoming.url(), { method: incoming.method(), headers: incoming.headers(), ...(incoming.postData() ? { body: incoming.postData() } : {}) });
    const response = url.pathname === '/api/lobbies' ? await http.create(request) : await http.room(request, url.pathname.split('/').at(-1));
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
  });
  // Fonts are irrelevant to behavior and should not require outside networking.
  await context.route('https://fonts.googleapis.com/**', route => route.abort());
  await context.route('https://fonts.gstatic.com/**', route => route.abort());
}
async function create(page, label) {
  await page.goto(base);
  await page.getByRole('button', { name: 'Create a lobby', exact: true }).click();
  await page.getByLabel('Lobby name').fill(label);
  await page.getByLabel('Your name', { exact: true }).fill('Host');
  await page.getByRole('button', { name: 'Create lobby and host', exact: true }).click();
  await page.waitForURL('**/host?room=*');
  await waitFor(() => page.getByLabel('Lobby invite link').inputValue().then(value => !!value), 'invite link');
  return (await page.getByLabel('Lobby invite link').inputValue());
}
async function join(page, link, name) {
  await page.goto(link);
  await page.getByLabel('Your name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Join battle', exact: true }).click();
  try { await page.waitForURL('**/play?room=*', { timeout: 10000 }); }
  catch (error) {
    console.log('Join diagnostic:', await page.evaluate(() => {
      const raw = sessionStorage.getItem('flipthis.session'); const session = raw ? JSON.parse(raw) : {};
      return { url: location.href, role: session.role, name: session.name, slot: session.slot, roomId: session.roomId, text: document.body.innerText.slice(0, 1200) };
    }));
    throw error;
  }
  await page.getByRole('heading', { name: `You’re in, ${name}.` }).waitFor();
}
async function identity(page) { return page.evaluate(() => JSON.parse(sessionStorage.getItem('flipthis.session'))); }
async function phase(host, label) { await host.getByRole('button', { name: `Next: ${label}`, exact: true }).click(); }
async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  try {
    const local = await browser.newContext(); await intercept(local, false);
    const localHost = await local.newPage(), localPlayer = await local.newPage();
    for (const page of [localHost, localPlayer]) page.on('pageerror', error => errors.push(error.message));
    const localLink = await create(localHost, 'Local practice');
    await join(localPlayer, localLink, 'Local Maya');
    await localPlayer.getByLabel('Your message', { exact: true }).fill('Hello from local practice');
    await localPlayer.getByRole('button', { name: 'Send to room' }).click();
    await localHost.getByText('Hello from local practice', { exact: true }).waitFor();
    const localIdentity = await identity(localPlayer);
    await localPlayer.reload();
    await localPlayer.getByRole('heading', { name: 'You’re in, Local Maya.' }).waitFor();
    assert.equal((await identity(localPlayer)).slot, localIdentity.slot);
    await local.close();
    console.log('PASS: local create, invite, automatic seat, chat sync, and reload.');

    const hostContext = await browser.newContext(), mayaContext = await browser.newContext(), raeContext = await browser.newContext();
    for (const context of [hostContext, mayaContext, raeContext]) await intercept(context, true);
    const host = await hostContext.newPage(), maya = await mayaContext.newPage(), rae = await raeContext.newPage();
    for (const page of [host, maya, rae]) page.on('pageerror', error => errors.push(error.message));
    const link = await create(host, 'Online class battle');
    assert.ok(await host.locator('.host-room-code strong').evaluate(el => parseFloat(getComputedStyle(el).fontSize)) >= 36, 'projected room code is large');
    await join(maya, link, 'Maya'); await join(rae, link, 'Rae');
    const m = await identity(maya), r = await identity(rae), h = await identity(host);
    assert.notEqual(m.slot, r.slot); assert.ok(m.transport === 'online');
    const denied = await maya.evaluate(async ({ code, token }) => {
      const response = await fetch(`/api/lobbies/${code}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ patch: { phase: 'done' } }) });
      return response.status;
    }, { code: m.roomId, token: m.token });
    assert.equal(denied, 403);
    await host.getByLabel('Your message', { exact: true }).fill('Welcome to the online lobby');
    await host.getByRole('button', { name: 'Send to room' }).click();
    await maya.getByText('Welcome to the online lobby', { exact: true }).waitFor();
    // A third real identity supplies a playable three-person battle.
    const thirdResponse = await http.room(new Request(`${base}/api/lobbies/${m.roomId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'join', name: 'Sam' }) }), m.roomId);
    const third = (await thirdResponse.json()).session;
    await phase(host, 'Taste Drop');
    await maya.getByLabel('Song', { exact: true }).fill('A favorite song');
    await maya.getByLabel('Vibe 1', { exact: true }).fill('quiet wonder');
    await maya.getByLabel('Vibe 2', { exact: true }).fill('shared joy');
    await maya.getByRole('button', { name: 'Drop it on the wall' }).click();
    await maya.getByText('Your taste is on the wall.', { exact: false }).waitFor();
    await phase(host, 'Battle Sample');
    await maya.getByRole('button', { name: 'I’m ready for the battle', exact: true }).waitFor();
    assert.equal(await host.getByRole('button', { name: 'Next: Flip', exact: true }).isDisabled(), true);
    const audio = maya.getByLabel('Listen to the battle sample');
    assert.ok((await audio.getAttribute('src')).endsWith('/shared_vox_chop.wav'));
    await host.screenshot({ path: '/private/tmp/flipthis-sample-host.png', fullPage: true });
    await maya.screenshot({ path: '/private/tmp/flipthis-sample-player.png', fullPage: true });
    await maya.getByRole('button', { name: 'I’m ready for the battle', exact: true }).click();
    await maya.reload();
    await maya.getByRole('button', { name: 'Ready! Click to unready', exact: true }).waitFor();
    await rae.getByRole('button', { name: 'I’m ready for the battle', exact: true }).click();
    const readyResponse = await http.room(new Request(`${base}/api/lobbies/${m.roomId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${third.token}` }, body: JSON.stringify({ patch: { [`players.${third.slot}.sampleReady`]: true } }) }), m.roomId);
    assert.equal(readyResponse.status, 200);
    await phase(host, 'Flip');
    await maya.getByRole('heading', { name: 'Arrangement · 16 bars' }).waitFor();
    await maya.locator('.loop-card').first().click();
    await maya.getByRole('button', { name: /Place .* in Sample bar 1$/ }).click();
    await maya.getByRole('button', { name: /Place .* in Sample bar 2$/ }).click();
    await maya.getByRole('button', { name: '16 steps', exact: true }).click();
    const layout = await maya.locator('.seq-row').first().evaluate(row => {
      const buttons = [...row.querySelectorAll('button')], rect = row.getBoundingClientRect();
      return { count: buttons.length, rows: new Set(buttons.map(button => Math.round(button.getBoundingClientRect().top))).size, fits: buttons.every(button => button.getBoundingClientRect().right <= rect.right + 1) };
    });
    assert.deepEqual(layout, { count: 16, rows: 1, fits: true });
    await waitFor(() => records.get(m.roomId).room.players[m.slot].beat?.steps.kick.length === 16, 'autosave');
    await maya.getByRole('button', { name: 'Play beat', exact: true }).click();
    await maya.waitForTimeout(2300);
    await maya.getByRole('button', { name: 'Pause beat', exact: true }).click();
    const pausedBar = await maya.locator('[role="status"]').filter({ hasText: 'Paused · Bar' }).innerText();
    assert.ok(!pausedBar.includes('Bar 1/'), 'playback advanced beyond the first bar');
    await maya.waitForTimeout(500);
    assert.equal(await maya.locator('[role="status"]').filter({ hasText: 'Paused · Bar' }).innerText(), pausedBar);
    await maya.getByRole('button', { name: 'Resume beat', exact: true }).click();
    await maya.waitForTimeout(300);
    await maya.getByRole('button', { name: 'Stop beat and return to start', exact: true }).click();
    await maya.getByText('Ready · Bar 1/16', { exact: true }).waitFor();
    await maya.getByRole('button', { name: 'Play beat', exact: true }).click();
    await maya.waitForTimeout(300);
    await maya.getByText('Playing · Bar 1/16', { exact: true }).waitFor();
    await maya.getByRole('button', { name: 'Stop beat and return to start', exact: true }).click();

    await maya.reload();
    await maya.getByRole('heading', { name: 'Drum sequencer · 16 steps' }).waitFor();
    assert.equal((await identity(maya)).slot, m.slot);
    offline.add(mayaContext);
    await maya.locator('.loop-card').first().click();
    await maya.getByRole('button', { name: /Place .* in Sample bar 3$/ }).click();
    await maya.waitForTimeout(600);
    assert.ok(await maya.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('flipthis.draft.'))), 'offline drafts are stored on the device');
    offline.delete(mayaContext);
    await maya.reload();
    await maya.getByRole('heading', { name: 'Drum sequencer · 16 steps' }).waitFor();
    await waitFor(() => !!records.get(m.roomId).room.players[m.slot].beat?.place.sample['2'], 'offline draft recovery after reload');
    await maya.getByRole('button', { name: 'Submit beat', exact: true }).click();
    for (const session of [r, third]) {
      const room = records.get(m.roomId).room;
      const beat = botBeat(session.slot, room.battle.packs[session.slot], battleSample(room).loops);
      const response = await http.room(new Request(`${base}/api/lobbies/${m.roomId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` }, body: JSON.stringify({ patch: { [`players.${session.slot}.beat`]: beat, [`players.${session.slot}.submitted`]: true } }) }), m.roomId);
      assert.equal(response.status, 200);
    }
    await waitFor(() => host.getByRole('button', { name: 'Next: Vote', exact: true }).isEnabled(), 'three submissions');
    await phase(host, 'Vote');
    await maya.getByRole('heading', { name: /Matchup 1 of 1/ }).waitFor();
    assert.equal(await maya.getByRole('heading', { name: 'Talk about the flips' }).count(), 0);
    await maya.getByLabel('A note for Beat A’s creator').fill('This makes me feel hopeful.');
    await maya.getByLabel('A note for Beat B’s creator').fill('I liked the contrast at the end.');
    await maya.getByRole('button', { name: 'Pick Beat A', exact: true }).click();
    await maya.locator('.vote-confirm').waitFor();
    await maya.getByRole('heading', { name: 'All 1 votes in' }).waitFor();
    await phase(host, 'Reveal');
    await rae.getByRole('heading', { name: 'Comments on every submission' }).waitFor();
    await waitFor(() => rae.getByText(/This makes me feel hopeful.|I liked the contrast at the end./).count().then(count => count > 0), 'revealed feedback');
    await maya.getByRole('heading', { name: 'Talk about the flips' }).waitFor();
    await maya.getByText('Welcome to the online lobby', { exact: true }).waitFor();
    await phase(host, 'Flip Back');
    await maya.getByRole('button', { name: 'Done', exact: true }).waitFor();
    for (let step = 1; step <= 6; step++) await maya.getByRole('button', { name: `Kick step ${step}`, exact: true }).click();
    await maya.getByText('6 edits · unlimited', { exact: true }).waitFor();
    await maya.getByRole('button', { name: 'Done', exact: true }).click();
    await waitFor(() => records.get(m.roomId).room.players[m.slot].flip?.done, 'remix save');
    await phase(host, 'Team Up');
    await maya.getByRole('button', { name: 'Yes, form a crew', exact: true }).click();
    assert.equal(await maya.getByRole('heading', { name: 'Your crew chat', exact: true }).count(), 0);
    await rae.getByRole('button', { name: 'Yes, form a crew', exact: true }).click();
    const teamResponse = await http.room(new Request(`${base}/api/lobbies/${m.roomId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${third.token}` }, body: JSON.stringify({ patch: { [`players.${third.slot}.teamUp`]: true } }) }), m.roomId);
    assert.equal(teamResponse.status, 200);
    await maya.getByRole('heading', { name: 'Your crew chat', exact: true }).waitFor();
    await maya.getByLabel('Message your crew', { exact: true }).fill('Let’s make another beat together');
    await maya.getByRole('button', { name: 'Send to crew', exact: true }).click();
    await rae.getByText('Let’s make another beat together', { exact: true }).waitFor();
    assert.equal(await host.getByText('Let’s make another beat together', { exact: true }).count(), 0);
    await phase(host, 'Crews');
    await rae.reload();
    await rae.getByText('Let’s make another beat together', { exact: true }).waitFor();
    assert.equal(await maya.getByRole('button', { name: 'What have you been listening to lately?' }).count(), 0);
    await host.getByRole('button', { name: 'New battle / reset', exact: true }).click();
    await host.getByRole('dialog').getByRole('button', { name: 'New battle / reset', exact: true }).click();
    await maya.getByRole('heading', { name: 'You’re in, Maya.' }).waitFor();
    await maya.reload(); await maya.getByRole('heading', { name: 'You’re in, Maya.' }).waitFor();
    assert.equal((await identity(maya)).slot, m.slot);
    assert.equal(await host.getByLabel('Lobby invite link').inputValue(), link);
    await host.screenshot({ path: '/private/tmp/flipthis-online-lobby.png', fullPage: true });
    assert.deepEqual(errors, [], 'no uncaught browser exceptions');
    console.log('PASS: three independent online browser identities, host-only controls, chat, taste, shared-sample readiness and reconnect, beat autosave and reload, 16-step layout, pause/resume and stop-to-start playback, balanced voting animation, public feedback on all submissions, unlimited remix, private trio chat and reconnect, and reset/reconnect.');
    await hostContext.close(); await mayaContext.close(); await raeContext.close();
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

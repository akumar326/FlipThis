// Local practice only; real public Spotify metadata, no Firebase writes/deployment.
const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const base = process.env.FLIPTHIS_QA_URL || 'http://127.0.0.1:3000';
const spotify = 'https://open.spotify.com/track/3U4isOIWM3VvDubwSI3y7a';
const cell = (page, lane, bar) => page.locator(`[data-arrangement-lane="${lane}"][data-bar="${bar - 1}"]`);
async function paint(page, lane, first, last) {
  const start = cell(page, lane, first); await start.scrollIntoViewIfNeeded();
  const from = await start.boundingBox(), to = await cell(page, lane, last).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: Math.abs(last - first) * 5 });
  await page.mouse.up();
}
async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  try {
    const context = await browser.newContext();
    await context.route('**/api/lobbies', route => route.fulfill({ json: { online: false } }));
    await context.route('https://fonts.googleapis.com/**', route => route.abort());
    await context.route('https://fonts.gstatic.com/**', route => route.abort());
    const host = await context.newPage(), player = await context.newPage(), peer = await context.newPage();
    for (const page of [host, player, peer]) page.on('pageerror', error => errors.push(error.message));
    await host.goto(base);
    await host.getByRole('button', { name: 'Create a lobby', exact: true }).click();
    await host.getByLabel('Lobby name').fill('Studio rehearsal');
    await host.getByLabel('Your name', { exact: true }).fill('Host');
    await host.getByRole('button', { name: 'Create lobby and host' }).click();
    await expect(host.getByLabel('Lobby invite link')).toHaveValue(/^https?:\/\//);
    const invite = await host.getByLabel('Lobby invite link').inputValue();
    for (const [page, name] of [[player, 'Maya'], [peer, 'Rae']]) {
      await page.goto(invite); await page.getByLabel('Your name', { exact: true }).fill(name);
      await page.getByRole('button', { name: 'Join battle', exact: true }).click();
      await page.getByRole('heading', { name: `You’re in, ${name}.` }).waitFor();
      await page.getByRole('heading', { name: 'How a battle works' }).waitFor();
    }
    await player.getByLabel('Your message', { exact: true }).fill('hello');
    await player.getByLabel('Your message', { exact: true }).press('Space');
    assert.equal(await player.getByLabel('Your message', { exact: true }).inputValue(), 'hello ');
    await host.getByRole('button', { name: 'Fill to 4 with demo players', exact: true }).click();
    await player.locator('.chat-message').filter({ hasText: '(demo)' }).first().waitFor({ timeout: 22000 });
    assert.equal(await player.locator('.chat-message').filter({ hasText: '(demo)' }).count(), 1, 'demo chat is paced instead of a burst');
    await host.getByRole('button', { name: 'Next: Taste Drop', exact: true }).click();
    for (const page of [player, peer]) {
      await page.getByLabel('Spotify song link', { exact: true }).fill(spotify);
      await expect(page.getByLabel('Song', { exact: true })).toHaveValue('John Legend – All of Me', { timeout: 30000 });
      await expect(page.getByLabel('Vibe 1', { exact: true })).toHaveValue('r&b');
      await page.getByLabel('Vibe 2', { exact: true }).fill('quiet wonder');
      await page.getByLabel('Song', { exact: true }).press('End');
      await page.getByRole('button', { name: 'Drop it on the wall', exact: true }).click();
      await page.getByText('Your taste is on the wall.', { exact: false }).waitFor();
    }
    await expect(player.locator('.taste-play')).toHaveCount(2);
    await player.locator('.taste-play').nth(0).click();
    await expect(player.locator('.taste-play').nth(0)).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 });
    await player.locator('.taste-play').nth(1).click();
    await expect(player.locator('.taste-play').nth(1)).toHaveAttribute('aria-pressed', 'true');
    assert.equal(await player.locator('.taste-play[aria-pressed="true"]').count(), 1, 'only one taste clip plays');
    await player.locator('.taste-play').nth(1).click();
    await expect(player.locator('.taste-play[aria-pressed="true"]')).toHaveCount(0);
    await host.getByRole('button', { name: 'Next: Battle Sample', exact: true }).click();
    for (const page of [player, peer]) await page.getByRole('button', { name: 'I’m ready for the battle', exact: true }).click();
    await host.getByRole('button', { name: 'Next: Flip', exact: true }).click();
    await player.getByRole('heading', { name: 'Arrangement · 16 bars' }).waitFor();
    // Each lane defaults to a sound; no sound selection is necessary.
    await cell(player, 'sample', 1).click();
    await expect(cell(player, 'sample', 1)).toHaveAttribute('aria-pressed', 'true');
    await cell(player, 'sample', 1).click();
    await expect(cell(player, 'sample', 1)).toHaveAttribute('aria-pressed', 'false');
    await paint(player, 'sample', 1, 4);
    for (let bar = 1; bar <= 4; bar++) await expect(cell(player, 'sample', bar)).toHaveAttribute('aria-pressed', 'true');
    await paint(player, 'sample', 2, 3);
    for (let bar = 2; bar <= 3; bar++) await expect(cell(player, 'sample', bar)).toHaveAttribute('aria-pressed', 'false');
    await cell(player, 'chords', 1).focus(); await player.keyboard.press('Enter');
    await expect(cell(player, 'chords', 1)).toHaveAttribute('aria-pressed', 'true');
    // Space while a cell/button is focused must control audio, never edit it.
    await player.keyboard.press('Space');
    await expect(player.getByRole('button', { name: 'Stop beat', exact: true })).toBeVisible();
    await expect(cell(player, 'chords', 1)).toHaveAttribute('aria-pressed', 'true');
    await player.waitForTimeout(2200);
    await player.getByRole('button', { name: '⟲ From bar 1', exact: true }).click();
    await expect(player.getByText('Playing · Bar 1/16', { exact: true })).toBeVisible();
    await player.keyboard.press('Space');
    await expect(player.getByRole('button', { name: 'Play beat', exact: true })).toBeVisible();
    const samplePill = player.getByRole('group', { name: 'Sample lane', exact: true }).locator('.sound-pill').nth(1);
    await samplePill.dragTo(cell(player, 'sample', 2));
    await expect(cell(player, 'sample', 2)).toHaveAttribute('aria-pressed', 'true');
    await player.getByRole('button', { name: 'Submit beat', exact: true }).click();
    await expect(cell(player, 'sample', 1)).toBeDisabled();
    await player.getByRole('button', { name: 'Keep editing', exact: true }).click();
    await expect(cell(player, 'sample', 1)).toBeEnabled();
    await player.getByRole('button', { name: 'Submit beat', exact: true }).click();
    // Add the second real player's minimum sample bars, with two demo beats already in.
    await cell(peer, 'sample', 1).click(); await cell(peer, 'sample', 2).click(); await cell(peer, 'chords', 1).click();
    await peer.getByRole('button', { name: 'Submit beat', exact: true }).click();
    await host.getByRole('button', { name: 'Next: Vote', exact: true }).click();
    await host.getByRole('button', { name: 'Next: Reveal', exact: true }).click();
    await player.getByLabel('Your message', { exact: true }).fill('Nice');
    await player.getByLabel('Your message', { exact: true }).press('Space');
    assert.equal(await player.getByLabel('Your message', { exact: true }).inputValue(), 'Nice ');
    await host.getByRole('button', { name: 'Next: Flip Back', exact: true }).click();
    await player.getByRole('button', { name: 'Done', exact: true }).waitFor();
    await player.locator('section').filter({ has: player.getByText('Your match', { exact: true }) }).getByText('Rae', { exact: true }).waitFor();
    await player.getByText('Same artist: John Legend', { exact: false }).first().waitFor();
    assert.ok(await player.getByRole('group', { name: 'Chords lane', exact: true }).locator('.sound-pill').count() >= 2, 'partner’s sounds are available alongside your own');
    const before = await cell(player, 'sample', 1).getAttribute('aria-pressed');
    await cell(player, 'sample', 1).click();
    await expect(cell(player, 'sample', 1)).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true');
    await player.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(cell(player, 'sample', 1)).toBeDisabled();
    await player.screenshot({ path: '/private/tmp/flipthis-studio-updated.png', fullPage: true });
    assert.deepEqual(errors, [], 'no uncaught errors');
    console.log('PASS: local host + players, friendly scheduled bot chat, real Spotify auto-fill, editable vibes, exclusive clip play/pause, click/remove, paint/erase, keyboard, restart, submit lock, and Flip Back.');
    await context.close();
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

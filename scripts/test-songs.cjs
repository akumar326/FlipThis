const assert = require('node:assert/strict');
const load = require('./load-typescript.cjs')();
const { spotifyTrackId, songEmbed, allowedSongMedia } = load('lib/songs.ts');
const { genreVibes } = load('lib/vibes.ts');
const { GET } = load('app/api/spotify-track/route.ts');
const { spotifyMetadata } = load('lib/spotify.ts');
const { createLobbyRecord, joinLobbyRecord, updateLobbyRecord } = load('lib/lobbies.ts');
const id = '3U4isOIWM3VvDubwSI3y7a', url = `https://open.spotify.com/track/${id}`;
const audio = 'https://audio-ssl.itunes.apple.com/itunes-assets/preview.m4a', art = 'https://i.scdn.co/image/cover';
for (const valid of [url, `${url}?si=example`, url.replace('/track/', '/intl-en/track/'), `spotify:track:${id}`]) assert.equal(spotifyTrackId(valid), id);
for (const invalid of [url.replace('https:', 'http:'), url.replace('open.spotify.com', 'open.spotify.com.evil.test'), url.replace('/track/', '/playlist/'), url.replace('/track/', '/album/'), `${url}/extra`, url.replace(id, 'short'), 'spotify:album:' + id, url.replace('open.spotify.com', 'user@open.spotify.com'), url.replace('open.spotify.com', 'open.spotify.com:444'), 'javascript:alert(1)']) assert.equal(spotifyTrackId(invalid), null);
assert.equal(songEmbed({ provider: 'spotify', title: 'Song', url }), `https://open.spotify.com/embed/track/${id}`);
assert.equal(songEmbed({ provider: 'spotify', title: 'Bad', url: url.replace('/track/', '/playlist/') }), null);
for (const host of ['audio-ssl.itunes.apple.com', 'a.mzstatic.com', 'p.scdn.co']) assert.equal(allowedSongMedia(`https://${host}/clip`, 'audio'), true);
for (const host of ['i.scdn.co', 'cdn.spotifycdn.com', 'a.mzstatic.com', 'a.itunes.apple.com']) assert.equal(allowedSongMedia(`https://${host}/cover`, 'art'), true);
for (const value of ['http://p.scdn.co/a', 'https://p.scdn.co.evil.test/a', 'https://evil.test/a', 'https://user:pass@p.scdn.co/a', 'https://p.scdn.co:444/a', 'data:audio/wav;base64,AAAA', 'https://audio-ssl.itunes.apple.com/' + 'a'.repeat(2000), 42]) assert.equal(allowedSongMedia(value, 'audio'), false);
assert.equal(allowedSongMedia('https://i.scdn.co/a', 'audio'), false);
assert.equal(allowedSongMedia('https://p.scdn.co/a', 'art'), false);
for (const [genre, expected] of [
  ['K-Pop', ['k-pop', 'shiny']], ['Pop', ['pop', 'catchy']], ['Hip-Hop/Rap', ['hip-hop', 'hard hitting']],
  ['R&B/Soul', ['r&b', 'late night']], ['Electronic', ['electronic', 'dancey']], ['House', ['electronic', 'dancey']],
  ['Alternative/Indie', ['indie', 'moody']], ['Rock', ['rock', 'raw']], ['Jazz', ['jazzy', 'warm']], ['Blues', ['jazzy', 'warm']],
  ['Latin', ['latin', 'bouncy']], ['Country', ['acoustic', 'storytelling']], ['Folk', ['acoustic', 'storytelling']],
  ['Soundtrack', ['cinematic', 'sweeping']], ['Classical', ['cinematic', 'sweeping']], ['Ambient', ['ambient', 'vibey']],
]) assert.deepEqual(genreVibes(genre), expected);
assert.equal(new Set(genreVibes('')).size, 2);
assert.equal(new Set(genreVibes('vibey')).size, 2);
const html = '<meta content="Artist · Song · 2026" property="og:description"><meta property="og:title" content="Song &amp; Soul - song and lyrics by Artist | Spotify"><meta name="music:musician_description" content="Artist &amp; Friend">';
assert.deepEqual(spotifyMetadata(html), { title: 'Song & Soul', artist: 'Artist & Friend', art: '' });
const request = value => ({ nextUrl: new URL(`http://localhost/api/spotify-track?url=${encodeURIComponent(value)}`) });
async function main() {
  const originalFetch = global.fetch;
  try {
    assert.equal((await GET(request('https://evil.test/track/' + id))).status, 400);
    global.fetch = async value => {
      const endpoint = new URL(value);
      if (endpoint.pathname === '/oembed') return Response.json({ title: 'Song', thumbnail_url: art });
      if (endpoint.hostname === 'open.spotify.com') return new Response('<meta property="og:title" content="Song"><meta content="Artist" name="music:musician_description">');
      assert.equal(endpoint.hostname, 'itunes.apple.com');
      return Response.json({ results: [
        { trackName: 'Different song', artistName: 'Other artist', previewUrl: 'https://evil.test/a' },
        { trackName: 'Song', artistName: 'Artist', previewUrl: audio, primaryGenreName: 'R&B/Soul', artworkUrl100: 'https://a.mzstatic.com/100x100.jpg' },
      ] });
    };
    const response = await GET(request(url)); assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.song, 'Artist – Song'); assert.equal(result.preview.artist, 'Artist'); assert.equal(result.preview.genre, 'R&B/Soul'); assert.equal(result.preview.audio, audio); assert.equal(result.preview.art, art);
    assert.deepEqual(result.tags, ['r&b', 'late night']);
    let record = joinLobbyRecord(createLobbyRecord('ABCDEF', 'Test', 'Host', 'host'), 'Player', 'player').record;
    record = updateLobbyRecord(record, 'host', { phase: 'taste' });
    assert.equal(updateLobbyRecord(record, 'player', { 'players.p1.taste': { song: result.song, tags: result.tags, preview: result.preview } }).room.players.p1.taste.preview.provider, 'spotify', 'Spotify tastes save online');
    for (const [key, value] of [['audio', 'https://evil.test/a'], ['art', 'http://i.scdn.co/a'], ['unexpected', 'x']]) assert.throws(() => updateLobbyRecord(record, 'player', { 'players.p1.taste': { song: result.song, tags: result.tags, preview: { ...result.preview, [key]: value } } }));
    global.fetch = async value => {
      if (new URL(value).pathname === '/oembed') return Response.json({ title: 'Still available', thumbnail_url: art });
      throw Error('Provider offline');
    };
    const fallback = await (await GET(request(url))).json();
    assert.equal(fallback.title, 'Still available'); assert.equal(fallback.preview.audio, undefined);
    assert.ok(songEmbed(fallback.preview));
    global.fetch = async () => { throw Error('Offline'); };
    assert.equal((await GET(request(url))).status, 502);
  } finally { global.fetch = originalFetch; }
  console.log('PASS: Spotify IDs/embeds, safe media hosts, genre suggestions, metadata parsing, matching, provider outages, and authorized online taste saves.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

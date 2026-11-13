import { NextRequest, NextResponse } from 'next/server';
import { allowedSongMedia, spotifyTrackId, type SongPreview } from '@/lib/songs';
import { spotifyMetadata } from '@/lib/spotify';
import { genreVibes } from '@/lib/vibes';

const words = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
function similarity(expected: string, actual: string) {
  const tokens = words(expected), found = new Set(words(actual));
  return tokens.length ? 2 * tokens.filter(token => found.has(token)).length / (tokens.length + found.size) : 0;
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('url') || '';
  const id = raw.length <= 2000 ? spotifyTrackId(raw) : null;
  if (!id) return NextResponse.json({ error: 'Paste a Spotify song link, rather than an album or playlist.' }, { status: 400 });
  const canonical = `https://open.spotify.com/track/${id}`;
  const options = { signal: AbortSignal.timeout(6500), cache: 'no-store' as const, redirect: 'error' as const };
  const [embedded, page] = await Promise.allSettled([
    fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(canonical)}`, options).then(r => r.ok ? r.json() : null),
    fetch(canonical, { ...options, headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36' } }).then(r => r.ok ? r.text() : ''),
  ]);
  const data = embedded.status === 'fulfilled' ? embedded.value : null;
  const metadata = spotifyMetadata(page.status === 'fulfilled' ? page.value : '');
  const title = (metadata.title || (typeof data?.title === 'string' ? data.title : '')).slice(0, 200);
  let artist = metadata.artist.slice(0, 200);
  if (!title) return NextResponse.json({ error: 'Spotify could not read this song. Try again, or use the search and link options below.' }, { status: 502 });
  let art = [data?.thumbnail_url, metadata.art].find(value => allowedSongMedia(value, 'art'));
  let audio: string | undefined, genre = '';
  try {
    const apple = new URL('https://itunes.apple.com/search');
    apple.search = new URLSearchParams({ term: `${artist} ${title}`.trim(), entity: 'song', media: 'music', limit: '10' }).toString();
    const response = await fetch(apple, { signal: AbortSignal.timeout(6500), cache: 'no-store', redirect: 'error' });
    if (response.ok) {
      const catalog = await response.json();
      const matches = (Array.isArray(catalog.results) ? catalog.results : []).filter((track: { trackName?: unknown; artistName?: unknown }) => typeof track.trackName === 'string' && typeof track.artistName === 'string');
      matches.sort((a: { trackName: string; artistName: string }, b: { trackName: string; artistName: string }) => (similarity(title, b.trackName) * 2 + similarity(artist, b.artistName)) - (similarity(title, a.trackName) * 2 + similarity(artist, a.artistName)));
      const best = matches[0];
      if (best && similarity(title, best.trackName) >= 0.8 && (!artist || similarity(artist, best.artistName) >= 0.6)) {
        if (!artist) artist = best.artistName.slice(0, 200);
        if (allowedSongMedia(best.previewUrl, 'audio')) audio = best.previewUrl;
        genre = typeof best.primaryGenreName === 'string' ? best.primaryGenreName.slice(0, 100) : '';
        const fallback = typeof best.artworkUrl100 === 'string' ? best.artworkUrl100.replace('100x100', '300x300') : '';
        if (!art && allowedSongMedia(fallback, 'art')) art = fallback;
      }
    }
  } catch { /* A playable Spotify embed remains available if Apple is offline. */ }
  const song = (artist ? `${artist} – ${title}` : title).slice(0, 100);
  const preview: SongPreview = { provider: 'spotify', title: song, url: canonical, ...(audio ? { audio } : {}), ...(art ? { art } : {}) };
  return NextResponse.json({ song, title, artist, genre, tags: genreVibes(genre), preview }, { headers: { 'Cache-Control': 'no-store' } });
}

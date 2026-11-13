import { NextRequest, NextResponse } from 'next/server';
import { allowedSongMedia, songEmbed, type SongPreview } from '@/lib/songs';

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q')?.trim() || '';
  if (query.length < 3 || query.length > 100) return NextResponse.json({ results: [], error: 'Enter an artist and song title (3–100 characters).' }, { status: 400 });
  const url = new URL('https://itunes.apple.com/search');
  url.search = new URLSearchParams({ term: query.replace(/[–—]/g, ' '), entity: 'song', media: 'music', country: 'US', limit: '25' }).toString();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
    if (!response.ok) throw new Error('Search unavailable');
    const data = await response.json();
    const results: SongPreview[] = [];
    for (const track of Array.isArray(data.results) ? data.results : []) {
      if (typeof track.trackName !== 'string' || typeof track.artistName !== 'string' || typeof track.trackViewUrl !== 'string') continue;
      const preview: SongPreview = { provider: 'apple', title: `${track.artistName} – ${track.trackName}`, url: track.trackViewUrl, artist: track.artistName.slice(0, 200), trackTitle: track.trackName.slice(0, 200), ...(typeof track.primaryGenreName === 'string' ? { genre: track.primaryGenreName.slice(0, 100) } : {}), ...(allowedSongMedia(track.previewUrl, 'audio') ? { audio: track.previewUrl } : {}), ...(allowedSongMedia(track.artworkUrl100, 'art') ? { art: track.artworkUrl100.replace('100x100', '300x300') } : {}) };
      if (songEmbed(preview)) results.push(preview);
    }
    const tokens = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    const score = (song: SongPreview) => tokens.filter(token => song.title.toLowerCase().includes(token)).length;
    results.sort((a, b) => score(b) - score(a));
    return NextResponse.json({ results: results.slice(0, 5) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ results: [], error: 'Song search is unavailable. Try again, paste a YouTube link, or share your song without a preview.' }, { status: 503 });
  }
}

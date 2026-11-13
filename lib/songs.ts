export interface SongPreview {
  provider: 'apple' | 'youtube' | 'spotify';
  title: string;
  url: string;
  audio?: string;
  art?: string;
  artist?: string;
  trackTitle?: string;
  genre?: string;
}

/** Only provider URLs are converted into embeds; never accept arbitrary frames. */
export function songEmbed(preview: SongPreview): string | null {
  if (preview.provider === 'spotify') {
    const id = spotifyTrackId(preview.url);
    return id ? `https://open.spotify.com/embed/track/${id}` : null;
  }
  try {
    const url = new URL(preview.url);
    if (url.protocol !== 'https:') return null;
    if (preview.provider === 'apple' && url.hostname === 'music.apple.com' && /^\/[a-z]{2}\/(?:album\/.+\/\d+|song\/(?:.+\/)?\d+)$/.test(url.pathname)) {
      const embed = new URL(`https://embed.music.apple.com${url.pathname}`);
      const track = url.searchParams.get('i');
      if (track && /^\d+$/.test(track)) embed.searchParams.set('i', track);
      return embed.toString();
    }
    if (preview.provider === 'youtube') {
      const id = youtubeId(url);
      if (id) return `https://www.youtube-nocookie.com/embed/${id}?rel=0`;
    }
  } catch {}
  return null;
}

function youtubeId(url: URL): string | null {
  let id: string | null = null;
  if (url.hostname === 'youtu.be') id = url.pathname.slice(1);
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com'].includes(url.hostname)) {
    id = url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)$/)?.[1] || null;
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

export function linkedSong(value: string, title: string): SongPreview | null {
  for (const provider of ['youtube', 'apple'] as const) {
    const preview = { provider, title: title.trim(), url: value.trim() };
    if (songEmbed(preview)) return preview;
  }
  return null;
}


export function spotifyTrackId(value: string): string | null {
  const text = value.trim();
  const uri = /^spotify:track:([A-Za-z0-9]{22})$/.exec(text);
  if (uri) return uri[1];
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || url.hostname !== 'open.spotify.com' || url.port || url.username || url.password) return null;
    return /^\/(?:intl-[a-z]{2}\/)?track\/([A-Za-z0-9]{22})\/?$/.exec(url.pathname)?.[1] || null;
  } catch { return null; }
}

export function allowedSongMedia(value: unknown, kind: 'audio' | 'art'): value is string {
  if (typeof value !== 'string' || value.length > 2000) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    const host = url.hostname;
    const apple = host === 'itunes.apple.com' || host.endsWith('.itunes.apple.com') || host === 'mzstatic.com' || host.endsWith('.mzstatic.com');
    return apple || (kind === 'audio' ? host === 'p.scdn.co' : host === 'i.scdn.co' || host === 'spotifycdn.com' || host.endsWith('.spotifycdn.com'));
  } catch { return false; }
}

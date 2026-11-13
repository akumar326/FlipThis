'use client';
import { useEffect, useRef, useState } from 'react';
import { spotifyTrackId, type SongPreview } from '@/lib/songs';
import { SongArt } from './TasteAudio';
import { SongPreview as PreviewPlayer } from './SongPreview';

export function SpotifyPicker({ preview, onPick, onRemove }: {
  preview?: SongPreview;
  onPick: (song: string, tags: string[], preview: SongPreview) => void;
  onRemove: () => void;
}) {
  const [link, setLink] = useState(preview?.provider === 'spotify' ? preview.url : '');
  const [genre, setGenre] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const onPickRef = useRef(onPick); onPickRef.current = onPick;
  async function getSong(value: string) {
    if (!spotifyTrackId(value)) { setError('Paste a Spotify song link, rather than an album or playlist.'); return; }
    controller.current?.abort(); controller.current = new AbortController();
    const run = ++sequence.current;
    setLoading(true); setError('');
    try {
      const response = await fetch(`/api/spotify-track?url=${encodeURIComponent(value.trim())}`, { signal: controller.current.signal });
      const data = await response.json();
      if (run !== sequence.current) return;
      if (!response.ok) throw new Error(data.error || 'Spotify lookup is unavailable.');
      setGenre(data.genre || ''); onPickRef.current(data.song, data.tags, data.preview);
    } catch (err) {
      if (run === sequence.current && !(err instanceof Error && err.name === 'AbortError')) setError(err instanceof Error ? err.message : 'Try the search options below.');
    } finally { if (run === sequence.current) setLoading(false); }
  }
  useEffect(() => {
    if (spotifyTrackId(link) && !(preview?.provider === 'spotify' && spotifyTrackId(preview.url) === spotifyTrackId(link))) void getSong(link);
    return () => { sequence.current++; controller.current?.abort(); };
  }, [link]);
  function clear() { sequence.current++; controller.current?.abort(); setLink(''); setLoading(false); setGenre(''); setError(''); onRemove(); }
  return <div className="stack">
    <div className="field"><label htmlFor="spotify-link">Spotify song link</label>
      <div className="row"><input id="spotify-link" className="input grow" value={link} placeholder="https://open.spotify.com/track/…"
        onChange={event => { sequence.current++; controller.current?.abort(); setLoading(false); setError(''); setLink(event.target.value); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void getSong(link); } }} />
        <button className="btn btn-ghost" type="button" disabled={loading || !link.trim()} onClick={() => void getSong(link)}>{loading ? 'Getting song…' : 'Get song'}</button></div>
      <span className="hint">In Spotify: ••• or Share → Copy Song Link.</span>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {preview?.provider === 'spotify' && <div className="card stack">
      <div className="row"><SongArt preview={preview} /><div className="grow stack"><strong>{preview.title}</strong>{(genre || preview.genre) && <span className="hint">{genre || preview.genre}</span>}</div><button type="button" className="btn btn-ghost btn-sm" onClick={clear}>Remove</button></div>
      <PreviewPlayer preview={preview} />
    </div>}
  </div>;
}

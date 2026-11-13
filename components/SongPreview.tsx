'use client';
import { useEffect, useState } from 'react';
import { allowedSongMedia, linkedSong, songEmbed, type SongPreview as Preview } from '@/lib/songs';
import { TasteAudio, stopTasteAudio } from './TasteAudio';
import { stopAll } from './Playback';

// A single open provider player avoids several taste-wall songs playing at once.
export function SongPreview({ preview }: { preview?: Preview }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener('flipthis:close-song-previews', close);
    return () => window.removeEventListener('flipthis:close-song-previews', close);
  }, []);
  const embed = preview && songEmbed(preview);
  if (!preview || !embed) return null;
  return <div className="stack song-preview">
    {allowedSongMedia(preview.audio, 'audio') && <TasteAudio preview={preview} />}
    <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
      stopTasteAudio();
      stopAll();
      window.dispatchEvent(new Event('flipthis:close-song-previews'));
      setOpen(!open);
    }} aria-expanded={open}>
      {open ? 'Close preview' : 'Listen to song'}
    </button>
    {open && <iframe title={`Song preview: ${preview.title}`} src={embed} height={preview.provider === 'youtube' ? 210 : preview.provider === 'spotify' ? 152 : 175}
      style={{ width: '100%', border: 0, borderRadius: 12 }} allow="autoplay; encrypted-media; fullscreen; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen />}
    {open && <span className="hint">Preview won’t play? <a href={preview.url} target="_blank" rel="noreferrer">Open on {preview.provider === 'apple' ? 'Apple Music' : preview.provider === 'spotify' ? 'Spotify' : 'YouTube'}</a>.</span>}
  </div>;
}

export function SongPicker({ song, preview, onPick }: { song: string; preview?: Preview; onPick: (preview: Preview | undefined) => void }) {
  const [results, setResults] = useState<Preview[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [link, setLink] = useState('');
  const [searchedSong, setSearchedSong] = useState('');

  async function search() {
    setLoading(true); setMessage(''); setResults([]);
    const query = song.trim();
    setSearchedSong(query);
    try {
      const response = await fetch(`/api/song-search?q=${encodeURIComponent(query)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Search is unavailable.');
      setResults(data.results);
      if (!data.results.length) setMessage('No matching songs found. Try another title or paste a YouTube link.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Search is unavailable. You can still share your song.'); }
    finally { setLoading(false); }
  }
  function useLink() {
    const selected = linkedSong(link, song);
    if (!selected) { setMessage('Use a YouTube video or Apple Music song link.'); return; }
    onPick(selected); setMessage(''); setResults([]);
  }
  return <div className="stack">
    <div className="row"><button type="button" className="btn btn-ghost btn-sm" disabled={loading || song.trim().length < 3} onClick={search}>{loading ? 'Searching…' : 'Find song preview'}</button>
      <span className="hint">Choose the right version. Preview is optional and needs internet.</span></div>
    <div aria-live="polite">{message && <p className="hint">{message}</p>}</div>
    {searchedSong === song.trim() && results.map(result => <div key={result.url} className="card row" style={{ justifyContent: 'space-between' }}>
      <span>{result.title}</span><button type="button" className="btn btn-ghost btn-sm" onClick={() => { onPick(result); setResults([]); }}>Use this song</button>
    </div>)}
    <div className="field"><label htmlFor="song-link">Or paste a YouTube / Apple Music link</label>
      <div className="row"><input id="song-link" className="input grow" value={link} onChange={e => setLink(e.target.value)} placeholder="https://youtu.be/…" type="url" />
        <button type="button" className="btn btn-ghost btn-sm" disabled={!song.trim() || !link.trim()} onClick={useLink}>Attach preview</button></div>
    </div>
    {preview && <div className="card stack"><strong>{preview.title}</strong><SongPreview key={preview.url} preview={preview} />
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPick(undefined)}>Remove preview</button></div>}
  </div>;
}

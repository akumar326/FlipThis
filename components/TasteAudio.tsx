'use client';
import { useEffect, useId, useState } from 'react';
import { allowedSongMedia, type SongPreview } from '@/lib/songs';
import { stopAll } from './Playback';
import { PauseIcon, PlayIcon } from './Icons';

let audio: HTMLAudioElement | null = null;
let owner: string | null = null;
let generation = 0;
const subscribers = new Set<() => void>();
const publish = () => subscribers.forEach(fn => fn());
export function stopTasteAudio() {
  generation++;
  audio?.pause();
  if (audio) audio.currentTime = 0;
  owner = null; publish();
}
function sharedAudio() {
  if (!audio) {
    audio = new Audio(); audio.preload = 'none';
    for (const event of ['timeupdate', 'durationchange', 'play', 'pause', 'ended']) audio.addEventListener(event, publish);
    window.addEventListener('flipthis:stop-song-audio', stopTasteAudio);
  }
  return audio;
}

export function TasteAudio({ preview }: { preview: SongPreview }) {
  const id = useId();
  const [, render] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    const update = () => render(n => n + 1);
    subscribers.add(update);
    return () => { subscribers.delete(update); if (owner === id) stopTasteAudio(); };
  }, [id]);
  if (!allowedSongMedia(preview.audio, 'audio')) return null;
  const playing = owner === id && !!audio && !audio.paused && !audio.ended;
  const progress = owner === id && audio?.duration ? Math.min(100, audio.currentTime / audio.duration * 100) : 0;
  async function toggle() {
    const player = sharedAudio(); setError('');
    if (owner === id && !player.paused) { player.pause(); return; }
    stopAll();
    window.dispatchEvent(new Event('flipthis:close-song-previews'));
    if (owner !== id) { player.pause(); player.src = preview.audio!; owner = id; }
    const run = ++generation;
    try { await player.play(); }
    catch { if (run === generation) setError('Clip unavailable. Use Listen to song below.'); }
    publish();
  }
  return <div className="stack">
    <div className="row" style={{ flexWrap: 'nowrap' }}>
      <button type="button" className="taste-play" onClick={toggle} aria-label={`${playing ? 'Pause' : 'Play'} preview: ${preview.title}`} aria-pressed={playing}>{playing ? <PauseIcon /> : <PlayIcon />}</button>
      <div className="grow stack" style={{ gap: 5 }}>
        <div className="taste-progress" role="progressbar" aria-label={`Preview progress: ${preview.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><span style={{ width: `${progress}%` }} /></div>
        <span className="hint">30-sec preview</span>
      </div>
    </div>
    <span className="hint">Preview courtesy of iTunes · <a href={`https://music.apple.com/us/search?term=${encodeURIComponent(preview.title)}`} target="_blank" rel="noreferrer">Find on Apple Music</a></span>
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}

export function SongArt({ preview }: { preview?: SongPreview }) {
  if (!preview || !allowedSongMedia(preview.art, 'art')) return null;
  return <img key={preview.art} src={preview.art} alt={`Cover for ${preview.title}`} className="song-art" onError={event => { event.currentTarget.hidden = true; }} />;
}

'use client';
import { useEffect, useState } from 'react';
import { getEngine } from '@/lib/audio';
import { BARS } from '@/lib/config';
import type { Beat } from '@/lib/types';
import { drumStepCount } from '@/lib/beat';
import { PlayIcon, StopIcon } from './Icons';

/** Which beat (by key) the shared engine is playing, so only one plays at a time. */
let current: string | null = null;
let paused = false;
const subs = new Set<(k: string | null) => void>();
function setCurrent(k: string | null, isPaused = false) { current = k; paused = isPaused; subs.forEach((s) => s(k)); }

export function usePlayback() {
  const [state, setState] = useState({ key: current, paused });
  useEffect(() => {
    const update = () => setState({ key: current, paused });
    subs.add(update); update();
    return () => { subs.delete(update); };
  }, []);
  return state;
}

export function usePlaying() {
  const state = usePlayback();
  return state.paused ? null : state.key;
}

export async function toggleStudioPlayback(key: string, beat: Beat) {
  const engine = getEngine();
  if (current !== key) return playBeat(key, beat);
  if (paused) {
    engine.setBeat(beat);
    setCurrent(key);
    await engine.resume();
  } else if (engine.playing) {
    engine.pause();
    setCurrent(key, true);
  } else stopAll();
}

export async function playBeat(key: string, beat: Beat) {
  window.dispatchEvent(new Event('flipthis:stop-song-audio'));
  window.dispatchEvent(new Event('flipthis:close-song-previews'));
  const engine = getEngine();
  if (current === key) { engine.stop(); setCurrent(null); return; }
  setCurrent(key);
  await engine.play(beat);
}

export async function restartBeat(key: string, beat: Beat) {
  stopAll();
  await playBeat(key, beat);
}

export function stopAll() { getEngine().stop(); setCurrent(null); }

export function usePosition() {
  const [pos, setPos] = useState<{ bar: number; step: number }>({ bar: -1, step: -1 });
  useEffect(() => getEngine().onPosition((bar, step) => setPos({ bar, step })), []);
  return pos;
}

/** A play button with a full-arrangement progress strip. */
export function BeatPlayer({ id, beat, label, big }: { id: string; beat: Beat; label: string; big?: boolean }) {
  const playing = usePlaying() === id;
  const { bar, step } = usePosition();
  const count = drumStepCount(beat);
  const pct = playing && bar >= 0 ? ((bar * count + step + 1) / (BARS * count)) * 100 : 0;
  useEffect(() => () => { if (current === id) stopAll(); }, [id]);
  return (
    <div className="row" style={{ gap: 12, flexWrap: 'nowrap' }}>
      <button type="button" className={`btn ${playing ? 'btn-dark' : 'btn-primary'} btn-play`} style={big ? { height: 56, width: 84 } : undefined}
        onClick={() => playBeat(id, beat)} aria-label={`${playing ? 'Stop' : 'Play'} ${label}`} aria-pressed={playing}>
        {playing ? <StopIcon /> : <PlayIcon />}
      </button>
      <div className="grow" aria-hidden="true" style={{ height: 8, borderRadius: 999, background: 'var(--line)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--ink)', transition: 'width .12s linear' }} />
      </div>
    </div>
  );
}

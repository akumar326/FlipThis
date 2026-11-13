'use client';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { getEngine } from '@/lib/audio';
import { cloneBeat, drumStepCount, resizeDrums } from '@/lib/beat';
import { BARS, DRUM_ROWS, KITS, LANES, LOOP_BY_ID, type DrumRow, type KitId, type LaneId, type LoopDef } from '@/lib/config';
import type { Beat } from '@/lib/types';
import { loopLabel } from '@/lib/loopLabels';
import peaks from '@/lib/peaks.json';
import generatedPeaks from '@/lib/generatedPeaks.json';
import { playBeat, restartBeat, toggleStudioPlayback, stopAll, usePlayback, usePosition } from './Playback';
import { PlayIcon, PauseIcon, StopIcon } from './Icons';

const PEAKS = { ...peaks, ...generatedPeaks } as Record<string, number[]>;
interface Props {
  playKey: string;
  beat: Beat;
  onChange: (next: Beat) => void;
  loops: LoopDef[];
  canEdit: boolean;
  actions?: React.ReactNode;
  loopsTitle?: string;
  loopsHint?: string;
}
type Brush = { lane: LaneId; erase: boolean; id: string; pointer: number; visited: Set<number> };

export function Studio({ playKey, beat, onChange, loops, canEdit, actions, loopsTitle = 'Your loops', loopsHint }: Props) {
  const engine = getEngine();
  const latest = useRef(beat); latest.current = beat;
  const count = drumStepCount(beat);
  const [status, setStatus] = useState('');
  const playback = usePlayback();
  const active = playback.key === playKey;
  const playing = active && !playback.paused;
  const paused = active && playback.paused;
  const { bar: liveBar, step: liveStep } = usePosition();
  const [selected, setSelected] = useState<Partial<Record<LaneId, string>>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const brush = useRef<Brush | null>(null);
  const available = useMemo(() => {
    const ids = new Set([...loops.map(loop => loop.id), ...Object.values(beat.place).flatMap(bars => Object.values(bars))]);
    return [...ids].map(id => LOOP_BY_ID[id]).filter((loop): loop is LoopDef => !!loop);
  }, [loops, beat.place]);
  const sounds = (lane: LaneId) => available.filter(loop => loop.lane === lane);
  const selectedSound = (lane: LaneId) => sounds(lane).find(loop => loop.id === selected[lane]) || sounds(lane)[0];

  useEffect(() => { engine.loadLoops(available.map(loop => loop.id)); engine.loadKits(); }, [engine, available]);
  useEffect(() => { if (active) engine.setBeat(beat); }, [engine, beat, active]);
  useEffect(() => () => { stopAll(); }, []);
  const edit = (fn: (b: Beat) => void) => {
    if (!canEdit) return;
    const next = cloneBeat(latest.current); fn(next);
    latest.current = next; onChange(next);
  };
  function writeCell(lane: LaneId, bar: number, id: string, erase: boolean) {
    if (!canEdit || (!erase && LOOP_BY_ID[id]?.lane !== lane)) return;
    const existing = latest.current.place[lane][String(bar)];
    if ((erase && !existing) || (!erase && existing === id)) return;
    edit(next => { if (erase) delete next.place[lane][String(bar)]; else next.place[lane][String(bar)] = id; });
    const label = LANES.find(item => item.id === lane)!.label;
    setStatus(erase ? `Cleared ${label} bar ${bar + 1}.` : `Added ${LOOP_BY_ID[id].name} to ${label} bar ${bar + 1}.`);
  }
  function toggleCell(lane: LaneId, bar: number) {
    const sound = selectedSound(lane);
    if (sound) writeCell(lane, bar, sound.id, !!latest.current.place[lane][String(bar)]);
  }
  function paint(lane: LaneId, bar: number, pointer: number) {
    const stroke = brush.current;
    if (!stroke || stroke.lane !== lane || stroke.pointer !== pointer || stroke.visited.has(bar)) return;
    stroke.visited.add(bar); writeCell(lane, bar, stroke.id, stroke.erase);
  }
  const paintRef = useRef(paint); paintRef.current = paint;
  useEffect(() => {
    const end = () => { brush.current = null; };
    const move = (event: PointerEvent) => {
      if (!brush.current || event.pointerType !== 'touch') return;
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-arrangement-lane]');
      if (target) paintRef.current(target.dataset.arrangementLane as LaneId, Number(target.dataset.bar), event.pointerId);
    };
    window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end); window.addEventListener('blur', end);
    window.addEventListener('pointermove', move);
    return () => { window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); window.removeEventListener('blur', end); window.removeEventListener('pointermove', move); };
  }, []);
  const toggleTransport = () => { if (active) stopAll(); else void playBeat(playKey, latest.current); };
  const transportRef = useRef(toggleTransport); transportRef.current = toggleTransport;
  useEffect(() => {
    let held = false;
    const typing = (event: KeyboardEvent) => event.target instanceof Element && !!event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Space' && event.repeat && held) { event.preventDefault(); event.stopPropagation(); return; }
      if (event.code !== 'Space' || typing(event) || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      held = true; event.preventDefault(); event.stopPropagation(); transportRef.current();
    };
    const up = (event: KeyboardEvent) => { if (event.code === 'Space' && held) { held = false; event.preventDefault(); event.stopPropagation(); } };
    const blur = () => { held = false; };
    window.addEventListener('keydown', down, true); window.addEventListener('keyup', up, true); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true); window.removeEventListener('blur', blur); };
  }, []);
  const toggleStep = async (row: DrumRow, i: number) => {
    const on = !latest.current.steps[row][i];
    edit(next => { next.steps[row][i] = on ? 1 : 0; });
    if (on && canEdit) { await engine.unlock(); engine.hit(latest.current.kit, row); }
  };
  const pickKit = async (kit: KitId) => {
    if (kit === latest.current.kit) return;
    edit(next => { next.kit = kit; });
    if (canEdit) { await engine.unlock(); engine.hit(kit, 'kick'); }
  };
  const loadGroove = () => edit(next => { const groove = KITS.find(kit => kit.id === next.kit)!.groove; for (const row of DRUM_ROWS) next.steps[row.id] = Array.from({ length: count }, (_, i) => count === 8 ? groove[row.id][i] : i % 2 === 0 ? groove[row.id][i / 2] : 0); });
  const clearDrums = () => edit(next => { for (const row of DRUM_ROWS) next.steps[row.id] = Array(count).fill(0); });
  const hasPlaced = Object.values(beat.place).some(bars => Object.keys(bars).length);

  return (<>
    <section className="panel" aria-label="Beat studio">
      <div className="panel-head studio-transport">
        <div className="row">
          <button type="button" className={`btn ${playing ? 'btn-dark' : 'btn-primary'} btn-play`} onClick={toggleTransport} aria-label={active ? 'Stop beat' : 'Play beat'} aria-pressed={playing}>{active ? <StopIcon /> : <PlayIcon />}</button>
          <button type="button" className="btn btn-ghost" disabled={!active} onClick={() => toggleStudioPlayback(playKey, latest.current)} aria-label={paused ? 'Resume beat' : 'Pause beat'}>{paused ? <PlayIcon /> : <PauseIcon />}</button>
          <button type="button" className="btn btn-ghost" onClick={stopAll} aria-label="Stop beat and return to start"><StopIcon /></button>
          <button type="button" className="btn btn-ghost" onClick={() => restartBeat(playKey, latest.current)}>⟲ From bar 1</button>
          <span className="hint"><kbd>Space</kbd> play / stop</span>
          <span className="chip-mono" role="status">{paused ? 'Paused' : playing ? 'Playing' : 'Ready'} · Bar {active && liveBar >= 0 ? liveBar + 1 : 1}/{BARS}</span>
        </div>
        <div className="row">{actions}</div>
      </div>
      <div className="panel-head"><h2>Arrangement · {BARS} bars</h2><span className="hint">{loopsTitle}{loopsHint ? ` · ${loopsHint}` : ''}</span></div>
      {!canEdit ? <p className="hint">Submitted · Keep editing to change your beat.</p> : !hasPlaced && !status ? <p className="banner studio-howto">1 Tap a sound on the left of a row to hear it and pick it. 2 Click a grid box to drop it in — or click and drag across the row to fill several bars. Click a filled box to remove it. 3 Build a drum loop below, then press Space to listen.</p> : <p className="hint" role="status">{status || 'Click a filled box to remove it, or drag across a row to paint.'}</p>}
      <div className="scroll-x arrangement" style={{ '--arrangement-bars': BARS } as CSSProperties}>
        <div className="grid-row"><div className="lane-sounds sounds-heading">Sounds · tap to hear</div>{Array.from({ length: BARS }, (_, bar) => <div key={bar} className="bar-head" data-live={active && liveBar === bar}>{bar + 1}</div>)}</div>
        {LANES.map(lane => {
          const chosen = selectedSound(lane.id);
          return <div key={lane.id} className="grid-row sound-row" role="group" aria-label={`${lane.label} lane`}>
            <div className="lane-sounds" style={{ '--lane-color': lane.color, '--lane-tint': lane.tint } as CSSProperties}>
              <strong className="lane-label"><span className="dot" style={{ background: lane.color }} />{lane.label}</strong>
              <div className="sound-pills">{sounds(lane.id).map(loop => <button key={loop.id} type="button" className="sound-pill" draggable={canEdit} aria-label={`Select and preview ${loop.name}`} title={loop.name} aria-pressed={chosen?.id === loop.id}
                onClick={async () => { setSelected(current => ({ ...current, [lane.id]: loop.id })); await engine.unlock(); void engine.previewLoop(loop.id); }}
                onDragStart={event => { setDragId(loop.id); event.dataTransfer.setData('text/plain', loop.id); event.dataTransfer.effectAllowed = 'copy'; }} onDragEnd={() => setDragId(null)}>
                <span>{loopLabel(loop)}</span><span className="mini-wave" aria-hidden="true">{(PEAKS[loop.id] || []).filter((_, i) => i % 3 === 0).map((value, i) => <i key={i} style={{ height: `${Math.max(12, value * 100)}%` }} />)}</span>
              </button>)}</div>
              <span className="hint selected-sound">{chosen?.name || 'No sounds in this lane'}</span>
            </div>
            {Array.from({ length: BARS }, (_, bar) => {
              const id = beat.place[lane.id][String(bar)], def = id ? LOOP_BY_ID[id] : undefined;
              return <button key={bar} type="button" className="arrangement-cell" data-arrangement-lane={lane.id} data-bar={bar} data-filled={!!def} data-live={active && liveBar === bar}
                style={{ '--lane-color': lane.color, '--lane-tint': lane.tint } as CSSProperties} disabled={!canEdit || !chosen}
                aria-label={def ? `Remove ${def.name} from ${lane.label} bar ${bar + 1}` : `Place ${chosen?.name || 'sound'} in ${lane.label} bar ${bar + 1}`}
                title={`${def?.name || chosen?.name || lane.label} · ${lane.label} bar ${bar + 1}${def ? ' · click to remove' : ' · click to add'}`} aria-pressed={!!def}
                onPointerDown={event => {
                  if (event.button !== 0 || !canEdit || !chosen) return;
                  event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
                  try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
                  brush.current = { lane: lane.id, erase: !!latest.current.place[lane.id][String(bar)], id: chosen.id, pointer: event.pointerId, visited: new Set() };
                  paint(lane.id, bar, event.pointerId);
                }}
                onPointerEnter={event => { if (event.buttons & 1 || event.pointerType === 'touch') paint(lane.id, bar, event.pointerId); }}
                onClick={event => { if (event.detail === 0) toggleCell(lane.id, bar); }}
                onDragOver={event => { if (canEdit && dragId && LOOP_BY_ID[dragId]?.lane === lane.id) event.preventDefault(); }}
                onDrop={event => { event.preventDefault(); const dropped = event.dataTransfer.getData('text/plain') || dragId; if (dropped) writeCell(lane.id, bar, dropped, false); setDragId(null); }}>
                {def ? loopLabel(def) : '+'}
              </button>;
            })}
          </div>;
        })}
        <div className="grid-row" role="group" aria-label="Drums on or off per bar"><div className="lane-sounds lane-label">Drums</div>{beat.drumOn.map((on, bar) => <button key={bar} type="button" className="pad" disabled={!canEdit} data-live={active && liveBar === bar} aria-pressed={on} aria-label={`Drums in bar ${bar + 1}`} onClick={() => edit(next => { next.drumOn[bar] = !next.drumOn[bar]; })}><span className={on ? 'on' : 'off'} style={on ? { background: 'var(--ink)' } : undefined} /></button>)}</div>
      </div>
    </section>
      <section className="panel drums" aria-label="Drums">
        <div className="kits">
          <h2 style={{ fontSize: 15 }}>Drum kit</h2>
          <div className="kit-grid">
            {KITS.map((k, i) => (
              <button key={k.id} type="button" className="kit" aria-pressed={beat.kit === k.id} disabled={!canEdit} onClick={() => pickKit(k.id)}>
                <span className="num">{i + 1}</span><span className="nm">{k.label}</span><span className="led" aria-hidden="true" />
              </button>
            ))}
          </div>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <button type="button" className="btn btn-ghost btn-sm grow" disabled={!canEdit} onClick={clearDrums}>Clear</button>
            <button type="button" className="btn btn-ghost btn-sm grow" disabled={!canEdit} onClick={loadGroove}>Kit groove</button>
          </div>
        </div>
        <div className="vdivider" aria-hidden="true" />
        <div className="seq" style={{ '--drum-steps': count, '--drum-gap': count === 16 ? '4px' : '8px' } as CSSProperties}>
          <div className="panel-head" style={{ marginBottom: 8 }}>
            <h2>Drum loop · {count} steps</h2>
            <div className="row" role="group" aria-label="Drum resolution">{([8, 16] as const).map(n => <button key={n} type="button" className={`btn btn-sm ${count === n ? 'btn-dark' : 'btn-ghost'}`} aria-pressed={count === n} disabled={!canEdit} onClick={() => onChange(resizeDrums(beat, n))}>{n} steps</button>)}</div>
            <span className="hint">Tap steps to build one bar of drums. It repeats in every bar where Drums is on above. Try Kit groove for a starting pattern.</span>
          </div>
          {DRUM_ROWS.map((r) => (
            <div key={r.id} className="seq-row" role="group" aria-label={r.label}>
              <div className="lane-label">{r.label}</div>
              {beat.steps[r.id].map((v, i) => (
                <button key={i} type="button" className="pad pad-lg" disabled={!canEdit}
                  data-live={active && liveStep === i && beat.drumOn[liveBar]} data-beat={i % 4 === 0}
                  aria-pressed={!!v} aria-label={`${r.label} step ${i + 1}`} onClick={() => toggleStep(r.id, i)}>
                  <span className={v ? 'on' : 'off'} style={v ? { background: r.color } : undefined} />
                </button>
              ))}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

'use client';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { getEngine } from '@/lib/audio';
import { cloneBeat, drumStepCount, resizeDrums } from '@/lib/beat';
import { BARS, DRUM_ROWS, KITS, LANES, LOOP_BY_ID, type DrumRow, type KitId, type LaneId, type LoopDef } from '@/lib/config';
import type { Beat } from '@/lib/types';
import { loopLabel } from '@/lib/loopLabels';
import peaks from '@/lib/peaks.json';
import generatedPeaks from '@/lib/generatedPeaks.json';
import { toggleStudioPlayback, stopAll, usePlayback, usePosition } from './Playback';
import { PlayIcon, PauseIcon, StopIcon, XIcon } from './Icons';

const LANE = Object.fromEntries(LANES.map((l) => [l.id, l])) as Record<LaneId, (typeof LANES)[number]>;
const PEAKS = { ...peaks, ...generatedPeaks } as Record<string, number[]>;

interface Props {
  playKey: string;
  beat: Beat;
  onChange: (next: Beat) => void;
  loops: LoopDef[];
  /** false = read only after submission. */
  canEdit: boolean;
  /** Shown above the loop cards, e.g. a Submit button or edits counter. */
  actions?: React.ReactNode;
  loopsTitle?: string;
  loopsHint?: string;
}

export function Studio({ playKey, beat, onChange, loops, canEdit, actions, loopsTitle = 'Your loops', loopsHint }: Props) {
  const engine = getEngine();
  const count = drumStepCount(beat);
  const [inspected, setInspected] = useState('');
  const playback = usePlayback();
  const active = playback.key === playKey;
  const playing = active && !playback.paused;
  const paused = active && playback.paused;
  const { bar: liveBar, step: liveStep } = usePosition();
  const [selected, setSelected] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const selLoop = selected ? LOOP_BY_ID[selected] : null;

  // Load this screen's sounds up front so the first Play is instant.
  const loopIds = useMemo(() => Array.from(new Set([...loops.map((l) => l.id), ...Object.values(beat.place).flatMap((m) => Object.values(m))])), [loops, beat.place]);
  useEffect(() => { engine.loadLoops(loopIds); engine.loadKits(); }, [engine, loopIds]);
  useEffect(() => { if (active) engine.setBeat(beat); }, [engine, beat, active]);
  useEffect(() => () => { stopAll(); }, []);

  const edit = (fn: (b: Beat) => void) => {
    if (!canEdit) return;
    const next = cloneBeat(beat); fn(next); onChange(next);
  };

  const place = (lane: LaneId, bar: number, id: string) => {
    const def = LOOP_BY_ID[id];
    if (!def || def.lane !== lane) return;
    if (beat.place[lane][String(bar)] === id) return;
    edit((b) => { b.place[lane][String(bar)] = id; });
  };
  const remove = (lane: LaneId, bar: number) => edit((b) => { delete b.place[lane][String(bar)]; });
  const toggleStep = async (row: DrumRow, i: number) => {
    const on = !beat.steps[row][i];
    edit((b) => { b.steps[row][i] = on ? 1 : 0; });
    if (on && canEdit) { await engine.unlock(); engine.hit(beat.kit, row); }
  };
  const pickKit = async (kit: KitId) => {
    if (kit === beat.kit) return;
    edit((b) => { b.kit = kit; });
    if (canEdit) { await engine.unlock(); engine.hit(kit, 'kick'); }
  };
  const loadGroove = () => edit((b) => { const g = KITS.find((k) => k.id === b.kit)!.groove; for (const r of DRUM_ROWS) b.steps[r.id] = Array.from({ length: count }, (_, i) => count === 8 ? g[r.id][i] : i % 2 === 0 ? g[r.id][i / 2] : 0); });
  const clearDrums = () => edit((b) => { for (const r of DRUM_ROWS) b.steps[r.id] = Array(count).fill(0); });

  const preview = async (id: string) => {
    setSelected((s) => (s === id ? null : id));
    await engine.unlock();
    engine.previewLoop(id);
  };

  const hint = !canEdit ? 'Locked.' : selLoop
    ? `Click an empty ${LANE[selLoop.lane].label} bar to place “${selLoop.name}”.`
    : 'Drag a loop onto its lane, or click a loop and then an empty bar.';

  return (
    <>
      <section className="panel" aria-labelledby="loops-title">
        <div className="panel-head">
          <div className="row" style={{ gap: 12 }}>
            <button type="button" className={`btn ${playing ? 'btn-dark' : 'btn-primary'} btn-play`} onClick={() => toggleStudioPlayback(playKey, beat)}
              aria-label={playing ? 'Pause beat' : paused ? 'Resume beat' : 'Play beat'} aria-pressed={playing}>
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button type="button" className="btn" onClick={stopAll} aria-label="Stop beat and return to start"><StopIcon /></button>
            <span className="muted mono" role="status">{paused ? 'Paused' : playing ? 'Playing' : 'Ready'} · Bar {active && liveBar >= 0 ? liveBar + 1 : 1}/{BARS}</span>
            <h2 id="loops-title">{loopsTitle}</h2>
            {loopsHint && <span className="hint">{loopsHint}</span>}
          </div>
          <div className="row">{actions}</div>
        </div>

        <div className="loop-grid">
          {loops.map((l) => {
            const lane = LANE[l.lane];
            return (
              <button key={l.id} type="button" className="loop-card" draggable={canEdit}
                onDragStart={(e) => { setDragId(l.id); e.dataTransfer.setData('text/plain', l.id); e.dataTransfer.effectAllowed = 'copy'; }}
                onDragEnd={() => setDragId(null)}
                onClick={() => preview(l.id)} aria-pressed={selected === l.id}
                style={{ color: lane.color, borderColor: selected === l.id ? lane.color : undefined }}>
                <span className="top">
                  <span className="name"><span className="loop-code">{loopLabel(l)}</span>{l.name}</span>
                  <span className="meta">{lane.label.toUpperCase()}{l.bank === 'shared' ? ' · SHARED' : ''}</span>
                </span>
                <span className="wave" style={{ background: lane.tint }} aria-hidden="true">
                  {(PEAKS[l.id] || []).map((v, i) => <span key={i} style={{ height: `${Math.max(8, v * 100)}%`, background: lane.color }} />)}
                </span>
              </button>
            );
          })}
        </div>

        <hr className="divider" />

        <div className="panel-head" style={{ marginBottom: 8 }}>
          <h2>Arrangement · {BARS} bars</h2>
          <span className="hint" aria-live="polite">{hint}</span>
        </div>
        <div className="row loop-legend">{loops.filter(l => l.lane === 'sample').map(l => <span key={l.id} className="chip"><strong>{loopLabel(l)}</strong> {l.name}</span>)}</div>
        <p className="hint" aria-live="polite">{inspected || 'Tap a placed block to see its full sound name. Codes match the loop cards above.'}</p>
        <div className="scroll-x" style={{ '--arrangement-bars': BARS } as CSSProperties}>
          <div className="grid-row" aria-hidden="true">
            <div />
            {Array.from({ length: BARS }, (_, b) => <div key={b} className="bar-head" data-live={active && liveBar === b}>{b + 1}</div>)}
          </div>
          {LANES.map((lane) => (
            <div key={lane.id} className="grid-row" role="group" aria-label={`${lane.label} lane`}>
              <div className="lane-label"><span className="dot" style={{ background: lane.color }} />{lane.label}</div>
              {Array.from({ length: BARS }, (_, b) => {
                const id = beat.place[lane.id][String(b)];
                const def = id ? LOOP_BY_ID[id] : null;
                const live = active && liveBar === b;
                const target = !!(canEdit && ((selLoop && selLoop.lane === lane.id) || (dragId && LOOP_BY_ID[dragId]?.lane === lane.id)));
                return (
                  <div key={b} className="cell"
                    onDragOver={(e) => { if (dragId && LOOP_BY_ID[dragId]?.lane === lane.id && canEdit) e.preventDefault(); }}
                    onDrop={(e) => { e.preventDefault(); const dropped = e.dataTransfer.getData('text/plain') || dragId; if (dropped) place(lane.id, b, dropped); setDragId(null); }}>
                    {def ? (
                      <div className="block" data-live={live} style={{ background: lane.tint, borderColor: lane.color }}>
                        <button type="button" className="block-inspect" title={def.name}
                          aria-label={`${def.name}, ${lane.label} bar ${b + 1}`}
                          onClick={() => setInspected(`${loopLabel(def)} · ${def.name} · ${lane.label} bar ${b + 1}`)}>{loopLabel(def)}</button>
                        {canEdit && (
                          <button type="button" className="x" onClick={() => remove(lane.id, b)} aria-label={`Remove ${def.name} from ${lane.label} bar ${b + 1}`}><XIcon /></button>
                        )}
                      </div>
                    ) : (
                      <button type="button" className="cell-empty" data-live={live} data-target={target}
                        style={target ? { borderColor: lane.color, background: lane.tint } : undefined}
                        disabled={!canEdit || !(selLoop && selLoop.lane === lane.id)}
                        onClick={() => selLoop && place(lane.id, b, selLoop.id)}
                        aria-label={selLoop && selLoop.lane === lane.id ? `Place ${selLoop.name} in ${lane.label} bar ${b + 1}` : `${lane.label} bar ${b + 1}, empty`} />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          <div className="grid-row" role="group" aria-label="Drums on or off per bar">
            <div className="lane-label"><span className="dot" style={{ background: 'var(--ink)' }} />Drums</div>
            {beat.drumOn.map((on, b) => (
              <button key={b} type="button" className="pad" data-live={active && liveBar === b} data-beat="true" disabled={!canEdit}
                aria-pressed={on} aria-label={`Drums in bar ${b + 1}`} onClick={() => edit((x) => { x.drumOn[b] = !x.drumOn[b]; })}>
                <span className={on ? 'on' : 'off'} style={on ? { background: 'var(--ink)', width: 18, height: 18 } : undefined} />
              </button>
            ))}
          </div>
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
            <h2>Drum sequencer · {count} steps</h2>
            <div className="row" role="group" aria-label="Drum resolution">{([8, 16] as const).map(n => <button key={n} type="button" className={`btn btn-sm ${count === n ? 'btn-dark' : 'btn-ghost'}`} aria-pressed={count === n} disabled={!canEdit} onClick={() => onChange(resizeDrums(beat, n))}>{n} steps</button>)}</div>
            <span className="hint">One pattern per bar. 16 adds finer subdivisions; switching to 8 removes the in-between hits.</span>
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

'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getEngine } from '@/lib/audio';
import { cloneBeat, normalizeBeat } from '@/lib/beat';
import { LANES, SLOTS, SLOT_BY_ID, SURVEY_URL, type LoopDef, type SlotId } from '@/lib/config';
import { collaborationGroups, normalizeTags, joinedSlots, matchupsFor, pairKey, playerName, standings, tagOverlap } from '@/lib/game';
import type { RoomStore } from '@/lib/store';
import type { Beat, RoomState } from '@/lib/types';
import { useSyncedBeat } from '@/lib/useSyncedBeat';
import { BeatPlayer, stopAll } from './Playback';
import { Studio } from './Studio';
import { CheckIcon, PlayIcon } from './Icons';
import { battleSample } from '@/lib/battle';
import { playerBank } from '@/lib/packs';
import type { SongPreview as Preview } from '@/lib/songs';
import { SongPicker, SongPreview } from './SongPreview';
import { feedbackFor, votePatch, votingBeat } from '@/lib/voting';
import { PHASES } from '@/lib/config';

type P = { room: RoomState; slot: SlotId };
type PS = P & { store: RoomStore };

const LANE_COLOR = Object.fromEntries(LANES.map((l) => [l.id, l.color]));

function SeatChip({ room, slot }: P) {
  return <span className="chip"><span className="dot" style={{ background: SLOT_BY_ID[slot].color }} />{playerName(room, slot)}</span>;
}

/** Click-to-hear list of loops (lobby). */
function LoopList({ loops }: { loops: LoopDef[] }) {
  const engine = getEngine();
  useEffect(() => { engine.loadLoops(loops.map((l) => l.id)); }, [engine, loops]);
  return (
    <div className="card-list">
      {loops.map((l) => (
        <button key={l.id} type="button" className="card row" style={{ justifyContent: 'space-between', textAlign: 'left' }}
          onClick={async () => { await engine.unlock(); engine.previewLoop(l.id); }} aria-label={`Preview ${l.name}`}>
          <span className="row" style={{ gap: 8 }}><span className="dot" style={{ background: LANE_COLOR[l.lane] }} /><strong>{l.name}</strong></span>
          <PlayIcon />
        </button>
      ))}
    </div>
  );
}

export function Lobby({ room, slot }: P) {
  const bank = playerBank(room.players[slot], slot, room);
  const joined = joinedSlots(room);
  return (
    <>
      <section className="panel big-center">
        <h1>You’re in, {playerName(room, slot)}.</h1>
        <p>{joined.length} of {SLOTS.length} players here. The battle starts when the host is ready. Grab headphones and get to know your sounds.</p>
        <div className="row" style={{ justifyContent: 'center' }}>{joined.map((s) => <SeatChip key={s} room={room} slot={s} />)}</div>
      </section>
      <section className="panel">
        <div className="panel-head"><h2>Your sounds</h2><span className="hint">Everyone shares this battle’s main sample. {room.battle ? 'Your complementary pack is unique to you in this battle.' : 'Start a new battle to get unique packs.'}</span></div>
        <LoopList loops={[...battleSample(room).loops, ...bank.loops]} />
      </section>
    </>
  );
}

export function TasteDrop({ room, store, slot }: PS) {
  const mine = room.players[slot]?.taste;
  const [song, setSong] = useState(mine?.song || '');
  const [tags, setTags] = useState<string[]>(mine?.tags || ['', '']);
  const [preview, setPreview] = useState<Preview | undefined>(mine?.preview);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(!mine);
  const [error, setError] = useState('');
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!song.trim()) { setError('Add a song (artist and title).'); return; }
    const normalized = normalizeTags(tags);
    if (normalized.length !== 2) { setError('Write two different vibe tags.'); return; }
    setSaving(true);
    try {
      await store.update({ [`players.${slot}.taste`]: { song: song.trim().slice(0, 100), tags: normalized, ...(preview ? { preview } : {}) } });
      setEditing(false);
    } catch { setError('Your taste could not be saved. Please try again.'); }
    finally { setSaving(false); }
  };
  const wall = joinedSlots(room).filter((s) => room.players[s]?.taste);
  return (
    <>
      {editing ? (
        <section className="panel">
          <form className="stack" style={{ gap: 18, maxWidth: 640 }} onSubmit={save} noValidate>
            <h2 style={{ fontSize: 20 }}>Drop one song that defines your taste</h2>
            <div className="field">
              <label htmlFor="song">Song</label>
              <input id="song" className="input" value={song} maxLength={100} placeholder="Artist – Title" onChange={(e) => { setSong(e.target.value); setPreview(undefined); setError(''); }} />
            </div>
            <SongPicker song={song} preview={preview} onPick={selected => { setPreview(selected); if (selected) setSong(selected.title.slice(0, 100)); }} />
            <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 10 }}>
              <legend>Write two vibe tags</legend>
              <span className="hint">Describe the music in your own words. Matching ignores capitals, extra spaces, and # signs; use shared words to find similar tastes.</span>
              {[0, 1].map(i => <div className="field" key={i}>
                <label htmlFor={`vibe-${i}`}>Vibe {i + 1}</label>
                <input id={`vibe-${i}`} className="input" maxLength={30} value={tags[i] || ''} placeholder={i === 0 ? 'e.g. late night' : 'e.g. bouncy'}
                  onChange={e => { setTags(current => [0, 1].map(j => j === i ? e.target.value : current[j] || '')); setError(''); }} />
              </div>)}
            </fieldset>
            {error && <p className="error" role="alert" style={{ margin: 0 }}>{error}</p>}
            <div><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Drop it on the wall'}</button></div>
          </form>
        </section>
      ) : (
        <section className="panel row" style={{ justifyContent: 'space-between' }}>
          <span className="row ok" style={{ gap: 6 }}><CheckIcon /> Your taste is on the wall. Your Flip Back partner is matched by these tags.</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>Change</button>
        </section>
      )}
      <section className="panel">
        <div className="panel-head"><h2>Taste wall</h2><span className="hint">{wall.length} of {joinedSlots(room).length} dropped</span></div>
        <div className="card-list">
          {wall.map((s) => {
            const t = room.players[s]!.taste!;
            return (
              <div key={s} className="card stack" style={{ gap: 8, borderColor: s === slot ? 'var(--ink)' : undefined }}>
                <SeatChip room={room} slot={s} />
                <strong style={{ fontSize: 15 }}>{t.song}</strong>
                <SongPreview key={t.preview?.url} preview={t.preview} />
                <div className="row" style={{ gap: 6 }}>{t.tags.map((tg) => <span key={tg} className="tag tag-sm">{tg}</span>)}</div>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

export function Vote({ room, store, slot }: PS) {
  const matchups = useMemo(() => matchupsFor(room, slot), [room, slot]);
  const votes = room.players[slot]?.votes || {};
  const nextIdx = matchups.findIndex(([a, b]) => !votes[pairKey(a, b)]);
  const [viewIdx, setViewIdx] = useState<number | null>(null);
  const [pending, setPending] = useState<{ idx: number; slot: SlotId } | null>(null);
  const [voteError, setVoteError] = useState('');
  const [comments, setComments] = useState<Partial<Record<SlotId, string>>>({ ...room.players[slot]?.comments });
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const idx = pending?.idx ?? viewIdx ?? (nextIdx === -1 ? matchups.length : nextIdx);
  useEffect(() => () => stopAll(), []);

  if (matchups.length === 0) {
    if (room.voting && room.voting.slots.length >= 3) return <section className="panel big-center"><h1>Voting is underway</h1><p>Your beat wasn’t among the eligible submissions when voting started, so you have no assigned matchups this round. You can join the remix afterward.</p></section>;
    return <section className="panel big-center"><h1>Not enough beats to vote on yet</h1><p>Voting needs at least 3 submitted beats. Hang tight.</p></section>;
  }
  if (idx >= matchups.length) {
    return (
      <section className="panel big-center">
        <h1>All {matchups.length} votes in</h1>
        <p>Your votes and comments are saved. Creators will see your feedback and name after the reveal.</p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setViewIdx(0)}>Review my votes</button>
      </section>
    );
  }
  const [a, b] = matchups[idx];
  const key = pairKey(a, b);
  const picked = pending?.slot ?? votes[key];
  const choose = async (w: SlotId) => {
    if (busy.current) return;
    busy.current = true;
    stopAll(); setVoteError(''); setPending({ idx, slot: w });
    try {
      await Promise.all([
        store.update(votePatch(room, slot, a, b, w, comments)),
        new Promise(resolve => setTimeout(resolve, 750)),
      ]);
      if (mounted.current) setViewIdx(null);
    } catch {
      if (mounted.current) setVoteError('Your vote could not be saved. Please try again.');
    } finally {
      busy.current = false;
      if (mounted.current) setPending(null);
    }
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Matchup {idx + 1} of {matchups.length}: which flip hits harder?</h2>
        <span className="hint">Names stay hidden until the reveal. Your schedule balances how often each beat is heard.</span>
      </div>
      <p className="hint">Listen to both beats, leave a kind, specific comment, then pick your favorite. Try “I felt…” or “One thing you could try…”. Comments are optional and save with your vote; creators see your name after reveal.</p>
      <div className="versus">
        {([a, b] as SlotId[]).map((s, i) => (
          <div key={s} className="choice" data-picked={picked === s}>
            <h3>Beat {i === 0 ? 'A' : 'B'}</h3>
            <BeatPlayer id={`vote-${key}-${s}`} beat={votingBeat(room, s)} label={`Beat ${i === 0 ? 'A' : 'B'}`} big />
            <div className="field">
              <label htmlFor={`comment-${s}`}>A note for Beat {i === 0 ? 'A' : 'B'}’s creator</label>
              <textarea id={`comment-${s}`} className="comment-input" rows={3} maxLength={280} disabled={!!pending} value={comments[s] ?? ''}
                placeholder="What stood out? What feeling did it give you?"
                onChange={e => setComments(current => ({ ...current, [s]: e.target.value }))} />
              <span className="hint">{(comments[s] || '').length}/280 · {room.players[slot]?.comments?.[s] ? 'Previously saved; you can update it.' : 'Saves when you pick A or B.'}</span>
            </div>
            <button type="button" disabled={!!pending} className={`btn vote-pick ${picked === s ? 'vote-picked' : ''} ${pending?.slot === s ? 'vote-confirm' : ''}`} onClick={() => choose(s)}>
              {picked === s ? '✓ Picked' : `Pick Beat ${i === 0 ? 'A' : 'B'}`}
            </button>
          </div>
        )).reduce<React.ReactNode[]>((acc, el, i) => (i === 0 ? [el] : [...acc, <span key="vs" className="vs" aria-hidden="true">VS</span>, el]), [])}
      </div>
      {pending && <p className="ok" role="status">Beat {pending.slot === a ? 'A' : 'B'} selected. Saving your vote…</p>}
      {voteError && <p className="error" role="alert">{voteError}</p>}
      {viewIdx !== null && (
        <div className="row" style={{ marginTop: 14, justifyContent: 'space-between' }}>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!!pending || idx === 0} onClick={() => setViewIdx(idx - 1)}>Previous</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!!pending} onClick={() => setViewIdx(idx + 1 >= matchups.length ? null : idx + 1)}>Next</button>
        </div>
      )}
    </section>
  );
}

export function Reveal({ room, slot }: P) {
  const rows = standings(room);
  return (
    <section className="panel">
      <div className="panel-head"><h2>Results</h2><span className="hint">Ranked by win percentage. Every beat has equal scheduled exposure; completed reviews may vary if someone hasn’t finished voting. Ties share a rank.</span></div>
      <div className="stack">
        {rows.map((r) => (
          <div key={r.slot} className="rank" data-me={r.slot === slot}>
            <span className="pos">{r.rank}</span>
            <div className="stack" style={{ gap: 8 }}>
              <span className="row" style={{ gap: 8 }}><SeatChip room={room} slot={r.slot} />{r.slot === slot && <span className="hint">you</span>}</span>
              <BeatPlayer id={`reveal-${r.slot}`} beat={votingBeat(room, r.slot)} label={`${playerName(room, r.slot)}’s beat`} />
            </div>
            <span className="mono" style={{ fontFamily: 'var(--mono)' }}>{r.wins}/{r.judged} wins<br /><span className="hint">{r.judged}/{r.assigned} reviews</span></span>
            <strong style={{ fontFamily: 'var(--mono)' }}>{r.judged ? `${Math.round(r.rate * 100)}%` : '—'}</strong>
          </div>
        ))}
      </div>
      <p className="hint" style={{ marginTop: 14 }}>Next: Flip Back. You’ll be paired with someone whose taste matches yours to finish each other’s beats.</p>
    </section>
  );
}

export function SubmissionFeedback({ room, slot }: { room: RoomState; slot?: SlotId }) {
  if (PHASES.indexOf(room.phase) < PHASES.indexOf('reveal')) return null;
  const creators = (room.voting || { slots: standings(room).map(row => row.slot) }).slots;
  return <section className="panel">
    <div className="panel-head"><h2>Comments on every submission</h2><span className="hint">Feedback from blind voting · visible to everyone after reveal</span></div>
    <div className="stack">{creators.map(creator => {
      const feedback = feedbackFor(room, creator);
      return <article key={creator} className="card stack">
        <h3>{playerName(room, creator)}’s submission{creator === slot ? ' · yours' : ''}</h3>
        <BeatPlayer id={`feedback-${creator}`} beat={votingBeat(room, creator)} label={`${playerName(room, creator)}’s submission`} />
        {feedback.length ? feedback.map(note => <div key={note.author} className="card stack">
          <SeatChip room={room} slot={note.author} /><p className="feedback-text">{note.text}</p>
        </div>) : <p className="hint">No comments were left on this submission.</p>}
      </article>;
    })}</div>
  </section>;
}

function MatchCard({ room, slot, partner }: P & { partner: SlotId }) {
  const shared = tagOverlap(room, slot, partner);
  const t = room.players[partner]?.taste;
  return (
    <section className="panel row" style={{ justifyContent: 'space-between', gap: 14 }}>
      <div className="stack" style={{ gap: 6 }}>
        <span className="hint" style={{ textTransform: 'uppercase', letterSpacing: '.6px', fontWeight: 600 }}>Your match</span>
        <div className="row" style={{ gap: 10 }}><SeatChip room={room} slot={partner} />{t && <span>dropped <strong>{t.song}</strong></span>}</div>
      </div>
      <div className="row" style={{ gap: 6 }}>
        {shared.length ? <>
          <span className="hint">You both picked</span>{shared.map((tg) => <span key={tg} className="tag tag-sm">{tg}</span>)}
        </> : <span className="hint">Different tastes, different sounds: a good mix.</span>}
      </div>
    </section>
  );
}

export function FlipBack({ room, store, slot }: PS) {
  const partner = room.pairs?.[slot];
  if (!partner) {
    return <section className="panel big-center"><h1>Finding your match…</h1><p>Matching runs automatically from your vibe tags. At least two players are needed.</p></section>;
  }
  return <FlipEditor key={partner} room={room} store={store} slot={slot} partner={partner} />;
}

function FlipEditor({ room, store, slot, partner }: PS & { partner: SlotId }) {
  const mine = room.players[slot]?.flip;
  const original = normalizeBeat(room.players[partner]?.beat);
  const start = mine && mine.of === partner ? normalizeBeat(mine.beat) : cloneBeat(original);
  const [edits, setEdits] = useState(mine && mine.of === partner ? mine.edits : 0);
  const done = !!(mine && mine.of === partner && mine.done);
  const editsRef = useRef(edits);
  editsRef.current = edits;
  const [beat, setBeat, replace, cancelSave] = useSyncedBeat(start, (b) => store.update({ [`players.${slot}.flip`]: { of: partner, beat: b, edits: editsRef.current, done: false } }, room.battle?.id), done ? undefined : `flipthis.draft.${room.lobby?.code || 'demo'}.${room.battle?.id || 'legacy'}.${slot}.flip.${partner}`);
  const bank = playerBank(room.players[slot], slot, room);

  const onChange = (b: Beat) => { setEdits(edits + 1); editsRef.current = edits + 1; setBeat(b); };
  const resetAll = () => { setEdits(0); editsRef.current = 0; replace(cloneBeat(original)); store.update({ [`players.${slot}.flip`]: { of: partner, beat: original, edits: 0, done: false } }); };
  const finish = () => { stopAll(); cancelSave(); store.update({ [`players.${slot}.flip`]: { of: partner, beat, edits, done: true } }); };

  const actions = done ? (
    <><span className="ok row" style={{ gap: 6 }}><CheckIcon /> Sent to {playerName(room, partner)}</span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => store.update({ [`players.${slot}.flip.done`]: false })}>Keep editing</button></>
  ) : (
    <><span className="edits" aria-live="polite">{edits} edits · unlimited</span>
      <button type="button" className="btn btn-ghost btn-sm" disabled={edits === 0} onClick={resetAll}>Undo all</button>
      <button type="button" className="btn btn-dark" onClick={finish}>Done</button></>
  );

  return (
    <>
      <MatchCard room={room} slot={slot} partner={partner} />
      <Studio playKey={`flip-${slot}`} beat={beat} onChange={onChange} canEdit={!done} actions={actions}
        loops={[...battleSample(room).loops, ...bank.loops]} loopsTitle={`Flip ${playerName(room, partner)}’s beat`}
        loopsHint="Add your sounds to their beat. Unlimited edits — press Done when you’re ready." />
    </>
  );
}

export function TeamUp({ room, store, slot }: PS) {
  const partner = room.pairs?.[slot];
  useEffect(() => () => stopAll(), []);
  if (!partner) return <section className="panel big-center"><h1>No partner this round</h1><p>Odd numbers happen. You’ll be first in line next battle.</p></section>;
  const incoming = joinedSlots(room).find(s => room.pairs?.[s] === slot);
  const incomingName = incoming ? playerName(room, incoming) : 'Your collaborator';
  const theirFlip = incoming ? room.players[incoming]?.flip : undefined;
  const group = collaborationGroups(room).find(g => g.includes(slot)) || [slot, partner];
  const others = group.filter(s => s !== slot);
  const groupNames = others.map(s => playerName(room, s)).join(' and ');
  const waiting = others.some(s => room.players[s]?.teamUp == null);
  const allYes = group.every(s => room.players[s]?.teamUp === true);
  const myFlip = room.players[slot]?.flip;
  const mine = room.players[slot]?.teamUp;
  const name = playerName(room, partner);
  const answer = (v: boolean) => store.update({ [`players.${slot}.teamUp`]: v });

  return (
    <>
      <section className="panel">
        <div className="panel-head"><h2>Hear what you made together</h2></div>
        <div className="versus">
          <div className="choice">
            <h3>Your beat, flipped by {incomingName}</h3>
            {theirFlip && theirFlip.of === slot ? <BeatPlayer id="tu-mine" beat={normalizeBeat(theirFlip.beat)} label={`your beat flipped by ${incomingName}`} big />
              : <p className="hint" style={{ margin: 0 }}>{incomingName} hasn’t sent a flip yet.</p>}
            <span className="hint">Original:</span>
            <BeatPlayer id="tu-mine-orig" beat={normalizeBeat(room.players[slot]?.beat)} label="your original beat" />
          </div>
          <span className="vs" aria-hidden="true">+</span>
          <div className="choice">
            <h3>{name}’s beat, flipped by you</h3>
            {myFlip && myFlip.of === partner ? <BeatPlayer id="tu-theirs" beat={normalizeBeat(myFlip.beat)} label={`${name}'s beat flipped by you`} big />
              : <p className="hint" style={{ margin: 0 }}>You didn’t send a flip.</p>}
            <span className="hint">Original:</span>
            <BeatPlayer id="tu-theirs-orig" beat={normalizeBeat(room.players[partner]?.beat)} label={`${name}'s original beat`} />
          </div>
        </div>
      </section>
      <section className="panel big-center" style={{ padding: 28 }}>
        {mine === undefined || mine === null ? (
          <>
            <h1>Form a crew with {groupNames}?</h1>
            <p>A crew forms only when everyone in this remix group says yes.</p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button type="button" className="btn btn-primary" onClick={() => answer(true)}>Yes, form a crew</button>
              <button type="button" className="btn" onClick={() => answer(false)}>Not this time</button>
            </div>
          </>
        ) : waiting ? (
          <><h1>Answer saved</h1><p>Waiting for your collaborators to answer.</p>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => store.update({ [`players.${slot}.teamUp`]: null })}>Change my answer</button></>
        ) : allYes ? (
          <><h1>You, {groupNames}: a crew</h1><p>You all chose to collaborate again.</p></>
        ) : (
          <><h1>No crew this time</h1><p>Thanks for trying a collaboration together.</p></>
        )}
      </section>
    </>
  );
}

export function Done({ room, slot }: P) {
  const crews = collaborationGroups(room).filter(group => group.every(s => room.players[s]?.teamUp === true));
  return (
    <section className="panel big-center">
      <h1>That’s the battle</h1>
      <p>{crews.length ? `${crews.length} ${crews.length === 1 ? 'crew' : 'crews'} formed today.` : 'No crews formed this time, which is useful to know too.'}</p>
      <div className="stack">{crews.map(group => <div key={group.join('-')} className="row" style={{ justifyContent: 'center' }}>{group.map(s => <SeatChip key={s} room={room} slot={s} />)}</div>)}</div>
      {SURVEY_URL && <a className="btn btn-primary" href={SURVEY_URL} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>Give feedback (2 min)</a>}
      <p className="hint">Thanks for playing{room.players[slot]?.name ? `, ${room.players[slot]!.name}` : ''}.</p>
    </section>
  );
}

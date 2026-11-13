'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BATTLE_NAME, BPM, KEY_LABEL, PHASES, PHASE_LABELS, PHASE_MINUTES, SLOTS, type Phase, type SlotId } from '@/lib/config';
import { sampleBars, normalizeBeat } from '@/lib/beat';
import { everyoneSampleReady, sampleReady, automaticPairs, botComments, botFlip, botPlayer, botVotes, joinedSlots, playerName, standings, tagOverlap } from '@/lib/game';
import { createVoting, eligibleSlots, votingBeat } from '@/lib/voting';
import { clearSession, loadSession, invitePath, type Session } from '@/lib/session';
import { useNow, useRoom, type Patch } from '@/lib/store';
import type { RoomState } from '@/lib/types';
import { Chassis, PhasePills, formatClock } from '@/components/Chassis';
import { battleSample } from '@/lib/battle';
import { BeatPlayer } from '@/components/Playback';
import { LobbyInvite } from '@/components/LobbyInvite';
import { SubmissionFeedback } from '@/components/Screens';
import { SampleBriefing } from '@/components/SampleBriefing';
import { RoomChat } from '@/components/RoomChat';

const PHASE_HELP: Record<Phase, string> = {
  lobby: 'Up to 20 players join with the room invite. Demo room size is adjustable below.',
  taste: 'Everyone drops one song and 2 vibe tags. These tags pick the Flip Back pairs.',
  sample: 'Listen to the shared sample. Everyone readies up before the host starts Flip.',
  studio: 'Everyone flips the shared battle sample with their own sample bank and any drum kit.',
  vote: 'Blind A/B votes. Each player judges the matchups that don’t include their own beat.',
  reveal: 'Names and scores are revealed. Check the Flip Back pairs below before moving on.',
  flipback: 'Partners swap beats and remix freely with unlimited edits.',
  teamup: 'Partners hear both flips and privately answer: team up for the next battle?',
  done: 'Crews are shown. Point people to the feedback survey.',
};

export default function HostPage() {
  const router = useRouter();
  const { room, store, mode, error } = useRoom();
  const [session, setSession] = useState<Session | null>(null);
  const now = useNow();
  const [origin, setOrigin] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const [demoSize, setDemoSize] = useState(4);

  useEffect(() => {
    const s = loadSession();
    if (!s || s.role !== 'host') { router.replace(`/${window.location.search}`); return; }
    setSession(s);
    setOrigin(window.location.origin);
  }, [router]);

  if (!session || !room || !store) return <main className="page"><div className="chassis"><div className="panel big-center"><p>{error || 'Connecting to the room…'}</p>{error && <a className="btn btn-ghost" href={session?.roomId ? invitePath(session.roomId, session.transport) : '/'}>Return to lobby / reconnect</a>}</div></div></main>;

  const idx = PHASES.indexOf(room.phase);
  const left = room.phaseEndsAt ? room.phaseEndsAt - now : null;
  const joined = joinedSlots(room);
  const voting = room.voting || createVoting(room);
  const bots = joined.filter((s) => room.players[s]?.bot);

  const goTo = (phase: Phase) => {
    if (room.phase === 'sample' && phase === 'studio' && !everyoneSampleReady(room)) return;
    const mins = PHASE_MINUTES[phase];
    const patch: Patch = { phase, phaseEndsAt: mins ? Date.now() + mins * 60000 : null };
    if (phase === 'vote' && !room.voting) {
      if (eligibleSlots(room).length < 3) return;
      patch.voting = createVoting(room);
    }
    const voteRoom = patch.voting ? { ...room, voting: patch.voting as NonNullable<RoomState['voting']> } : room;
    // Demo seats act on their own at each step.
    if (phase === 'vote' || phase === 'reveal' || phase === 'flipback' || phase === 'teamup' || phase === 'done') {
      for (const b of bots) if (!Object.keys(room.players[b]?.votes || {}).length) {
        patch[`players.${b}.votes`] = botVotes(voteRoom, b);
        patch[`players.${b}.comments`] = botComments(voteRoom, b);
      }
    }
    let pairs = room.pairs;
    if ((phase === 'flipback' || phase === 'teamup') &&
        (!pairs || joined.some(s => !pairs?.[s]) || (phase === 'flipback' && !joined.some(s => room.players[s]?.flip)))) {
      pairs = automaticPairs(room); patch.pairs = pairs;
    }
    if ((phase === 'flipback' || phase === 'teamup') && pairs) {
      for (const b of bots) { const p = pairs[b]; if (p && room.players[b]?.flip?.of !== p) patch[`players.${b}.flip`] = botFlip(room, b, p); }
    }
    if (phase === 'teamup' || phase === 'done') for (const b of bots) if (room.players[b]?.teamUp == null) patch[`players.${b}.teamUp`] = true;
    store.update(patch);
  };

  const fillBots = () => {
    const patch: Patch = {};
    let remaining = demoSize - joined.length;
    for (const s of SLOTS) if (!room.players[s.id] && remaining > 0) { patch[`players.${s.id}`] = botPlayer(s.id, room); remaining--; }
    store.update(patch);
  };

  const matches = room.pairs || automaticPairs(room);

  return (
    <Chassis
      left={<>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="brand">flip<span>this</span></div>
          <span className="chip-mono">HOST</span>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <span className="hint">Join at</span>
          <strong style={{ fontFamily: 'var(--mono)', fontSize: 15, wordBreak: 'break-all' }}>{origin || '…'}</strong>
          <span className="hint">{mode === 'online' ? 'Online lobby: share the invite below.' : 'Local practice: only tabs in this browser share the room.'}</span>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { clearSession(); router.push('/'); }}>Leave host panel</button>
      </>}
      screen={<>
        <div className="screen-top">
          <span className="screen-label">{BATTLE_NAME.toUpperCase()} · {BPM} BPM · {KEY_LABEL}</span>
          <span className="screen-big">{formatClock(left)}</span>
        </div>
        <div className="screen-title">{PHASE_LABELS[room.phase]}</div>
        <PhasePills phase={room.phase} />
        <div className="screen-label">SAMPLE: {battleSample(room).label}</div>
        <div className="screen-label">{joined.length}/{SLOTS.length} PLAYERS · {PHASE_HELP[room.phase].toUpperCase()}</div>
      </>}
    >
      {error && <p className="error" role="alert">{error}</p>}
      <LobbyInvite room={room} transport={session.transport} />
      <section className="panel">
        <div className="panel-head">
          <h2>Run the battle</h2>
          <span className="hint">Phase timers are a guide. Nothing moves until you press Next.</span>
        </div>
        <p className="hint">This is the host panel — it runs the battle but has no studio. Want to play too? Open the invite link in another tab and join with your name.</p>
        <div className="row">
          <button type="button" className="btn" disabled={idx === 0} onClick={() => goTo(PHASES[idx - 1])}>Back</button>
          <button type="button" className="btn btn-primary" disabled={idx === PHASES.length - 1 || (room.phase === 'sample' && !everyoneSampleReady(room)) || (room.phase === 'studio' && !room.voting && eligibleSlots(room).length < 3)} onClick={() => goTo(PHASES[idx + 1])}>
            Next: {idx < PHASES.length - 1 ? PHASE_LABELS[PHASES[idx + 1]] : 'end'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => store.update({ phaseEndsAt: (room.phaseEndsAt && room.phaseEndsAt > Date.now() ? room.phaseEndsAt : Date.now()) + 60000 })}>+1 min</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => store.update({ phaseEndsAt: null })}>Clear timer</button>
          <span className="grow" />
          <label className="field">Demo room size
            <input className="input" type="number" min={3} max={20} value={demoSize} onChange={e => setDemoSize(Math.max(3, Math.min(20, Number(e.target.value) || 3)))} style={{ width: 90 }} />
          </label>
          <button type="button" className="btn btn-ghost btn-sm" disabled={joined.length >= demoSize || !!room.voting} onClick={fillBots}>Fill to {demoSize} with demo players</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmReset(true)}>New battle / reset</button>
        </div>
      </section>

      {room.phase === 'sample' && <SampleBriefing room={room} />}

      {room.phase === 'studio' && <p className="hint">{eligibleSlots(room).length}/{joined.length} eligible submissions. At least three are needed to vote. Starting voting locks the eligible beats and a balanced schedule of at most six matchups per person.</p>}

      <RoomChat key={room.battle?.id || 'legacy'} room={room} store={store} author="host" />
      <SubmissionFeedback room={room} />

      <section className="panel">
        <div className="panel-head"><h2>Players</h2><span className="hint">{room.lobby ? 'Seats assigned automatically · 20-player maximum' : 'Classic demo codes: PLAYER1–PLAYER20'}</span></div>
        <div className="scroll-x">
          <table className="status-grid">
            <thead><tr><th>Seat</th><th>Name</th><th>Taste</th><th>Sample ready</th><th>Beat</th><th>Votes</th><th>Flip Back</th><th>Team up</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {SLOTS.map((s) => {
                const p = room.players[s.id];
                const beat = p?.beat ? normalizeBeat(p.beat) : null;
                const nVotes = Object.keys(p?.votes || {}).length;
                const needVotes = voting.schedule[s.id]?.length || 0;
                return (
                  <tr key={s.id}>
                    <td><span className="row" style={{ gap: 6 }}><span className="dot" style={{ background: s.color }} /><code>{s.code}</code></span></td>
                    <td>{p ? <>{p.name}{p.bot && <span className="hint"> · demo</span>}</> : <span className="no">Empty</span>}</td>
                    <td>{p?.taste ? <>{p.taste.tags.join(', ')}</> : <span className="no">–</span>}</td>
                    <td>{p ? <span className={sampleReady(room, s.id) ? 'ok' : 'no'}>{sampleReady(room, s.id) ? 'Ready' : '–'}</span> : '–'}</td>
                    <td>{beat ? <span className={p?.submitted ? 'ok' : ''}>{p?.submitted ? 'Submitted' : 'Building'} · sample {sampleBars(beat)} bars</span> : <span className="no">–</span>}</td>
                    <td>{p ? `${nVotes}/${needVotes}` : '–'}</td>
                    <td>{p?.flip ? <span className={p.flip.done ? 'ok' : ''}>{p.flip.done ? 'Sent' : 'Editing'} · {p.flip.edits} edits</span> : <span className="no">–</span>}</td>
                    <td>{p?.teamUp == null ? <span className="no">–</span> : p.teamUp ? <span className="ok">Yes</span> : 'No'}</td>
                    <td>{p && <button type="button" className="btn btn-ghost btn-sm" onClick={() => store.removePlayer ? store.removePlayer(s.id) : store.update({ [`players.${s.id}`]: null })} aria-label={`Clear seat ${s.code}`}>Clear</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>Automatic taste matches</h2><span className="hint">Shared tags are matched ignoring case, spacing, and leading # signs. Ties use seat order. Matches lock when Flip Back starts.</span></div>
        {joined.length < 2 ? <p className="hint">Waiting for at least two players.</p> : (
          <div className="card-list">
            {Object.entries(matches).map(([a, b]) => (
              <div key={a} className="card stack">
                <span><strong>{playerName(room, a as SlotId)}</strong> remixes <strong>{playerName(room, b)}</strong></span>
                <span className="hint">{tagOverlap(room, a as SlotId, b).length ? `Shared: ${tagOverlap(room, a as SlotId, b).join(', ')}` : 'Different tastes — a chance to try something new.'}</span>
              </div>
            ))}
          </div>
        )}
        {joined.length >= 3 && joined.length % 2 === 1 && <p className="hint">One remix circle of three plus pairs: everyone gives and receives a flip. Each group forms a crew only if everyone in it agrees.</p>}
      </section>

      {(room.phase === 'reveal' || idx > PHASES.indexOf('reveal')) && (
        <section className="panel">
          <div className="panel-head"><h2>Leaderboard</h2><span className="hint">Play beats here to show them on the projector.</span></div>
          <div className="stack">
            {standings(room).map((r) => (
              <div key={r.slot} className="rank">
                <span className="pos">{r.rank}</span>
                <div className="stack" style={{ gap: 8 }}><Seat room={room} s={r.slot} /><BeatPlayer id={`host-${r.slot}`} beat={votingBeat(room, r.slot)} label={`${playerName(room, r.slot)}’s beat`} /></div>
                <span style={{ fontFamily: 'var(--mono)' }}>{r.wins}/{r.judged} wins · {r.judged}/{r.assigned} reviews</span>
                <strong style={{ fontFamily: 'var(--mono)' }}>{r.judged ? `${Math.round(r.rate * 100)}%` : '—'}</strong>
              </div>
            ))}
          </div>
        </section>
      )}

      {confirmReset && (
        <div className="dialog-back" role="dialog" aria-modal="true" aria-labelledby="reset-title">
          <div className="dialog">
            <h2 id="reset-title">Start a new battle?</h2>
            <p className="hint" style={{ margin: 0 }}>This clears beats, votes, feedback and chat, rotates the shared sample, and reshuffles unique packs. In named lobbies, player identities and invite links are kept so everyone can play again.</p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setConfirmReset(false)}>Cancel</button>
              <button type="button" className="btn btn-dark" onClick={() => { store.reset(); setConfirmReset(false); }}>New battle / reset</button>
            </div>
          </div>
        </div>
      )}
    </Chassis>
  );
}

function Seat({ room, s }: { room: RoomState; s: SlotId }) {
  return <span className="chip"><span className="dot" style={{ background: SLOTS.find((x) => x.id === s)!.color }} />{playerName(room, s)}</span>;
}

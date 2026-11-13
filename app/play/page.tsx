'use client';
import { useEffect, useState } from 'react';
import { useSyncedBeat } from '@/lib/useSyncedBeat';
import { useRouter } from 'next/navigation';
import { BATTLE_NAME, BPM, KEY_LABEL, PHASE_LABELS, SLOT_BY_ID, type SlotId } from '@/lib/config';
import { normalizeBeat, sampleBars, canSubmit as beatReady } from '@/lib/beat';
import { joinedSlots, playerName } from '@/lib/game';
import { loadSession, saveSession, clearSession, invitePath, type Session } from '@/lib/session';
import { playerBank, randomBank } from '@/lib/packs';
import { useNow, useRoom } from '@/lib/store';
import type { RoomState } from '@/lib/types';
import type { RoomStore } from '@/lib/store';
import { Chassis, PhasePills, formatClock } from '@/components/Chassis';
import { Studio } from '@/components/Studio';
import { Lobby, TasteDrop, Vote, Reveal, FlipBack, TeamUp, Done, SubmissionFeedback } from '@/components/Screens';
import { MIN_SAMPLE_BARS } from '@/lib/config';
import { battleSample } from '@/lib/battle';
import { CheckIcon } from '@/components/Icons';
import { PhaseInstructions } from '@/components/PhaseInstructions';
import { SampleBriefing } from '@/components/SampleBriefing';
import { RoomChat } from '@/components/RoomChat';

export default function PlayPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const { room, store, error } = useRoom();
  const now = useNow();

  useEffect(() => {
    const s = loadSession();
    if (!s || s.role !== 'player' || !s.slot) { router.replace(`/${window.location.search}`); return; }
    if (!s.bank) { s.bank = randomBank(); saveSession(s); }
    setSession(s);
  }, [router]);

  // Take the seat (or update the name) once the room has loaded.
  useEffect(() => {
    if (!room || !store || !session?.slot) return;
    const me = room.players[session.slot];
    if (!me && session.roomId) return;
    if (!me) store.update({ [`players.${session.slot}`]: { name: session.name, joinedAt: Date.now(), bank: room.battle?.packs[session.slot] || session.bank } });
    else if (me.name !== session.name && !me.bot) store.update({ [`players.${session.slot}.name`]: session.name });
  }, [room, store, session]);

  if (!session?.slot || !room || !store || !room.players[session.slot]) {
    return <main className="page"><div className="chassis"><div className="panel big-center"><p>{error || 'Connecting to the room…'}</p>{error && <a className="btn btn-ghost" href={session?.roomId ? invitePath(session.roomId, session.transport) : '/'}>Return to lobby / reconnect</a>}</div></div></main>;
  }

  const slot = session.slot;
  const seat = SLOT_BY_ID[slot];
  const bank = playerBank(room.players[slot], slot, room);
  const left = room.phaseEndsAt ? room.phaseEndsAt - now : null;

  return (
    <Chassis
      left={<>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="brand">flip<span>this</span></div>
          <span className="chip-mono">SEAT {seat.code}</span>
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 8 }}>
            <span className="dot" style={{ background: seat.color, width: 16, height: 16 }} />
            <strong>{session.name}</strong>
            <span className="hint">· {bank.label}</span>
          </div>
          <div className="row" style={{ gap: 6 }}>
            {joinedSlots(room).filter((s) => s !== slot).map((s) => (
              <span key={s} className="chip"><span className="dot" style={{ background: SLOT_BY_ID[s].color }} />{playerName(room, s)}</span>
            ))}
          </div>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { clearSession(); router.push('/'); }}>Leave seat</button>
      </>}
      screen={<>
        <div className="screen-top">
          <span className="screen-label">{BATTLE_NAME.toUpperCase()} · {BPM} BPM · {KEY_LABEL}</span>
          <span className="screen-big" aria-label="Time left">{formatClock(left)}</span>
        </div>
        <div className="screen-title">{PHASE_LABELS[room.phase]}</div>
        <PhasePills phase={room.phase} />
        <div className="screen-label">SAMPLE: {battleSample(room).label}</div>
      </>}
    >
      {error && <p className="error" role="alert">{error} Your work stays on this device while the connection recovers.</p>}
      <PhaseInstructions phase={room.phase} />
      <PhaseView room={room} store={store} slot={slot} />
      <RoomChat key={`crew-${room.battle?.id || 'legacy'}`} room={room} store={store} author={slot} crew />
      <RoomChat key={room.battle?.id || 'legacy'} room={room} store={store} author={slot} />
      <SubmissionFeedback room={room} slot={slot} />
    </Chassis>
  );
}

function PhaseView({ room, store, slot }: { room: RoomState; store: RoomStore; slot: SlotId }) {
  switch (room.phase) {
    case 'lobby': return <Lobby room={room} slot={slot} />;
    case 'taste': return <TasteDrop room={room} store={store} slot={slot} />;
    case 'sample': return <SampleBriefing room={room} store={store} slot={slot} />;
    case 'studio': return <MyStudio room={room} store={store} slot={slot} />;
    case 'vote': return <Vote room={room} store={store} slot={slot} />;
    case 'reveal': return <Reveal room={room} slot={slot} />;
    case 'flipback': return <FlipBack room={room} store={store} slot={slot} />;
    case 'teamup': return <TeamUp room={room} store={store} slot={slot} />;
    case 'done': return <Done room={room} slot={slot} />;
  }
}

function MyStudio({ room, store, slot }: { room: RoomState; store: RoomStore; slot: SlotId }) {
  const me = room.players[slot];
  const bank = playerBank(me, slot, room);
  const [beat, setBeat, , cancelSave] = useSyncedBeat(normalizeBeat(me?.beat), (b) => store.update({ [`players.${slot}.beat`]: b }, room.battle?.id), me?.submitted ? undefined : `flipthis.draft.${room.lobby?.code || 'demo'}.${room.battle?.id || 'legacy'}.${slot}`);
  const submitted = !!me?.submitted;
  const ready = beatReady(beat);

  const actions = submitted ? (
    <>
      <span className="ok row" style={{ gap: 6 }}><CheckIcon /> Submitted</span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => store.update({ [`players.${slot}.submitted`]: false })}>Keep editing</button>
    </>
  ) : (
    <>
      <span className={ready ? 'ok' : 'hint'}>Sample in {sampleBars(beat)}/{MIN_SAMPLE_BARS}+ bars</span>
      <button type="button" className="btn btn-dark" disabled={!ready}
        onClick={() => { cancelSave(); store.update({ [`players.${slot}.beat`]: beat, [`players.${slot}.submitted`]: true }); }}>
        Submit beat
      </button>
    </>
  );

  return (
    <Studio playKey={`studio-${slot}`} beat={beat} onChange={setBeat} canEdit={!submitted} actions={actions}
      loops={[...battleSample(room).loops, ...bank.loops]} loopsTitle="Loops"
      loopsHint={`Shared sample + your ${bank.label.toLowerCase()}`} />
  );
}

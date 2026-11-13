'use client';
import { useState } from 'react';
import { battleSample } from '@/lib/battle';
import { BPM, KEY_LABEL, SLOT_BY_ID, type SlotId } from '@/lib/config';
import { joinedSlots, playerName, sampleReady } from '@/lib/game';
import type { RoomState } from '@/lib/types';
import type { RoomStore } from '@/lib/store';

export function SampleBriefing({ room, store, slot }: { room: RoomState; store?: RoomStore; slot?: SlotId }) {
  const sample = battleSample(room);
  const players = joinedSlots(room);
  const ready = players.filter(id => sampleReady(room, id));
  const mine = slot ? sampleReady(room, slot) : false;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function toggleReady() {
    if (!store || !slot || saving) return;
    setSaving(true); setError('');
    try { await store.update({ [`players.${slot}.sampleReady`]: !mine }, room.battle?.id); }
    catch { setError('Could not save your ready status. Please try again.'); }
    finally { setSaving(false); }
  }
  return <section className="panel big-center sample-briefing">
    <span className="chip-mono">THE SHARED BATTLE SAMPLE · {BPM} BPM · {KEY_LABEL}</span>
    <h1>{sample.label}</h1>
    <p>Everyone starts with this sound. Listen and imagine how you’ll flip it.</p>
    <audio key={sample.loops[0].file} controls preload="metadata" aria-label="Listen to the battle sample" src={sample.loops[0].file} />
    {slot && <button type="button" className={`btn ${mine ? 'btn-dark' : 'btn-primary'}`} disabled={saving} aria-pressed={mine} onClick={toggleReady}>{saving ? 'Saving…' : mine ? 'Ready! Click to unready' : 'I’m ready for the battle'}</button>}
    {error && <p className="error" role="alert">{error}</p>}
    <p role="status"><strong>{ready.length}/{players.length} ready</strong> · {players.length < 3 ? 'At least three players are needed.' : 'The host starts the battle when everyone is ready.'}</p>
    <div className="row" style={{ justifyContent: 'center' }}>{players.map(id => <span className="chip" key={id}><span className="dot" style={{ background: SLOT_BY_ID[id].color }} />{playerName(room, id)} · {sampleReady(room, id) ? 'Ready' : 'Listening'}</span>)}</div>
  </section>;
}

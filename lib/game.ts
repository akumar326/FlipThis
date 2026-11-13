import { BARS, LOOP_BARS, SLOTS, type SlotId } from './config';
import type { RoomState } from './types';
import { createVoting, votingBeat } from './voting';

export const pairKey = (a: SlotId, b: SlotId) => [a, b].sort().join('_');

/** Slots that have joined, in seat order. */
export function joinedSlots(room: RoomState): SlotId[] {
  return SLOTS.map((s) => s.id).filter((id) => !!room.players[id]);
}

/** Only locked submissions participate once voting starts. */
export function beatSlots(room: RoomState): SlotId[] {
  return room.voting?.slots || createVoting(room).slots;
}

export function matchupsFor(room: RoomState, voter: SlotId): [SlotId, SlotId][] {
  return (room.voting || createVoting(room)).schedule[voter] || [];
}

export interface Standing { slot: SlotId; wins: number; judged: number; assigned: number; rate: number; points: number; rank: number }
export function standings(room: RoomState): Standing[] {
  const voting = room.voting || createVoting(room);
  const rows: Standing[] = voting.slots.map(slot => ({ slot, wins: 0, judged: 0, assigned: 0, rate: 0, points: 10, rank: 0 }));
  const byId = new Map(rows.map(r => [r.slot, r]));
  for (const voter of voting.slots) for (const [a, b] of voting.schedule[voter] || []) {
    const ra = byId.get(a), rb = byId.get(b);
    if (!ra || !rb) continue;
    ra.assigned++; rb.assigned++;
    const winner = room.players[voter]?.votes?.[pairKey(a, b)];
    if (winner !== a && winner !== b) continue;
    ra.judged++; rb.judged++;
    byId.get(winner)!.wins++;
  }
  for (const row of rows) { row.rate = row.judged ? row.wins / row.judged : 0; row.points = 10 + row.wins * 15; }
  rows.sort((a, b) => Number(b.judged > 0) - Number(a.judged > 0) || b.rate - a.rate || SLOTS.findIndex(s => s.id === a.slot) - SLOTS.findIndex(s => s.id === b.slot));
  rows.forEach((r, i) => { const previous = rows[i - 1]; r.rank = previous && previous.rate === r.rate && !!previous.judged === !!r.judged ? previous.rank : i + 1; });
  return rows;
}

export function tagOverlap(room: RoomState, a: SlotId, b: SlotId): string[] {
  const ta = normalizeTags(room.players[a]?.taste?.tags || []), tb = normalizeTags(room.players[b]?.taste?.tags || []);
  return ta.filter((t) => tb.includes(t));
}

export function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map(t => t.normalize('NFKC').trim().replace(/^#+/, '').trim().replace(/\s+/g, ' ').toLowerCase()).filter(Boolean))];
}

/** Maximum shared-tag matching, using a memoized subset search (up to 20 seats). */
export function bestPairing(room: RoomState, slots = joinedSlots(room)): [SlotId, SlotId][] {
  const memo = new Map<number, { score: number; pairs: [SlotId, SlotId][] }>();
  function solve(mask: number): { score: number; pairs: [SlotId, SlotId][] } {
    if (!mask) return { score: 0, pairs: [] };
    const cached = memo.get(mask); if (cached) return cached;
    let a = 0; while (!(mask & (1 << a))) a++;
    let best = { score: -1, pairs: [] as [SlotId, SlotId][] };
    for (let b = a + 1; b < slots.length; b++) {
      if (!(mask & (1 << b))) continue;
      const rest = solve(mask ^ (1 << a) ^ (1 << b));
      const score = rest.score + tagOverlap(room, slots[a], slots[b]).length;
      if (score > best.score) best = { score, pairs: [[slots[a], slots[b]], ...rest.pairs] };
    }
    memo.set(mask, best); return best;
  }
  return solve((1 << slots.length) - 1).pairs;
}

export function pairsToMap(pairs: [SlotId, SlotId][]): Partial<Record<SlotId, SlotId>> {
  const m: Partial<Record<SlotId, SlotId>> = {};
  for (const [a, b] of pairs) { m[a] = b; m[b] = a; }
  return m;
}

/** Even rooms form pairs; odd rooms add one taste-matched remix circle of three. */
export function automaticPairs(room: RoomState): Partial<Record<SlotId, SlotId>> {
  const slots = joinedSlots(room);
  if (slots.length < 2) return {};
  let trio: SlotId[] = [], best = -1;
  if (slots.length % 2) {
    for (let a = 0; a < slots.length; a++) for (let b = a + 1; b < slots.length; b++) for (let c = b + 1; c < slots.length; c++) {
      const score = tagOverlap(room, slots[a], slots[b]).length + tagOverlap(room, slots[b], slots[c]).length + tagOverlap(room, slots[c], slots[a]).length;
      if (score > best) { best = score; trio = [slots[a], slots[b], slots[c]]; }
    }
  }
  const pairs = pairsToMap(bestPairing(room, slots.filter(s => !trio.includes(s))));
  trio.forEach((s, i) => { pairs[s] = trio[(i + 1) % 3]; });
  return pairs;
}

/** Connected remix groups: pairs, or the full three-player circle. */
export function collaborationGroups(room: RoomState): SlotId[][] {
  const unseen = new Set(joinedSlots(room));
  const groups: SlotId[][] = [];
  for (const start of joinedSlots(room)) {
    if (!unseen.has(start)) continue;
    const group: SlotId[] = [], queue: SlotId[] = [start];
    while (queue.length) {
      const slot = queue.shift()!;
      if (!unseen.delete(slot)) continue;
      group.push(slot);
      for (const [a, b] of Object.entries(room.pairs || {}) as [SlotId, SlotId][]) {
        if (a === slot) queue.push(b);
        if (b === slot) queue.push(a);
      }
    }
    if (group.length > 1) groups.push(group.sort());
  }
  return groups;
}

export function playerName(room: RoomState, slot: SlotId): string {
  return room.players[slot]?.name || SLOTS.find((s) => s.id === slot)!.defaultName;
}

import { BANKS, KITS, SHARED_LOOPS, SLOT_BY_ID, type BankId } from './config';
import { playerBank, randomBank } from './packs';
import { upgradeDemoTaste } from './demoTaste';
import { battleSample } from './battle';
import { cloneBeat, emptyBeat } from './beat';
import type { Beat, PlayerState } from './types';

/** A reasonable beat for a demo seat, built from that seat's bank. */
export function botBeat(slot: SlotId, bankId?: BankId, samples = SHARED_LOOPS): Beat {
  const bank = (bankId ? BANKS[bankId] : playerBank(undefined, slot)).loops;
  const by = (lane: string) => bank.find((l) => l.lane === lane)!.id;
  const kit = KITS[(Number(slot.slice(1)) + 1) % KITS.length].id;
  const b = emptyBeat(kit);
  const chop = samples[Number(slot.slice(1)) % samples.length].id;
  for (let bar = 0; bar < BARS; bar++) {
    const phraseBar = bar % LOOP_BARS;
    if ([0, 1, 4, 5].includes(phraseBar)) b.place.sample[String(bar)] = chop;
    b.place.chords[String(bar)] = by('chords');
    if ([2, 3, 6, 7].includes(phraseBar)) b.place.melody[String(bar)] = by('melody');
    if (phraseBar >= 4) b.place.bass[String(bar)] = by('bass');
    if (phraseBar === 3) b.place.fx[String(bar)] = by('fx');
    b.drumOn[bar] = phraseBar >= 2;
  }
  return b;
}

export function botPlayer(slot: SlotId, room?: RoomState): PlayerState {
  const bank = room?.battle?.packs[slot] || randomBank();
  return upgradeDemoTaste({
    bank,
    name: `${SLOT_BY_ID[slot].defaultName} (demo)`, joinedAt: Date.now(), bot: true, submitted: true,
    beat: botBeat(slot, bank, room ? battleSample(room).loops : SHARED_LOOPS),
  }, slot);
}

/** Votes a demo seat casts: prefers the beat with more filled bars. */
export function botVotes(room: RoomState, slot: SlotId): Record<string, SlotId> {
  const fill = (s: SlotId) => Object.values(votingBeat(room, s).place || {}).reduce((n, m) => n + Object.keys(m || {}).length, 0);
  const out: Record<string, SlotId> = {};
  for (const [a, b] of matchupsFor(room, slot)) out[pairKey(a, b)] = fill(a) >= fill(b) ? a : b;
  return out;
}

export function botComments(room: RoomState, slot: SlotId): Partial<Record<SlotId, string>> {
  const comments: Partial<Record<SlotId, string>> = {};
  for (const pair of matchupsFor(room, slot)) for (const target of pair) {
    comments[target] = 'Demo feedback: Try a quieter section before the ending to give the final bars more contrast.';
  }
  return comments;
}

/** A demo seat's Flip Back: its partner's beat plus one of its own loops. */
export function botFlip(room: RoomState, slot: SlotId, partner: SlotId) {
  const base = room.players[partner]?.beat;
  const beat = base ? cloneBeat(base) : emptyBeat();
  const mel = playerBank(room.players[slot], slot, room).loops.find((l) => l.lane === 'melody')!.id;
  beat.place.melody['0'] = mel; beat.place.melody['1'] = mel;
  return { of: partner, beat, edits: 2, done: true };
}

/** Demo players are ready automatically; people explicitly ready up. */
export function sampleReady(room: RoomState, slot: SlotId) {
  return !!(room.players[slot]?.bot || room.players[slot]?.sampleReady);
}
export function everyoneSampleReady(room: RoomState) {
  const slots = joinedSlots(room);
  return slots.length >= 3 && slots.every(slot => sampleReady(room, slot));
}

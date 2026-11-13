import { BANKS, BATTLE_SAMPLES, SLOTS, type BankId, type SlotId } from './config';
import { EMPTY_ROOM, type RoomState, type BattleSetup } from './types';

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  const random = new Uint32Array(Math.max(1, out.length));
  crypto.getRandomValues(random);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random[i] / 0x100000000 * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function newBattleRoom(previous?: RoomState): RoomState {
  const banks = shuffle(Object.keys(BANKS) as BankId[]);
  // A returning seat also gets a different pack from the preceding battle.
  const repeats = SLOTS.map((s, i) => previous?.battle?.packs[s.id] === banks[i] ? i : -1).filter(i => i >= 0);
  if (repeats.length === 1) {
    const i = repeats[0], j = (i + 1) % banks.length;
    [banks[i], banks[j]] = [banks[j], banks[i]];
  } else if (repeats.length > 1) {
    const first = banks[repeats[0]];
    repeats.forEach((i, position) => { banks[i] = position === repeats.length - 1 ? first : banks[repeats[position + 1]]; });
  }
  const randomId = new Uint32Array(4);
  crypto.getRandomValues(randomId);
  const battle: BattleSetup = {
    id: Array.from(randomId, n => n.toString(16).padStart(8, '0')).join(''), sampleId: 'vocal', sampleQueue: [],
    packs: Object.fromEntries(SLOTS.map((s, i) => [s.id, banks[i]])) as Record<SlotId, BankId>,
  };
  return { ...EMPTY_ROOM, players: {}, battle, updatedAt: Date.now() };
}

export function battleSample(room: RoomState) {
  return BATTLE_SAMPLES.find(s => s.id === room.battle?.sampleId) || BATTLE_SAMPLES[0];
}

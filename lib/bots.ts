import { SLOTS, type Phase, type SlotId } from './config';
import type { Beat, RoomState } from './types';

export const BOT_PERSONALITIES = ['cheerleader', 'curious', 'dreamer', 'groove-lover', 'thoughtful', 'playful'] as const;
export type BotPersonality = typeof BOT_PERSONALITIES[number];
export interface BotProfile { personality: BotPersonality; seed: number }
export function randomBotProfile(): BotProfile {
  const random = crypto.getRandomValues(new Uint32Array(2));
  return { personality: BOT_PERSONALITIES[random[0] % BOT_PERSONALITIES.length], seed: random[1] };
}
function hash(text: string): number {
  let n = 2166136261;
  for (const char of text) n = Math.imul(n ^ char.charCodeAt(0), 16777619);
  return n >>> 0;
}
export function botProfile(room: RoomState, slot: SlotId): BotProfile {
  // Older saved demo players get a stable personality without changing their work.
  const saved = room.players[slot]?.botProfile;
  if (saved && BOT_PERSONALITIES.includes(saved.personality)) return saved;
  const seed = hash(`${room.battle?.id || 'legacy'}:${slot}`);
  return { personality: BOT_PERSONALITIES[seed % BOT_PERSONALITIES.length], seed };
}
const voices: Record<BotPersonality, { praise: string[]; chat: string[] }> = {
  cheerleader: {
    praise: ['You gave this flip a clear direction!', 'There’s a lot to celebrate in this idea.', 'Nice work turning a small idea into a complete flip!', 'This is a promising starting point for another collab.'],
    chat: ['Big welcome to everyone trying this for the first time!', 'Finishing a beat is a win. Glad we’re giving this a go together!', 'Love seeing everyone share their ideas. Keep going!'],
  },
  curious: {
    praise: ['This makes me curious about what you’ll try next.', 'I’d enjoy exploring another version of this idea with you.', 'There’s an interesting idea to build on here.', 'Thanks for sharing a different take on the same starting point.'],
    chat: ['What feeling are you hoping to put into your next flip?', 'What surprised you most about making something with a time limit?', 'I like hearing how differently people approach the same starting point.'],
  },
  dreamer: {
    praise: ['I can imagine a whole scene growing around this idea.', 'This feels like the beginning of a little story.', 'There’s room for an imaginative second chapter here.', 'I like the sense of possibility in this flip.'],
    chat: ['I’m going for a little daydream energy today. Happy to be here!', 'Hope everyone finds one small idea they want to keep exploring.', 'A shared sound can lead us into so many different worlds.'],
  },
  'groove-lover': {
    praise: ['There’s a nice foundation to keep building on.', 'I’d be up for trying another groove around this idea.', 'This gives a collaborator a useful starting point.', 'Good job giving the arrangement a shape to work with.'],
    chat: ['Excited to swap ideas with everyone. Simple beats are welcome too!', 'Anyone else enjoy trying a completely different drum kit halfway through?', 'A small loop and a little patience can go a long way. You’ve got this!'],
  },
  thoughtful: {
    praise: ['Thanks for putting a finished idea out there.', 'I appreciate having a clear idea to respond to.', 'There’s a thoughtful starting point for a remix here.', 'This gives us something concrete to explore together.'],
    chat: ['No pressure to make something perfect. I’m glad we’re experimenting.', 'Thanks for making space for everyone’s ideas.', 'A kind, specific note can make sharing unfinished work feel easier.'],
  },
  playful: {
    praise: ['This idea is worth taking for another spin!', 'You’ve given the next remix some room to play.', 'There’s a fun experiment waiting in the next version.', 'Nice! I’d happily try a playful variation on this.'],
    chat: ['Tiny beat, big possibilities. Happy experimenting, everyone!', 'If your first idea gets weird, that still counts as an idea!', 'New remix buddies? Yes please. Hope everyone’s having fun!'],
  },
};
export function botFeedback(room: RoomState, author: SlotId, target: SlotId, beat: Beat): string {
  const profile = botProfile(room, author);
  const seat = SLOTS.findIndex(slot => slot.id === target);
  const n = (profile.seed % 10000) + seat;
  const observations: string[] = [];
  if (Object.keys(beat.place.sample).length) observations.push('You brought the shared sample into the arrangement.');
  if (Object.keys(beat.place.chords).length) observations.push('The chord lane gives this version another layer.');
  if (Object.keys(beat.place.melody).length) observations.push('There’s a melody layer for a collaborator to develop.');
  if (Object.keys(beat.place.bass).length) observations.push('You included a bass layer in the arrangement.');
  if (beat.drumOn.some(Boolean)) observations.push('You made space for a drum pattern in this flip.');
  if (beat.drumOn.some(Boolean) && beat.drumOn.some(on => !on)) observations.push('You varied which bars include drums.');
  const ideas = ['Try leaving one bar open to make the return stand out.', 'What happens if you introduce one layer a little later?', 'You could try a second version with a simpler ending.', 'I’d be curious to hear this with a different drum groove.', 'Try removing one layer for a moment, then bringing it back.', 'A short break could give your next section a fresh entrance.'];
  const endings = ['Keep exploring!', 'Thanks for sharing it.', 'I’d be happy to try another flip together.', 'There’s plenty here to build on.', 'Looking forward to your next idea.'];
  // The suggestion/ending pair cycles through 30 combinations before repeating.
  const text = `${voices[profile.personality].praise[(n + Math.floor(profile.seed / 10000)) % 4]} ${observations.length ? observations[n % observations.length] + ' ' : ''}${ideas[n % ideas.length]} ${endings[Math.floor(n / ideas.length) % endings.length]}`;
  return `Demo feedback: ${text}`.slice(0, 280);
}

const OPEN_PHASES: Phase[] = ['lobby', 'reveal', 'flipback', 'teamup', 'done'];
export function botChatIsDue(room: RoomState, now = Date.now()): boolean {
  const bots = SLOTS.filter(slot => room.players[slot.id]?.bot);
  if (!bots.length || !OPEN_PHASES.includes(room.phase)) return false;
  const state = room.botChatState;
  return !state || state.phase !== room.phase || (state.sent < 3 && now >= state.nextAt);
}
/** A shared saved schedule prevents duplicate chatter from two host tabs. */
export function planBotChat(room: RoomState, now = Date.now()): { state: NonNullable<RoomState['botChatState']>; message?: { author: SlotId; text: string } } | null {
  if (!botChatIsDue(room, now)) return null;
  const seed = hash(`${room.battle?.id || 'legacy'}:${room.phase}`);
  const current = room.botChatState;
  if (!current || current.phase !== room.phase) return { state: { phase: room.phase, sent: 0, nextAt: now + 8000 + seed % 7000 } };
  const previousAuthors = Object.values(room.chat || {}).filter(message => message.bot && message.phase === room.phase).map(message => message.author);
  const bots = SLOTS.filter(slot => room.players[slot.id]?.bot);
  const unused = bots.filter(slot => !previousAuthors.includes(slot.id));
  const pool = unused.length ? unused : bots;
  const author = pool[(seed + current.sent) % pool.length].id;
  const profile = botProfile(room, author);
  const history = Object.values(room.chat || {});
  const used = new Set(history.map(message => message.text));
  let candidates = voices[profile.personality].chat;
  if (room.phase === 'lobby') candidates = [...candidates, 'Hi everyone! Looking forward to trading ideas with you.'];
  if (room.phase === 'reveal') candidates = [...candidates, 'Congrats on getting your flips submitted. Thanks for sharing them!'];
  if (room.phase === 'teamup' || room.phase === 'done') candidates = [...candidates, 'Thanks for creating together today. Hope your next collab brings a good surprise!'];
  const fresh = candidates.filter(text => !used.has(text));
  if (!fresh.length) return { state: { ...current, sent: 3 } };
  const text = fresh[(profile.seed + current.sent) % fresh.length];
  return { state: { phase: room.phase, sent: current.sent + 1, nextAt: now + 25000 + (seed + profile.seed + current.sent * 3571) % 20000 }, message: { author, text } };
}

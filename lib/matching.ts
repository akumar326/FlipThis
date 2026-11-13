import { SLOTS, type SlotId } from './config';
import { songEmbed, spotifyTrackId } from './songs';
import type { RoomState, Taste } from './types';

/** Transparent local vocabulary; unknown custom tags still match by wording. */
const concepts: [string, RegExp][] = [
  ['calm', /\b(chill|chilled|relaxed|relaxing|calm|peaceful|serene|peace|mellow|soothing|laid back|tranquil|gentle)\b/],
  ['dreamy', /\b(dreamy|dreams|dreamlike|dreaming|ethereal|floaty|floating|airy|hazy|otherworldly|surreal|daydream)\b/],
  ['happy', /\b(happy|joy|joyful|joyous|cheerful|sunny|uplifting|upbeat|optimistic|optimism|hope|hopeful|euphoric|euphoria)\b/],
  ['sad', /\b(sad|sadness|melancholy|melancholic|blue|sorrow|sorrowful|heartbreak|heartbroken|lonely|loneliness|solitude|longing|yearning|wistful)\b/],
  ['energetic', /\b(energetic|energy|hype|hyped|pumped|adrenaline|intense|frenetic|wild|explosive|high energy|hard hitting)\b/],
  ['playful', /\b(playful|fun|bouncy|dancey|dancing|danceable|groovy|groove|silly|carefree|mischievous)\b/],
  ['dark', /\b(dark|brooding|ominous|haunting|eerie|gloomy|shadowy|sinister|spooky)\b/],
  ['warm', /\b(warm|cozy|cosy|comforting|comfort|tender|soft|sunset|golden|welcoming)\b/],
  ['reflective', /\b(reflective|introspective|thoughtful|contemplative|quiet wonder|late night|pensive|meditative)\b/],
  ['nostalgic', /\b(nostalgic|nostalgia|memories|memory|reminiscent|throwback|bittersweet|vintage)\b/],
  ['romantic', /\b(romantic|romance|love|loving|intimate|sensual|affectionate|passionate|sweet)\b/],
  ['bold', /\b(bold|confident|defiant|rebellious|fierce|angry|anger|aggressive|raw|gritty|powerful)\b/],
  ['futuristic', /\b(futuristic|cosmic|spacey|space|sci fi|cyber|neon|digital|alien)\b/],
  ['cinematic', /\b(cinematic|epic|sweeping|dramatic|grand|majestic|adventurous)\b/],
  ['organic', /\b(organic|earthy|natural|acoustic|rustic|woodland|rootsy)\b/],
];
const clean = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}&]+/gu, ' ').trim().replace(/\s+/g, ' ');
const normalizedTags = (taste?: Taste) => [...new Set((taste?.tags || []).slice(0, 2).map(clean).filter(Boolean))];
const tokens = (value: string) => new Set(clean(value).split(' ').filter(word => word.length > 1 && !['the', 'and', 'very', 'really', 'a', 'an'].includes(word)));
function dice(a: Set<string>, b: Set<string>) {
  const overlap = [...a].filter(value => b.has(value)).length;
  return a.size + b.size ? 2 * overlap / (a.size + b.size) : 0;
}
const affirmative = (tag: string) => tag.replace(/\b(?:not|no|never)\s+(?:(?:very|really|too|that)\s+)?\w+/g, '');
function tagConcepts(tag: string) {
  // Do not interpret "not sad" as a preference for sadness.
  const positive = affirmative(tag);
  return new Set(concepts.filter(([, pattern]) => pattern.test(positive)).map(([name]) => name));
}
function tagSimilarity(a: string, b: string) {
  if (a === b) return 1;
  const ca = tagConcepts(a), cb = tagConcepts(b);
  return Math.max(dice(ca, cb) * 0.9, dice(tokens(affirmative(a)), tokens(affirmative(b))) * 0.7);
}
function alignedTags(a: string[], b: string[]) {
  const direct = a.map((tag, i) => ({ a: tag, b: b[i] || '', score: b[i] ? tagSimilarity(tag, b[i]) : 0 }));
  const reverse = a.map((tag, i) => ({ a: tag, b: b[Math.max(a.length, b.length) - 1 - i] || '', score: b[Math.max(a.length, b.length) - 1 - i] ? tagSimilarity(tag, b[Math.max(a.length, b.length) - 1 - i]) : 0 }));
  return direct.reduce((sum, pair) => sum + pair.score, 0) >= reverse.reduce((sum, pair) => sum + pair.score, 0) ? direct : reverse;
}
function genreFamily(genre: string) {
  const value = clean(genre);
  if (/\bk pop\b/.test(value)) return 'k-pop';
  if (/hip hop|rap/.test(value)) return 'hip-hop';
  if (/r&b|rnb|soul/.test(value)) return 'r&b';
  if (/electronic|dance|house|techno|ambient|electronica/.test(value)) return 'electronic';
  if (/alternative|indie/.test(value)) return 'alternative';
  if (/rock|metal|punk/.test(value)) return 'rock';
  if (/pop/.test(value)) return 'pop';
  if (/jazz|blues/.test(value)) return 'jazz/blues';
  if (/latin|reggaeton/.test(value)) return 'latin';
  if (/country|folk|singer songwriter/.test(value)) return 'folk/country';
  if (/classical|soundtrack|score/.test(value)) return 'cinematic';
  return value;
}
function songInfo(taste?: Taste) {
  const preview = taste?.preview;
  const label = preview?.title || taste?.song || '';
  const split = label.split(/\s+[–—-]\s+/);
  const artist = preview?.artist || (split.length > 1 ? split[0] : '');
  const title = preview?.trackTitle || (split.length > 1 ? split.slice(1).join(' – ') : label);
  let identity = '';
  if (preview) {
    if (preview.provider === 'spotify') identity = `spotify:${spotifyTrackId(preview.url) || ''}`;
    else if (preview.provider === 'apple') {
      try { const url = new URL(preview.url); identity = `apple:${url.searchParams.get('i') || url.pathname.match(/\d+$/)?.[0] || ''}`; } catch {}
    } else identity = songEmbed(preview) || '';
  }
  return { artist, title, artistKey: clean(artist), titleKey: clean(title), genre: preview?.genre || '', identity };
}
export interface TasteFit { score: number; reasons: string[] }
export function tasteFit(room: RoomState, a: SlotId, b: SlotId): TasteFit {
  const ta = room.players[a]?.taste, tb = room.players[b]?.taste;
  const tagsA = normalizedTags(ta), tagsB = normalizedTags(tb);
  const aligned = alignedTags(tagsA, tagsB);
  const reasons = aligned.filter(pair => pair.score >= 0.55).map(pair => pair.a === pair.b ? `Shared vibe: “${pair.a}”` : `Related vibes: “${pair.a}” and “${pair.b}”`);
  // Tags carry 70% of the score; song evidence can add at most 30%.
  let score = aligned.reduce((sum, pair) => sum + pair.score, 0) / Math.max(tagsA.length, tagsB.length, 1) * 70;
  const sa = songInfo(ta), sb = songInfo(tb);
  const sameArtist = !!sa.artistKey && sa.artistKey === sb.artistKey;
  const namedSong = !!sa.titleKey && !['a song', 'my favorite song', 'favorite song', 'unknown'].includes(sa.titleKey);
  const sameSong = (sa.identity.length > 8 && sa.identity === sb.identity) || (namedSong && sa.titleKey === sb.titleKey && (sameArtist || (!sa.artistKey && !sb.artistKey)));
  let songScore = 0;
  if (sameSong) { songScore += 20; reasons.push('Same selected song'); }
  if (sameArtist) { songScore += 8; reasons.push(`Same artist: ${sa.artist}`); }
  if (sa.genre && sb.genre) {
    if (clean(sa.genre) === clean(sb.genre)) { songScore += 12; reasons.push(`Shared genre: ${sa.genre}`); }
    else if (genreFamily(sa.genre) === genreFamily(sb.genre)) { songScore += 8; reasons.push(`Related genres: ${sa.genre} / ${sb.genre}`); }
  }
  score += Math.min(30, songScore);
  if (!reasons.length && score > 0) reasons.push('Some shared wording in your vibe tags');
  return { score: Math.round(score * 100) / 100, reasons };
}

function tieOrder(room: RoomState, slot: SlotId) {
  let n = 2166136261;
  for (const char of `${room.battle?.id || room.lobby?.code || 'classic'}:${slot}`) n = Math.imul(n ^ char.charCodeAt(0), 16777619);
  n ^= n >>> 16; n = Math.imul(n, 0x7feb352d);
  n ^= n >>> 15; n = Math.imul(n, 0x846ca68b);
  return (n ^ (n >>> 16)) >>> 0;
}
/** Optimize pairs and the optional trio together, rather than greedily picking a trio. */
export function matchingGroups(room: RoomState, requested?: SlotId[], allowTrio = true): SlotId[][] {
  const slots = [...(requested || SLOTS.map(slot => slot.id).filter(id => !!room.players[id]))].sort((a, b) => tieOrder(room, a) - tieOrder(room, b) || a.localeCompare(b));
  if (slots.length < 2) return [];
  const weights = slots.map(a => slots.map(b => Math.round(tasteFit(room, a, b).score * 100)));
  const memo = new Map<number, { score: number; groups: SlotId[][] }>();
  function solve(mask: number, trio: boolean): { score: number; groups: SlotId[][] } {
    if (!mask) return { score: trio ? -1 : 0, groups: [] };
    const key = mask * 2 + Number(trio), cached = memo.get(key); if (cached) return cached;
    let a = 0; while (!(mask & (1 << a))) a++;
    let best = { score: -1, groups: [] as SlotId[][] };
    const remaining = mask ^ (1 << a);
    for (let b = a + 1; b < slots.length; b++) {
      if (!(remaining & (1 << b))) continue;
      const rest = solve(remaining ^ (1 << b), trio);
      // A pair contributes one partner score per participant.
      const score = rest.score < 0 ? -1 : rest.score + 2 * weights[a][b];
      if (score > best.score) best = { score, groups: [[slots[a], slots[b]], ...rest.groups] };
      if (trio) for (let c = b + 1; c < slots.length; c++) {
        if (!(remaining & (1 << c))) continue;
        const tail = solve(remaining ^ (1 << b) ^ (1 << c), false);
        // In a trio, each participant gets the average fit of the other two.
        const trioScore = tail.score + weights[a][b] + weights[a][c] + weights[b][c];
        if (trioScore > best.score) best = { score: trioScore, groups: [[slots[a], slots[b], slots[c]], ...tail.groups] };
      }
    }
    memo.set(key, best); return best;
  }
  const odd = slots.length % 2 === 1;
  if (odd && !allowTrio) return [];
  return solve((1 << slots.length) - 1, odd).groups;
}

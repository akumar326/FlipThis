/** Editable starting points, not restrictions on a player's taste. Specific genres go first. */
export function genreVibes(genre: string): [string, string] {
  const name = genre.trim().toLowerCase();
  if (/k[- ]?pop/.test(name)) return ['k-pop', 'shiny'];
  if (/hip.?hop|rap/.test(name)) return ['hip-hop', 'hard hitting'];
  if (/r&b|rnb|soul/.test(name)) return ['r&b', 'late night'];
  if (/electronic|dance|house|techno/.test(name)) return ['electronic', 'dancey'];
  if (/alternative|indie/.test(name)) return ['indie', 'moody'];
  if (/rock|metal|punk/.test(name)) return ['rock', 'raw'];
  if (/pop/.test(name)) return ['pop', 'catchy'];
  if (/jazz|blues/.test(name)) return ['jazzy', 'warm'];
  if (/latin|reggaeton/.test(name)) return ['latin', 'bouncy'];
  if (/country|folk/.test(name)) return ['acoustic', 'storytelling'];
  if (/classical|soundtrack|score/.test(name)) return ['cinematic', 'sweeping'];
  return [name && name !== 'vibey' ? name.slice(0, 30) : 'open minded', 'vibey'];
}

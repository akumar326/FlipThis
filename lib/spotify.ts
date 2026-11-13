function decode(value: string): string {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, entity => {
    const named: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    const point = entity.toLowerCase().startsWith('&#x') ? parseInt(entity.slice(3), 16) : parseInt(entity.slice(2), 10);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
  }).trim();
}
export function spotifyMetadata(html: string) {
  const meta: Record<string, string> = {};
  for (const tag of html.slice(0, 2_000_000).match(/<meta\b[^>]*>/gi) || []) {
    const attrs: Record<string, string> = {};
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[match[1].toLowerCase()] = decode(match[2] ?? match[3]);
    if (attrs.name || attrs.property) meta[attrs.name || attrs.property] = attrs.content || '';
  }
  const description = meta['og:description'] || '';
  return {
    title: (meta['og:title'] || '').replace(/\s*[-–]\s*song(?: and lyrics)? by .*$|\s*\|\s*Spotify.*$/i, '').trim(),
    artist: meta['music:musician_description'] || (description.includes('·') ? description.split('·')[0].trim() : ''),
    art: meta['og:image'] || '',
  };
}

/** Matching for the command palette (Ctrl+K): what a typed query finds among commands. Pure, so it is tested with the rest of the shared code. */
export type Searchable = { label: string; group: string; keywords?: string };

/** A command matches when every word typed starts a word of its label, keywords or group, or is inside its label. No words matches everything. */
export function paletteMatch(c: Searchable, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const label = c.label.toLowerCase();
  const pieces = `${label} ${(c.keywords ?? "").toLowerCase()} ${c.group.toLowerCase()}`.split(/[\s:/,.()\-]+/);
  return words.every((w) => pieces.some((h) => h.startsWith(w)) || label.includes(w));
}

/** The matching commands: those whose label starts with the query first, then those with a word that does, then the rest, each in the order they were given. */
export function paletteRank<T extends Searchable>(list: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  const hits = list.filter((c) => paletteMatch(c, q));
  if (!q) return hits;
  const score = (c: T) => {
    const l = c.label.toLowerCase();
    return l.startsWith(q) ? 0 : l.split(/\s+/).some((w) => w.startsWith(q)) ? 1 : 2;
  };
  return hits.map((c, i) => ({ c, i })).sort((a, b) => score(a.c) - score(b.c) || a.i - b.i).map((x) => x.c);
}

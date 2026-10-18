export type Chunk = { idx: number; page: number; text: string };

const SIZE = 1000;
const OVERLAP = 150;
const MIN_PAGE_CHARS = 20;

/** Collapse whitespace; PDF text arrives with arbitrary line breaks and runs of spaces. */
export const clean = (s: string) => s.replace(/\u00ad/g, "").replace(/\s+/g, " ").trim();

/** Split at a space near `limit` so words are never cut. */
function hardSplit(s: string, limit: number): string[] {
  const out: string[] = [];
  let rest = s;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf(" ", limit);
    if (cut < limit * 0.5) cut = limit;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * One page of text -> chunks of about 1000 characters that end at sentence boundaries, each starting with the tail of the
 * previous one so a statement that straddles a boundary is still retrievable. idx = page * 1000 + n keeps reading order and
 * lets a re-sent page replace exactly its own chunks.
 */
export function chunkPage(page: number, raw: string, size = SIZE, overlap = OVERLAP): Chunk[] {
  const text = clean(raw);
  if (text.length < MIN_PAGE_CHARS) return [];
  // Split on whitespace that follows sentence punctuation. Never on the punctuation itself: "0.94", "p < 0.05", "Fig.2" stay whole.
  const sentences = text.split(/(?<=[.!?]["')\]]*)\s+(?=["“(\[]?[\p{Lu}\p{N}])/u).flatMap((s) => (s.length > size * 1.5 ? hardSplit(s, size) : [s.trim()])).filter(Boolean);

  const pieces: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && cur.length + 1 + s.length > size) {
      pieces.push(cur);
      const tail = cur.length > overlap ? cur.slice(cur.length - overlap) : "";
      const space = tail.indexOf(" ");
      cur = space >= 0 ? tail.slice(space + 1) : "";
    }
    cur = cur ? `${cur} ${s}` : s;
  }
  if (cur.trim() && (pieces.length === 0 || cur.length > overlap + 20)) pieces.push(cur.trim());
  return pieces.slice(0, 999).map((t, n) => ({ idx: page * 1000 + n, page, text: t }));
}

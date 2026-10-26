/**
 * Is the file we fetched the paper we asked for? A link can lead to the wrong paper (a record that points at a journal's issue, a repository that reuses an address), and a
 * wrong paper with true quotes would pass every other check. The title the services gave for the DOI is looked for in the start of the file: if most of its words are
 * there it is the paper; if the title is too short to tell, nothing is claimed either way (null).
 */
const STOP = new Set(["with", "from", "that", "this", "their", "using", "between", "among", "into", "over", "under", "about", "after", "before", "study", "analysis", "review", "based"]);

const fold = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

export function titleWords(title: string): string[] {
  return [...new Set(fold(title).match(/[\p{L}\p{N}]{4,}/gu) ?? [])].filter((w) => !STOP.has(w));
}

/** true: it is the paper; false: it is not; null: the title gives too little to tell. */
export function looksLikePaper(title: string | null | undefined, startOfText: string): boolean | null {
  const words = title ? titleWords(title) : [];
  if (words.length < 3) return null;
  const hay = fold(startOfText.slice(0, 6000)).replace(/[-‐-―]\s*\n?\s*/g, "");
  const found = words.filter((w) => hay.includes(w)).length;
  return found / words.length >= 0.6;
}

/**
 * "https://doi.org/10.1000/ABC" -> "10.1000/abc" (DOIs are case-insensitive).
 * Also strips link artefacts some indexes leave on the DOI ("10.1051/bioconf/202621302009/pdf"), which would otherwise be a DOI
 * that does not exist.
 */
export function normalizeDoi(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/10\.\d{4,9}\/\S+/i);
  if (!m) return null;
  return m[0]
    .toLowerCase()
    .replace(/[.,;)\]]+$/, "")
    .replace(/\/(pdf|epdf|pdfdirect|full|fulltext|full-text|abstract|summary|html|xml|meta)$/, "");
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Crossref abstracts JATS XML hote hain: tags hata kar plain text banao. */
export function stripJats(xml: string | null | undefined): string | null {
  if (!xml) return null;
  const text = xml
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text.replace(/^abstract\s*/i, "") || null;
}

/** OpenAlex abstract_inverted_index ({word: [positions]}) se text banao. */
export function invertedIndexToText(idx: Record<string, number[]> | null | undefined): string | null {
  if (!idx) return null;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(idx)) {
    for (const p of positions) words[p] = word;
  }
  const text = words.filter(Boolean).join(" ").trim();
  return text || null;
}

/** OpenAlex filter syntax todne wale characters hatao (, | : se filters/OR split hote hain). */
export function sanitizeQuery(q: string): string {
  return q.replace(/[,|:;"]/g, " ").replace(/\s+/g, " ").trim();
}

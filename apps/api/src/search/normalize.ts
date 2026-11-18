import { plainText } from "@scholar/shared";
import type { ProviderPaper } from "./types";

const textOrNull = (v: unknown): string | null => (typeof v === "string" ? plainText(v) || null : null);

/**
 * A provider's paper with every string it shows made plain text: title, venue, authors and abstract (a list entry with nothing left is dropped, a venue or abstract with nothing left is null). Tags are not stripped here:
 * the adapter did that for an abstract (stripJats) before the text was decoded, and a second strip of decoded text would take "n<m and k>j" for a tag. So an abstract is decoded twice there and twice again here, four
 * levels of escaping in all, and a title, venue or author two. Never changes its argument.
 */
export function plainPaper(p: ProviderPaper): ProviderPaper {
  return {
    ...p,
    title: plainText(p.title),
    authors: Array.isArray(p.authors) ? p.authors.map((a) => plainText(a)).filter(Boolean) : [],
    venue: textOrNull(p.venue),
    abstract: textOrNull(p.abstract),
  };
}

/**
 * A provider's list, as the search reads it: every paper plain text (plainPaper). What is not a record in it (null, a number, a string) is skipped and a value that is not a list is no papers, because the list may have
 * come from the cache. A paper whose title is nothing once cleaned ("&nbsp;") is dropped, as every adapter drops one that came with no title: a card with no title cannot be shown, and the id of a paper with
 * no DOI is built from its title, so every such paper of a year would be the same one.
 */
export function plainPapers(list: unknown): ProviderPaper[] {
  if (!Array.isArray(list)) return [];
  return list.filter((p): p is ProviderPaper => !!p && typeof p === "object").map((p) => plainPaper(p)).filter((p) => p.title !== "");
}

/** Crossref abstracts JATS XML hote hain: tags hata kar plain text banao. */
export function stripJats(xml: string | null | undefined): string | null {
  if (!xml) return null;
  return plainText(xml, { tags: true }).replace(/^abstract\s*/i, "") || null;
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

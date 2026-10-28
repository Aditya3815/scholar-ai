import { sentenceAt, type Paper } from "@scholar/shared";

/**
 * What the answer writer (answer.ts) and the support judge (support.ts) must agree on: how much of an abstract the model reads, how a sentence is numbered and cut, and how marks
 * are tidied. Kept apart so that the two files do not import each other.
 */

/** The most the model reads of each abstract. */
export const MAX_ABSTRACT_CHARS = 1500;
/** The most sentences shown for one paper: the ones its claims rest on. */
export const MAX_SENTENCES_PER_PAPER = 3;
/** A cited sentence is shown whole up to this length, then cut at a word (still word for word). */
export const MAX_SENTENCE_CHARS = 300;

export const abstractOf = (p: Paper): string => (p.abstract ?? "").slice(0, MAX_ABSTRACT_CHARS);

export const clip = (s: string): string => {
  if (s.length <= MAX_SENTENCE_CHARS) return s;
  const cut = s.lastIndexOf(" ", MAX_SENTENCE_CHARS);
  return s.slice(0, cut > MAX_SENTENCE_CHARS * 0.5 ? cut : MAX_SENTENCE_CHARS);
};

/** Sentence `s` (from 1) of the abstract as it is shown to the reader, or "" when there is no such sentence. */
export const shownSentence = (paper: Paper, s: unknown): string => clip(sentenceAt(abstractOf(paper), s));

/**
 * The punctuation the marks leave: marks written as a list ("[4]; [1]") become one run ("[4][1]"), and a separator left in front of other punctuation when a mark that pointed at
 * nothing checked was taken out ("[1]; , as is") goes. Seen in a live run, 28 Oct 2026.
 */
export function tidyMarkPunctuation(text: string): string {
  return text
    .replace(/(\[\d{1,3}\])\s*[;,]\s*(?=\[\d{1,3}\])/g, "$1")
    .replace(/(\])\s*[;,]\s*(?=[,.;:])/g, "$1")
    .replace(/\s{2,}/g, " ");
}

/**
 * A run of marks written twice or with a mark twice in it ("[1][1]", "[2][3][5] [2][3][5]", seen in live runs on 28 Oct 2026) is one run, each mark once, in the order first seen.
 * Marks separated only by spaces are one run; a mark with words around it is not touched.
 */
export function dedupeMarkRuns(text: string): string {
  return text.replace(/(?:\[\d{1,3}\][ \t]*)+/g, (run) => {
    const seen: string[] = [];
    for (const m of run.matchAll(/\[(\d{1,3})\]/g)) if (!seen.includes(m[1]!)) seen.push(m[1]!);
    return `${seen.map((d) => `[${d}]`).join("")}${/\s$/.test(run) ? " " : ""}`;
  });
}

/**
 * An abstract as numbered sentences. Idea Check shows the model each abstract with its sentences numbered and asks it for the NUMBER of the sentence that
 * shows something, instead of asking it to copy words. A number cannot be copied wrongly: the sentence shown as evidence is part of the abstract by construction
 * (measured, docs/spikes/R5-cost.md: copying made the app drop 1 to 13 claims per check for words changed by a hyphen or a space; numbers drop none), and the model
 * writes a few tokens instead of a quoted sentence.
 *
 * The same function is used to number the sentences in the prompt and to look them up in the answer, so they always agree. It must be deterministic and never throw.
 */

/** Words that end in a full stop without ending the sentence. */
const ABBREVIATIONS = /(?:^|[\s(\[])(?:e\.g|i\.e|et al|vs|cf|fig|figs|eq|eqs|tab|sec|secs|ch|no|nos|vol|pp|approx|ca|dr|prof|mr|mrs|ms|st|inc|ltd|co|resp|viz|ref|refs|al)\.$/i;
/** A single capital letter and a full stop: an initial ("J. R. Smith"), not an end of sentence. */
const INITIAL = /(?:^|[\s(\[])\p{Lu}\.$/u;
/** A sentence may end with these (a Hindi danda too) and the next one may start with a capital letter, a digit, an opening bracket or quote, or a Devanagari letter. */
const BOUNDARY = /(?<=[.!?।॥]["')\]”’]?)\s+(?=["'(\[“‘]?[\p{Lu}\p{N}ऀ-ॿ])/u;

export function splitSentences(text: string): string[] {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return [];
  const out: string[] = [];
  for (const piece of flat.split(BOUNDARY)) {
    const last = out[out.length - 1];
    if (last !== undefined && (ABBREVIATIONS.test(last) || INITIAL.test(last))) out[out.length - 1] = `${last} ${piece}`;
    else out.push(piece);
  }
  return out.filter((s) => s.trim() !== "");
}

/**
 * How much of an abstract the model reads: the writer of an answer, the judge of its claims and the strict check all read this much, so a sentence number means the same to each. Measured
 * on 239 abstracts from the 41 real questions of the claim-support set (31 Oct 2026): the middle abstract is 1,572 characters, one in four is over 1,968 and one in ten over 2,588, so a
 * limit of 1,500 cut more than half of them, and what it cut was often the CONCLUSIONS. 3,000 reads all but about 5 in 100 (the rest are mostly something that is not an abstract).
 */
export const ABSTRACT_READ_CHARS = 3000;

/**
 * The abstract as far as the model reads it. A short abstract is given back as it is. A longer one is cut after a whole sentence (the sentences are the ones of the whole abstract, so
 * sentence k here is sentence k of the whole, and what is cut is never half of a sentence that could be quoted as evidence). A first sentence that alone is longer than the limit is cut
 * at the limit. Always at most ABSTRACT_READ_CHARS characters; never throws.
 */
export function abstractRead(abstract: string | null | undefined): string {
  const text = typeof abstract === "string" ? abstract : "";
  if (text.length <= ABSTRACT_READ_CHARS) return text;
  const kept: string[] = [];
  let length = 0;
  for (const s of splitSentences(text)) {
    const next = length + (kept.length ? 1 : 0) + s.length;
    if (next > ABSTRACT_READ_CHARS) break;
    kept.push(s);
    length = next;
  }
  return kept.length > 0 ? kept.join(" ") : text.replace(/\s+/g, " ").trim().slice(0, ABSTRACT_READ_CHARS);
}

/** The abstract with "(1) ... (2) ..." in front of its sentences, for the prompt. */
export const numberSentences = (text: string): string =>
  splitSentences(text)
    .map((s, i) => `(${i + 1}) ${s}`)
    .join(" ");

/** The sentence a model named by number (counting from 1), or "" when the number is not one of the abstract's sentences. */
export function sentenceAt(text: string, n: unknown): string {
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1) return "";
  return splitSentences(text)[n - 1] ?? "";
}

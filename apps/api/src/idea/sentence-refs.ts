import { sentenceAt } from "@scholar/shared";

/**
 * The model names evidence by the NUMBER of a sentence of the abstract (see packages/shared/src/sentences.ts); here the number becomes the sentence, which then goes
 * through exactly the same checks as a quote the model had copied. A number that is not one of the abstract's sentences gives an empty quote, which the checks treat as
 * "nothing to show". An answer that already carries a `quote` (older answers, the test stand-ins) is left as it is.
 */
type Json = Record<string, unknown>;

/** Longest evidence shown. A longer sentence is cut at a word, so what is shown is still a piece of the abstract word for word (a cut inside a word would fail the check). */
const MAX_EVIDENCE_CHARS = 300;
const clip = (s: string) => {
  if (s.length <= MAX_EVIDENCE_CHARS) return s;
  const cut = s.lastIndexOf(" ", MAX_EVIDENCE_CHARS);
  return s.slice(0, cut > MAX_EVIDENCE_CHARS * 0.5 ? cut : MAX_EVIDENCE_CHARS);
};
const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export type AbstractOf = (n: unknown) => string | null;

/** A copy of `x` with `quote` filled in from `s` (the sentence number) unless it has a quote already. */
function withQuote(x: unknown, abstractOf: AbstractOf, from: string, to: string): Json {
  const o = { ...obj(x) };
  if (typeof o[to] !== "string" && o[from] !== undefined) {
    const text = abstractOf(o.n);
    o[to] = text === null ? "" : clip(sentenceAt(text, o[from]));
  }
  return o;
}

/** The comparison's answer: every part of every paper may carry `s` instead of `quote`. `abstractOf` gives the abstract of paper number n (counting from 1). */
export function resolveCompareSentences(raw: unknown, abstractOf: AbstractOf, facets: readonly string[]): unknown {
  const top = obj(raw);
  if (!Array.isArray(top.papers)) return raw;
  return {
    ...top,
    papers: top.papers.map((p) => {
      const o = { ...obj(p) };
      const text = abstractOf(o.n);
      for (const k of facets) {
        const f = { ...obj(o[k]) };
        if (typeof f.quote !== "string" && f.s !== undefined) f.quote = text === null ? "" : clip(sentenceAt(text, f.s));
        o[k] = f;
      }
      return o;
    }),
  };
}

/** The second reading's answer: open problems, the sentence that states each paper's result, and the sentence behind each answer statement. */
export function resolveInsightsSentences(raw: unknown, abstractOf: AbstractOf): unknown {
  const top = obj(raw);
  return {
    ...top,
    open_problems: arr(top.open_problems).map((x) => withQuote(x, abstractOf, "s", "quote")),
    papers: arr(top.papers).map((x) => withQuote(x, abstractOf, "outcome_s", "outcome_quote")),
    answer: arr(top.answer).map((x) => withQuote(x, abstractOf, "s", "quote")),
  };
}

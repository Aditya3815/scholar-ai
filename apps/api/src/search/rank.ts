import { words, type Paper } from "@scholar/shared";

/**
 * Relevance rerank of a merged list against the words that were searched.
 *
 * The sources rank by their own idea of a match, and the merge only adds up how high each source put a paper (reciprocal rank fusion). Nothing in that asks "does this paper's title and
 * abstract talk about what was typed?": a paper that three sources ranked 15th could beat the paper that is exactly the answer but was found by one. So after the merge every paper gets
 * a score from three things, all computed here with no model and no network (the same list gives the same order every time):
 *
 *   fusion    how high the sources put it (RRF, scaled so the best paper of the list is 1);
 *   match     how much of the query the paper's TITLE (counts most) and abstract use, whole phrase and adjacent word pairs counting extra;
 *   standing  how much it is cited, on a log scale against the best of the list, and how recent it is: only a small push, never enough to lift an off-topic paper.
 *
 * A paper that shares no word at all with the query is cut to half; a stub record (an "Introduction", a "Figure 3:" caption) to a quarter. Nothing is removed.
 * A query in a script the tokeniser cuts in the middle of words (Devanagari) is not judged: the fusion order stays.
 */

const STOP = new Set(
  ("a an the and or of for in on at to by with from into over under than that this these those their there about between among using use used via per vs versus is are was were be been what which who how why when where do does can could should would will may might not no as it its if then so such").split(" "),
);
/** Titles that are only a part of a book or a caption a publisher registered as a record ("Introduction", "Figure 3: ..."). */
const STUB = /^(?:introduction|summary|contents|index|front ?matter|notes|acknowledge?ments|preface|foreword|cover)$|^(?:figure|table)\s+\d+\s*:/;
const isStubRecord = (title: string) => STUB.test(title.toLowerCase().replace(/^[\s.:;,!?'"()[\]-]+|[\s.:;,!?'"()[\]-]+$/g, "").replace(/\s+/g, " "));
const KEPT_WHOLE = /^[\p{Script=Latin}\p{Script=Greek}\p{N}]$/u;

/** A term is compared by its first five letters when long (children/child, measurement/measure), whole when short ("gan", "rna", "cnn"). */
const stem = (w: string) => (w.length > 5 ? w.slice(0, 5) : w);

export type QueryTerms = { stems: string[]; phrase: string; bigrams: string[] };

/** The query as terms, or null when it cannot be judged (no content word, or a script that is cut in the middle). */
export function queryTerms(query: string): QueryTerms | null {
  if (typeof query !== "string") return null;
  const q = query.slice(0, 1000);
  if (!(q.match(/\p{L}/gu) ?? []).every((ch) => KEPT_WHOLE.test(ch))) return null;
  const all = words(q);
  const content = all.filter((w) => w.length >= 2 && !STOP.has(w));
  if (content.length === 0) return null;
  const stems = [...new Set(content.map(stem))];
  const bigrams: string[] = [];
  for (let i = 0; i + 1 < all.length; i++) if (!STOP.has(all[i]!) && !STOP.has(all[i + 1]!)) bigrams.push(`${stem(all[i]!)} ${stem(all[i + 1]!)}`);
  return { stems, phrase: all.join(" "), bigrams: [...new Set(bigrams)] };
}

const stemsOf = (text: string): string[] => words(text).map(stem);

/** 0..1: how well one paper matches the query terms. */
export function matchScore(t: QueryTerms, paper: Pick<Paper, "title" | "abstract">): number {
  const titleWords = words(paper.title);
  const absWords = words(paper.abstract ?? "");
  const titleSet = new Set(titleWords.map(stem));
  const absSet = new Set(absWords.map(stem));
  const inTitle = t.stems.filter((s) => titleSet.has(s)).length / t.stems.length;
  const inAbs = t.stems.filter((s) => absSet.has(s) || titleSet.has(s)).length / t.stems.length;
  let score = 0.6 * inTitle + 0.4 * inAbs;
  if (t.stems.length >= 2) {
    const titleText = stemsOf(paper.title).join(" ");
    const absText = stemsOf(paper.abstract ?? "").join(" ");
    const phrase = t.phrase.split(" ").map(stem).join(" ");
    if (phrase && titleText.includes(phrase)) score += 0.25;
    else if (phrase && absText.includes(phrase)) score += 0.12;
    if (t.bigrams.length > 0) {
      const hit = t.bigrams.filter((b) => titleText.includes(b) || absText.includes(b)).length;
      score += 0.15 * (hit / t.bigrams.length);
    }
  }
  return Math.min(score, 1);
}

/**
 * A search typed the way a citation starts: "Vaswani 2017 Attention is all", "Hochreiter 1997 Long short-term memory", "Breiman 2001, Random forests". The surname and the year are not words of the
 * title, so they only made the title match worse; they are a different kind of evidence (who wrote it, when). Returns the rest of the query and the two hints, or null when the query is not that shape.
 */
export type CitationHint = { rest: string; surname: string; year: number };
export function citationHint(query: string): CitationHint | null {
  const m = /^\s*(\p{Lu}[\p{L}'’-]{1,24})(?:\s+(?:et\s+al\.?|and\s+\p{Lu}[\p{L}'’-]+))?[,\s]+\(?((?:19|20)\d{2})\)?[,.:\s]+(.{6,})$/u.exec(query);
  if (!m) return null;
  const rest = m[3]!.trim();
  if (words(rest).filter((w) => w.length >= 2 && !STOP.has(w)).length < 1) return null;
  return { rest, surname: m[1]!.toLowerCase(), year: Number(m[2]) };
}

const norm = (text: string) => words(text).join(" ");

export type RankOptions = { thisYear?: number };

/** The list in relevance order (a new array, the same papers; `score` is replaced by the combined score). Returns the list unchanged when the query cannot be judged. */
export function rerank(papers: Paper[], query: string, opts: RankOptions = {}): Paper[] {
  const hint = citationHint(query);
  const t = queryTerms(hint ? hint.rest : query);
  if (!t || papers.length < 2) return papers;
  const wanted = norm(hint ? hint.rest : query);
  const wantedLong = wanted.split(" ").length >= 3;
  const thisYear = opts.thisYear ?? new Date().getUTCFullYear();
  const maxFusion = Math.max(...papers.map((p) => p.score), 1e-9);
  const maxCites = Math.max(...papers.map((p) => p.citationCount ?? 0), 0);
  const scored = papers.map((p, i) => {
    const fusion = p.score / maxFusion;
    const match = matchScore(t, p);
    const cites = maxCites > 0 ? Math.log1p(p.citationCount ?? 0) / Math.log1p(maxCites) : 0;
    const age = p.year ? Math.max(0, thisYear - p.year) : 20;
    const recent = Math.max(0, 1 - age / 15);
    let s = 0.4 * fusion + 0.5 * match + 0.07 * cites + 0.03 * recent;
    // A title that is exactly what was typed (or starts with it, when it was a few words long) is the known paper being asked for by name: that outranks a paper that merely talks about the same words.
    const title = norm(p.title);
    if (title === wanted) s += 0.35;
    else if (wantedLong && title.startsWith(wanted)) s += 0.15;
    if (hint) {
      if (p.year === hint.year) s += 0.1;
      if (p.authors.some((a) => words(a).includes(hint.surname))) s += 0.15;
    }
    if (match === 0) s *= 0.5;
    if (isStubRecord(p.title)) s *= 0.25;
    return { p, s, i };
  });
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
  return scored.map(({ p, s }) => ({ ...p, score: s }));
}

/**
 * Pure matching logic for the Reference Verifier: given the text of a reference exactly as a scholar pasted it, and a
 * candidate record from Crossref/OpenAlex, decide whether they are the same paper. No network, no LLM.
 *
 * Verification needs the title to be covered AND at least one independent confirmation (author or year) AND no
 * contradiction. A made-up reference that borrows a real title but invents authors therefore comes back as `mismatch`,
 * never `verified`.
 */

export type Candidate = {
  doi: string | null;
  title: string;
  /** Family names, in order (first author first). Empty when the record has none (e.g. corporate author). */
  authorFamilies: string[];
  authors: string[];
  year: number | null;
  venue: string | null;
};

export type MatchChecks = {
  /** Share of the record's title words that appear in the reference text (0..1). */
  title: number;
  /** true/false = one of the first 3 authors does / does not appear; null = the record has no authors to compare. */
  author: boolean | null;
  /** true/false = a year in the reference is within +-1 of the record's year; null = unknown. */
  year: boolean | null;
};

/**
 * verified    title covered + author confirmed + year not contradicting
 * title_only  a record with (nearly) this title exists but authors/year disagree, or nothing independent confirms it
 * different   the record is about something else
 * no_authors  title (and year) match but the record lists no authors at all, so the authors cannot be checked. Never `verified`:
 *             letters, comments and stubs often share the exact title of the real paper and carry no authors.
 */
export type MatchVerdict = "verified" | "title_only" | "different" | "no_authors";

const GROUP_NAME = /\b(collaborat\w*|consortium|committee|investigators|working group|study group|task force|writing group|network|initiative|commission)\b/i;

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

export const tokenize = (s: string): string[] => fold(s).match(/[\p{L}\p{N}]+/gu) ?? [];

/** "https://doi.org/10.1000/ABC.", "doi:10.1000/abc)" -> "10.1000/abc" */
export function extractDoi(text: string): string | null {
  // A DOI that a PDF wrapped onto the next line ("…2016- 12210", "S0022- 0302(06)72335-9") arrives with a space after its hyphen;
  // a "%0A" (an encoded line break inside a pasted link) ends it.
  const m = text.match(/10\.\d{4,9}\/[^\s"<>]+(?:(?<=[-\u2010-\u2013])\s+[^\s"<>]+)?/i);
  if (!m) return null;
  return m[0].replace(/%0[ad][^]*$/i, "").replace(/\s+/g, "").replace(/[\u2010-\u2013]/g, "-").replace(/[.,;:)\]}>'"]+$/, "").toLowerCase();
}

/**
 * Words a PDF broke across lines come out as "im- age recognition" / "Convolu- tional": rejoin them. A hyphen that really is part of
 * a compound before "and", "or" ("pre- and post-test") stays.
 */
export const joinHyphenated = (text: string): string => text.replace(/(\p{L}{2,})-\s+(?!(?:and|or|to|vs|und|et)\b)(\p{Ll}{2,})/gu, "$1$2");

/** "arXiv:1607.06450v2", "arxiv.org/abs/1706.03762", "CoRR, abs/1409.0473" -> "1607.06450" (new-style ids only, version dropped). */
export function extractArxivId(text: string): string | null {
  const m = text.match(/(?:arxiv[^\d]{0,30}|\babs\/)(\d{4}\.\d{4,5})(?:v\d+)?/i);
  return m && /^(\d{2})(0[1-9]|1[0-2])\./.test(m[1]!) ? m[1]! : null;
}

/** The DOI arXiv (through DataCite) gives every preprint. */
export const arxivDoi = (id: string): string => `10.48550/arxiv.${id}`;

/** Year a preprint first appeared, read from its arXiv DOI ("…arxiv.1706.03762" -> 2017); null for any other DOI. */
export function arxivYear(doi: string | null): number | null {
  const m = doi ? /^10\.48550\/arxiv\.(\d{2})(0[1-9]|1[0-2])\./i.exec(doi) : null;
  return m ? 2000 + Number(m[1]) : null;
}

/** Plausible publication years mentioned in the text (1900-2099), in order of appearance. */
export function extractYears(text: string): number[] {
  // Strip DOIs first: "10.1016/j.cell.2015.03.017" contains year-like fragments.
  const clean = text.replace(/10\.\d{4,9}\/[^\s"<>]+/gi, " ");
  return [...clean.matchAll(/(?<![\d])(19\d{2}|20\d{2})(?![\d])/g)].map((m) => Number(m[1]));
}

/** The longest run of consecutive words of `needle` that appears, in order and unbroken, in `haystack`: its length and where it starts. */
function locateRun(needle: string[], haystack: string[]): { len: number; start: number } {
  let best = { len: 0, start: -1 };
  let prev = new Array<number>(haystack.length + 1).fill(0);
  for (const n of needle) {
    const cur = new Array<number>(haystack.length + 1).fill(0);
    for (let j = 1; j <= haystack.length; j++) {
      if (haystack[j - 1] === n) {
        cur[j] = prev[j - 1]! + 1;
        if (cur[j]! > best.len) best = { len: cur[j]!, start: j - cur[j]! };
      }
    }
    prev = cur;
  }
  return best;
}

const longestRun = (needle: string[], haystack: string[]): number => locateRun(needle, haystack).len;

export function checkMatch(refText: string, c: Candidate): MatchChecks {
  const refTokens = new Set(tokenize(refText));

  const titleTokens = tokenize(c.title).filter((t) => t.length > 1 || /\p{N}/u.test(t));
  let title = titleTokens.length === 0 ? 0 : titleTokens.filter((t) => refTokens.has(t)).length / titleTokens.length;
  // The title words must also appear TOGETHER, in order, the way a title is written: a short generic record title
  // ("Consensus in Blockchain") is otherwise "covered" by any long reference that happens to contain those words scattered
  // through a different title. Allow some drift (typos, a dropped subtitle): the longest run must cover most of the title.
  const allTitle = tokenize(c.title);
  const refWords = tokenize(refText);
  const run = locateRun(allTitle, refWords);
  if (allTitle.length > 0 && run.len / allTitle.length < 0.75) title = Math.min(title, 0.4);
  // A record whose title is the name of the VENUE the reference was published in ("Advances in Neural Information Processing
  // Systems 19", "Neural Networks", a conference's proceedings) sits right after "In" in the reference. That is where a venue is
  // named, never where a title is, so it says nothing about the cited paper.
  else if (run.len >= 2 && run.start > 0 && refWords[run.start - 1] === "in" && allTitle[0] !== "in") title = Math.min(title, 0.4);
  // A very short record title that is only a fragment of the reference's own, much longer title ("Blockchain Consensus" inside
  // "Quantum-inspired blockchain consensus for rural healthcare records") is a coincidence, not the same paper.
  const own = allTitle.length > 0 && allTitle.length <= 3 ? guessTitle(refText) : null;
  if (own) {
    const ownTokens = tokenize(own);
    if (allTitle.length < ownTokens.length * 0.6 && longestRun(allTitle, ownTokens) === allTitle.length) title = Math.min(title, 0.4);
  }

  let author: boolean | null = null;
  // A registry that lists only a group ("Antimicrobial Resistance Collaborators") while people cite the lead authors: the
  // authors cannot be compared, which is different from them disagreeing.
  const onlyGroups = c.authorFamilies.length > 0 && c.authorFamilies.every((f) => GROUP_NAME.test(f));
  if (c.authorFamilies.length > 0) {
    const named = c.authorFamilies.slice(0, 3).some((fam) => {
      const toks = tokenize(fam).filter((t) => t.length > 1);
      if (toks.length === 0) return false;
      // family names: every word must appear; organisation names ("World Health Organization") may be abbreviated or reordered
      // group names need every word: their words ("Antimicrobial Resistance") often also occur in the paper's title
      const need = onlyGroups || toks.length <= 2 ? toks.length : Math.ceil(toks.length * 0.6);
      return toks.filter((t) => refTokens.has(t)).length >= need;
    });
    // group-only records: naming the group confirms; citing individuals is simply not comparable (null), not a contradiction
    author = onlyGroups ? (named ? true : null) : named;
  }

  let year: boolean | null = null;
  if (c.year != null) {
    const years = extractYears(refText);
    year = years.some((y) => Math.abs(y - c.year!) <= 1);
  }
  return { title, author, year };
}

export function verdict(c: Candidate, k: MatchChecks): MatchVerdict {
  const titleTokens = tokenize(c.title).filter((t) => t.length > 1 || /\p{N}/u.test(t));
  const short = titleTokens.length < 3; // "Deep learning": generic, demand both confirmations
  const needTitle = short ? 0.95 : 0.85;
  // A record whose whole title is one word ("ry", "Introduction") resembles every reference that happens to contain it: it can confirm
  // a reference (with author and year) but is never reported as "a real paper with a very similar title".
  if (titleTokens.length < 2) return k.title >= needTitle && k.author === true && k.year === true ? "verified" : "different";
  if (k.title < needTitle) return k.title >= 0.5 ? "title_only" : "different";

  if (k.author === false || k.year === false) return "title_only"; // contradicted by the record
  if (k.author === null) return k.year === true ? "no_authors" : "title_only"; // nothing to confirm the authors against
  if (short) return k.author === true && k.year === true ? "verified" : "title_only";
  return "verified"; // author confirmed (author === true), year true or unknown
}

const QUOTED_TITLE = /[“"]([^”"]{12,300})[”"]/;

/**
 * Best guess at the title inside a pasted reference, for a title-focused search. Handles quoted titles (IEEE) and
 * sentence-structured styles (APA, Vancouver): the longest sentence that does not look like an author list.
 * Returns null when it cannot isolate one (e.g. "Smith et al., Title, Journal 2020" with no sentence breaks).
 */
export function guessTitle(text: string): string | null {
  const quoted = text.match(QUOTED_TITLE);
  if (quoted) return quoted[1]!.replace(/[,.\s]+$/, "").trim();

  const plain = text.replace(/https?:\/\/\S+|doi:\s*\S+|10\.\d{4,9}\/\S+/gi, " ").replace(/\s+/g, " ").trim();
  const parts = plain.split(/(?<=[.?!])\s+(?=[\p{Lu}\p{N}“"(\[])/u).map((s) => s.trim()).filter(Boolean);
  let best: string | null = null;
  let bestWords = 0;
  for (const p of parts) {
    const words = p.split(/\s+/);
    if (words.length < 4 || words.length > 40) continue;
    const initials = words.filter((w) => /^\p{Lu}\.?,?$|^\p{Lu}\p{Lu}$/u.test(w)).length; // "M", "J.", "AB": author initials
    if (initials / words.length > 0.25) continue; // reads like an author list
    if (/^\(?\d{4}\)?\.?$/.test(p)) continue;
    if (words.length > bestWords) {
      best = p.replace(/[.\s]+$/, "");
      bestWords = words.length;
    }
  }
  return best && best.length < plain.length * 0.95 ? best : null;
}

const NAME_JOINERS = /^(and|&|et|al\.?|de|van|von|der|den|di|da|la|le|du|dos|del|bin|ibn)$/i;

/** "Jimmy Lei Ba, Jamie Ryan Kiros, and Geoffrey E Hinton": capitalised words with commas or "and". */
export function looksLikeAuthors(s: string): boolean {
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  const nameLike = words.filter((w) => /^\p{Lu}/u.test(w) || NAME_JOINERS.test(w)).length;
  return nameLike / words.length >= 0.9 && (/,/.test(s) || /\band\b|&/.test(s));
}

/**
 * For styles that put the authors first ("Authors. Title. Venue, year."), the sentence that follows the author list, even when it is
 * short ("Layer normalization."), which guessTitle skips. null when the text does not look like that.
 */
export function titleAfterAuthors(text: string): string | null {
  const plain = text.replace(/https?:\/\/\S+|doi:\s*\S+|10\.\d{4,9}\/\S+/gi, " ").replace(/\s+/g, " ").trim();
  const parts = plain.split(/(?<=[.?!])\s+(?=[\p{Lu}\p{N}“"(\[])/u).map((x) => x.trim()).filter(Boolean);
  const bare = (x: string) => x.replace(/[.\s]+$/, "");
  // a single full name ("Alex Graves") is an author list only as the very first part of the reference
  const isName = (x: string) => /^\p{Lu}[\p{L}'’-]+(\s\p{Lu}[\p{L}'’.-]*){1,2}$/u.test(bare(x));
  const i = parts.findIndex((x, k) => looksLikeAuthors(bare(x)) || (k === 0 && isName(x)));
  let j = i + 1;
  // "... and Alexander M. Rush." splits after the initial and leaves the surname alone as a one-word part
  while (i >= 0 && j < parts.length && bare(parts[j]!).split(/\s+/).length === 1) j++;
  // the title ends at its own full stop, even when the venue after it starts in lower case ("... normalization. arXiv preprint ...")
  const next = i >= 0 ? parts[j]?.split(/(?<=[.?!])\s+(?=\p{Ll})/u)[0]?.replace(/[.\s]+$/, "") : undefined;
  const words = next ? next.split(/\s+/).length : 0;
  return next && words >= 2 && words <= 30 && !/^in\s/i.test(next) ? next : null;
}

/**
 * The title to search for: the sentence after the author list when the reference is written authors-first (it also finds short
 * titles), otherwise guessTitle, unless that turned out to be the author list itself.
 */
export function searchTitle(text: string): string | null {
  if (QUOTED_TITLE.test(text)) return guessTitle(text); // IEEE style: the quotes say where the title is
  const after = titleAfterAuthors(text);
  // "McMurray, J. J. V., Solomon, S. D., ..." splits at every initial; what follows the first author part can be more of the list
  if (after && !looksLikeAuthors(after)) return after;
  const guess = guessTitle(text);
  return guess && !looksLikeAuthors(guess) ? guess : null;
}

export const confidence = (k: MatchChecks): number =>
  Math.round((0.6 * k.title + 0.25 * (k.author ? 1 : 0) + 0.15 * (k.year ? 1 : 0)) * 100) / 100;

/** Best candidate = highest title coverage, then author/year confirmations. */
export function pickBest(refText: string, cands: Candidate[]): { cand: Candidate; checks: MatchChecks } | null {
  let best: { cand: Candidate; checks: MatchChecks; rank: number } | null = null;
  for (const cand of cands) {
    const checks = checkMatch(refText, cand);
    const rank = checks.title * 10 + (checks.author ? 2 : 0) + (checks.year ? 1 : 0);
    if (!best || rank > best.rank) best = { cand, checks, rank };
  }
  return best && { cand: best.cand, checks: best.checks };
}

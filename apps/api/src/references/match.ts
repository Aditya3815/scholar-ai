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
  const m = text.match(/10\.\d{4,9}\/[^\s"<>]+/i);
  if (!m) return null;
  return m[0].replace(/[.,;:)\]}>'"]+$/, "").toLowerCase();
}

/** Plausible publication years mentioned in the text (1900-2099), in order of appearance. */
export function extractYears(text: string): number[] {
  // Strip DOIs first: "10.1016/j.cell.2015.03.017" contains year-like fragments.
  const clean = text.replace(/10\.\d{4,9}\/[^\s"<>]+/gi, " ");
  return [...clean.matchAll(/(?<![\d])(19\d{2}|20\d{2})(?![\d])/g)].map((m) => Number(m[1]));
}

export function checkMatch(refText: string, c: Candidate): MatchChecks {
  const refTokens = new Set(tokenize(refText));

  const titleTokens = tokenize(c.title).filter((t) => t.length > 1 || /\p{N}/u.test(t));
  const title = titleTokens.length === 0 ? 0 : titleTokens.filter((t) => refTokens.has(t)).length / titleTokens.length;

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
  if (k.title < needTitle) return k.title >= 0.5 ? "title_only" : "different";

  if (k.author === false || k.year === false) return "title_only"; // contradicted by the record
  if (k.author === null) return k.year === true ? "no_authors" : "title_only"; // nothing to confirm the authors against
  if (short) return k.author === true && k.year === true ? "verified" : "title_only";
  return "verified"; // author confirmed (author === true), year true or unknown
}

/**
 * Best guess at the title inside a pasted reference, for a title-focused search. Handles quoted titles (IEEE) and
 * sentence-structured styles (APA, Vancouver): the longest sentence that does not look like an author list.
 * Returns null when it cannot isolate one (e.g. "Smith et al., Title, Journal 2020" with no sentence breaks).
 */
export function guessTitle(text: string): string | null {
  const quoted = text.match(/[“"]([^”"]{12,300})[”"]/);
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

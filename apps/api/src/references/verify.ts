import type { RefStatus } from "@scholar/shared";
import { retractedDois } from "../search/retraction";
import {
  LookupError,
  crossrefByDoi,
  crossrefByLocator,
  crossrefSearch,
  crossrefSearchTitle,
  doiResolves,
  openAlexByDoi,
  openAlexSearchTitle,
  type LookupEnv,
} from "./lookup";
import { arxivDoi, spacedTitle, checkIdentified, checkLocator, checkMatch, confidence, doiCandidates, dropBrokenWords, extractArxivId, extractYears, firstAuthorFamily, joinHyphenated, nearestYear, pickBest, referenceKind, searchTitle, tokenize, verdict, type Candidate, type MatchChecks, type MatchVerdict } from "./match";

/**
 *  verified      the reference matches a real record: title covered, plus author or year, nothing contradicting
 *  mismatch      a real record resembles it (or its DOI exists) but the details disagree: a classic AI-fabricated pattern
 *  not_found     nothing in Crossref/OpenAlex matches; a cited DOI that does not resolve ends up here too
 *  unverifiable  we could not decide (databases unreachable, or the DOI exists but has no readable record)
 *  unparsed      too short or not recognisable as a reference
 * A reference is only ever `verified` when a real record backs it. Errors never produce `verified` or `not_found`.
 */
export type { RefStatus };

export type RefResult = {
  input: string;
  status: RefStatus;
  reason: string;
  confidence: number;
  /** The record that was compared (the real paper for verified, the closest real paper for mismatch). */
  match: Candidate | null;
  checks: MatchChecks | null;
  /** Set when the matched DOI is listed as retracted (Crossref / Retraction Watch). Independent of status. */
  retracted?: boolean;
};

const result = (input: string, status: RefStatus, reason: string, match: Candidate | null = null, checks: MatchChecks | null = null): RefResult => ({
  input,
  status,
  reason,
  confidence: checks ? confidence(checks) : 0,
  match,
  checks,
});

async function withRetraction(r: RefResult, env: LookupEnv): Promise<RefResult> {
  const doi = r.match?.doi;
  if (!doi) return r;
  try {
    const { retracted } = await retractedDois(env.store, [doi], { CROSSREF_MAILTO: env.CROSSREF_MAILTO }, AbortSignal.timeout(8_000));
    return { ...r, retracted: retracted.has(doi) };
  } catch {
    return r; // retraction status unknown: leave it unset rather than claiming "not retracted"
  }
}

const describe = (c: Candidate) => `“${c.title}”${c.authors[0] ? ` by ${c.authors[0]}${c.authors.length > 1 ? " et al." : ""}` : ""}${c.year ? ` (${c.year})` : ""}`;

function explainTitleOnly(c: Candidate, k: MatchChecks): string {
  const why = [k.author === false ? "the authors do not match" : null, k.year === false ? `the year differs (the record says ${c.year})` : null].filter(Boolean).join(" and ");
  // Same title and same authors but another year is usually a reprint, a later edition or an online-first date, not an invented reference.
  const reprint = k.author === true && k.year === false ? " When the authors match, this is often a reprint or a later edition: check the year of the original." : "";
  return `A real paper with a very similar title exists: ${describe(c)}, but ${why || "the details do not fully match"}.${reprint}`;
}

const KIND_TEXT = {
  web: "This looks like a web page. Crossref and OpenAlex list scholarly works, not web pages, so “not found” here does not mean it is made up. Open the address to check it.",
  book: "This looks like a book. Crossref and OpenAlex list few books, so “not found” here does not mean it is made up. Check it in a library catalogue or the publisher's page.",
  report: "This looks like a report or an official document. Crossref and OpenAlex list few of these, so “not found” here does not mean it is made up. Check it with the organisation that published it.",
  thesis: "This looks like a thesis. Most theses are not in Crossref or OpenAlex (Indian ones are often in Shodhganga), so “not found” here does not mean it is made up.",
  patent: "This looks like a patent. Crossref and OpenAlex list scholarly works, not patents, so “not found” here does not mean it is made up. Look it up in Google Patents or at the patent office.",
} as const;

/** What a verified answer adds when the match was not exact: the reference shortened the title, or its year is not the record's (a paper first put online or in a conference before the issue it is dated by). */
const note = (text: string, c: Candidate, k: MatchChecks): string => {
  const year = k.year === false && c.year != null ? nearestYear(text, c.year, c.title) : null;
  return `${k.shortened ? " The reference gives a shortened title." : ""}${year != null ? ` Check the year: the reference says ${year}, the record says ${c.year}.` : ""}`;
};

const LOCATOR_NOT_FOUND = "This reference gives no title, so it could only be compared by first author, year, volume and page, and no paper in Crossref has all four. Check it at the source: it may be older than Crossref's records or in a journal it does not hold.";

/**
 * A reference that gives no title is told by where it was printed (see `checkLocator`). `tried` says whether that was asked at all, so a "not found" can say what could and could not be compared.
 * Only a reference with a year and at least two other numbers (the volume and the page) is asked about.
 */
async function viaLocator(text: string, env: LookupEnv): Promise<{ found: RefResult | null; tried: boolean }> {
  const years = extractYears(text);
  // the numbers that are not a year ("2009a" is one too): the volume, the page or article number ("699", "976", "L105", "061102")
  const numbers = tokenize(text).filter((t) => /\d/.test(t) && !/^(19|20)\d{2}[a-z]?$/.test(t));
  if (years.length === 0 || numbers.length < 2) return { found: null, tried: false };
  const cands = await crossrefByLocator(numbers, firstAuthorFamily(text), years[0]!, env);
  const hit = cands.find((c) => checkLocator(text, c));
  if (!hit) return { found: null, tried: true };
  const checks: MatchChecks = { title: 0, author: true, year: true, locator: true };
  return { found: await withRetraction(result(text, "verified", `Matches ${describe(hit)}. The reference gives no title, so this is by its author, year, volume and page.`, hit, checks), env), tried: true };
}

const NO_AUTHORS = "A record with this title and year exists, but it lists no authors, so the authors could not be checked. Look it up at the source before citing.";

/**
 * `dois` are the readings of the DOI the reference prints (a PDF may have wrapped it, and a wrapped DOI read as printed names another record: the proceedings, not the paper). The first
 * reading whose record is the cited paper decides. If none is, the answer is about the first record found; and the DOI "does not exist" only when none of its readings does.
 */
async function viaDoi(text: string, spaced: string, dois: string[], env: LookupEnv): Promise<RefResult> {
  let first: { rec: Candidate; checks: MatchChecks; v: MatchVerdict } | null = null;
  for (const doi of dois) {
    const rec = (await crossrefByDoi(doi, env)) ?? (await openAlexByDoi(doi, env));
    if (!rec) continue;
    const checks = checkMatch(text, rec);
    const v = verdict(rec, checks);
    if (v === "verified") return withRetraction(result(text, "verified", `Matches ${describe(rec)}.${note(text, rec, checks)}`, rec, checks), env);
    first ??= { rec, checks, v };
  }
  if (!first) {
    for (const doi of dois) {
      if (await doiResolves(doi, env)) return result(text, "unverifiable", "The DOI exists, but neither Crossref nor OpenAlex has a record we can compare it with.");
    }
    return result(text, "not_found", "This DOI does not exist: doi.org cannot resolve it.");
  }
  const { rec, checks, v } = first;
  // A DOI that was cut short (a PDF wrapped it and the second half was lost, or went missing from a pasted list) names the proceedings or the journal, not the paper. The reference's own
  // title then finds the paper, and the DOI printed is the beginning of the paper's: that is a DOI cut short, and the paper is verified. A DOI that is simply another paper's is not.
  if (searchTitle(spaced)) {
    const found = await viaSearch(text, spaced, env).catch(() => null);
    const cut = found?.status === "verified" && found.match?.doi ? dois.find((d) => found.match!.doi!.length > d.length && found.match!.doi!.startsWith(d)) : undefined;
    if (found && cut) return { ...found, reason: `${found.reason} The DOI in the reference (${cut}) is cut short: the paper's is ${found.match!.doi}.` };
  }
  if (v === "no_authors") return withRetraction(result(text, "unverifiable", NO_AUTHORS, rec, checks), env);
  if (v === "title_only") return withRetraction(result(text, "mismatch", explainTitleOnly(rec, checks), rec, checks), env);
  return withRetraction(result(text, "mismatch", `This DOI belongs to a different paper: ${describe(rec)}.`, rec, checks), env);
}

/**
 * A preprint cited with its arXiv id ("arXiv:1607.06450"): the id gives the DOI arXiv registers for it, which OpenAlex holds even
 * though Crossref does not. Only a confirmation: a record that does not match is not held against the reference, because arXiv titles
 * and authors change between versions. Then the search decides. null = no confirmation from this route.
 */
async function viaArxiv(text: string, spaced: string, id: string, env: LookupEnv): Promise<RefResult | null> {
  let rec: Candidate | null;
  try {
    rec = await openAlexByDoi(arxivDoi(id), env);
  } catch {
    return null;
  }
  if (!rec) return null;
  const checks = checkMatch(text, rec);
  if (verdict(rec, checks) !== "verified") {
    // "Chen, S., et al. 2018, ArXiv: 1801.07234": no title to compare, and the id is a record by itself: its first author and year, and nothing else in the reference, are enough
    if (searchTitle(spaced) || searchTitle(text) || !checkIdentified(text, rec)) return null;
    const byId: MatchChecks = { title: 0, author: true, year: true, locator: true };
    return withRetraction(result(text, "verified", `Matches ${describe(rec)}. Found in OpenAlex through its arXiv id; the reference gives no title, so this is by the id, its first author and its year.`, rec, byId), env);
  }
  return withRetraction(result(text, "verified", `Matches ${describe(rec)}. Found in OpenAlex through its arXiv id.${note(text, rec, checks)}`, rec, checks), env);
}

/** Two searches, merged: the whole pasted string, and (when a title can be isolated) a title-focused query. */
async function candidatesFor(text: string, env: LookupEnv): Promise<{ cands: Candidate[]; partialFailure: boolean }> {
  const title = searchTitle(text);
  const settled = await Promise.allSettled([crossrefSearch(text, env), title ? crossrefSearchTitle(title, env) : Promise.resolve([] as Candidate[])]);
  const failed = settled.filter((s): s is PromiseRejectedResult => s.status === "rejected");
  if (failed.length === settled.length) throw failed[0]!.reason;
  const seen = new Set<string>();
  const cands: Candidate[] = [];
  for (const s of settled) {
    if (s.status !== "fulfilled") continue;
    for (const c of s.value) {
      const key = c.doi ?? `${c.title}|${c.year}`;
      if (!seen.has(key)) { seen.add(key); cands.push(c); }
    }
  }
  return { cands, partialFailure: failed.length > 0 };
}

const COULD_NOT_CHECK = "We could not reach the reference databases just now, so this was not fully checked. Please try again.";

/**
 * OpenAlex indexes what Crossref does not (arXiv and other preprints, many conference papers). It is asked only when Crossref has not
 * confirmed the reference, and only for a reference whose title can be isolated. null = not consulted or it failed: that must never
 * change the answer Crossref gave, so a failing OpenAlex is silent.
 */
async function openAlexCandidates(text: string, spaced: string, env: LookupEnv): Promise<Candidate[] | null> {
  // The title is read from the rejoined text (a break inside an author's name breaks the sentences of the text as printed). It is then looked for in the text as printed, where a word broken
  // at the end of a line is still two pieces, and the words around a break are left out: whether the break was a hyphen of the title is not known
  const title = searchTitle(text);
  if (!title) return null;
  try {
    return await openAlexSearchTitle(dropBrokenWords(spacedTitle(title, spaced)), env);
  } catch {
    return null;
  }
}

const merge = (a: Candidate[], b: Candidate[]): Candidate[] => {
  const seen = new Set(a.map((c) => c.doi ?? `${c.title}|${c.year}`));
  return [...a, ...b.filter((c) => !seen.has(c.doi ?? `${c.title}|${c.year}`))];
};

/**
 * By title first. When that does not verify a reference whose title cannot be read (physics, astronomy and chemistry references are "Author, Journal volume, page (year)"), by where it
 * was printed, and a "not found" then says that was all that could be compared.
 */
async function viaSearch(text: string, spaced: string, env: LookupEnv): Promise<RefResult> {
  const r = await viaTitle(text, spaced, env);
  if (r.status === "verified" || r.status === "unverifiable" || referenceKind(text)) return r;
  // not only when no title can be read: a journal named in full ("Astronomische Nachrichten") reads like a title. `checkLocator` itself refuses a reference that has words of its own besides
  // the authors and the journal, so a reference with a title is never verified this way
  const l = await viaLocator(text, env);
  if (l.found) return l.found;
  return l.tried && r.status === "not_found" && !searchTitle(spaced) && !searchTitle(text) ? { ...r, reason: LOCATOR_NOT_FOUND } : r;
}

async function viaTitle(text: string, spaced: string, env: LookupEnv): Promise<RefResult> {
  const { cands, partialFailure } = await candidatesFor(text, env);
  let best = pickBest(text, cands);
  let oa: Candidate[] | null = null;
  if (!best || verdict(best.cand, best.checks) !== "verified") {
    oa = await openAlexCandidates(text, spaced, env);
    if (oa) best = pickBest(text, merge(cands, oa));
  }
  const where = oa ? "Crossref or OpenAlex" : "Crossref";
  const via = best && oa?.includes(best.cand) ? " Found in OpenAlex." : "";
  // "Not found" is a claim about the world. If one of the searches failed, absence of evidence is not evidence of absence.
  const kind = referenceKind(text);
  // a patent is in neither registry, and "a real paper with a similar title exists" would be a claim about something that is not a paper
  if (kind === "patent" && !(best && verdict(best.cand, best.checks) === "verified")) return result(text, "not_found", KIND_TEXT.patent);
  if (!best) return partialFailure ? result(text, "unverifiable", COULD_NOT_CHECK) : result(text, "not_found", kind ? KIND_TEXT[kind] : `No matching paper was found in ${where}.`);
  const v = verdict(best.cand, best.checks);
  if (v === "different" && partialFailure) return result(text, "unverifiable", COULD_NOT_CHECK, null, best.checks);
  if (v === "verified") return withRetraction(result(text, "verified", `Matches ${describe(best.cand)}.${via}${note(text, best.cand, best.checks)}`, best.cand, best.checks), env);
  if (v === "no_authors") return withRetraction(result(text, "unverifiable", NO_AUTHORS, best.cand, best.checks), env);
  if (v === "title_only") return withRetraction(result(text, "mismatch", explainTitleOnly(best.cand, best.checks), best.cand, best.checks), env);
  return result(text, "not_found", kind ? KIND_TEXT[kind] : `No paper matching this title, authors and year was found in ${where}.`, null, best.checks);
}

export async function verifyReference(raw: string, env: LookupEnv): Promise<RefResult> {
  const spaced = raw.replace(/\s+/g, " ").trim();
  const text = joinHyphenated(spaced);
  if (text.length < 15 || tokenize(text).length < 3) {
    return result(raw, "unparsed", "This does not look like a full reference. Paste the whole entry (authors, title, journal, year).");
  }
  try {
    const dois = doiCandidates(text);
    if (dois.length > 0) return await viaDoi(text, spaced, dois, env);
    const arxiv = extractArxivId(text);
    return (arxiv && (await viaArxiv(text, spaced, arxiv, env))) || (await viaSearch(text, spaced, env));
  } catch (e) {
    if (e instanceof LookupError) {
      return result(text, "unverifiable", "We could not reach the reference databases just now, so this was not checked. Please try again.");
    }
    throw e;
  }
}

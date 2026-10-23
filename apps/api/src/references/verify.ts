import type { RefStatus } from "@scholar/shared";
import { retractedDois } from "../search/retraction";
import {
  LookupError,
  crossrefByDoi,
  crossrefSearch,
  crossrefSearchTitle,
  doiResolves,
  openAlexByDoi,
  openAlexSearchTitle,
  type LookupEnv,
} from "./lookup";
import { arxivDoi, checkMatch, confidence, extractArxivId, extractDoi, joinHyphenated, pickBest, referenceKind, searchTitle, tokenize, verdict, type Candidate, type MatchChecks } from "./match";

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
} as const;

const NO_AUTHORS = "A record with this title and year exists, but it lists no authors, so the authors could not be checked. Look it up at the source before citing.";

async function viaDoi(text: string, doi: string, env: LookupEnv): Promise<RefResult> {
  const rec = (await crossrefByDoi(doi, env)) ?? (await openAlexByDoi(doi, env));
  if (!rec) {
    return (await doiResolves(doi, env))
      ? result(text, "unverifiable", "The DOI exists, but neither Crossref nor OpenAlex has a record we can compare it with.")
      : result(text, "not_found", "This DOI does not exist: doi.org cannot resolve it.");
  }
  const checks = checkMatch(text, rec);
  const v = verdict(rec, checks);
  if (v === "verified") return withRetraction(result(text, "verified", `Matches ${describe(rec)}.`, rec, checks), env);
  if (v === "no_authors") return withRetraction(result(text, "unverifiable", NO_AUTHORS, rec, checks), env);
  if (v === "title_only") return withRetraction(result(text, "mismatch", explainTitleOnly(rec, checks), rec, checks), env);
  return withRetraction(result(text, "mismatch", `This DOI belongs to a different paper: ${describe(rec)}.`, rec, checks), env);
}

/**
 * A preprint cited with its arXiv id ("arXiv:1607.06450"): the id gives the DOI arXiv registers for it, which OpenAlex holds even
 * though Crossref does not. Only a confirmation: a record that does not match is not held against the reference, because arXiv titles
 * and authors change between versions. Then the search decides. null = no confirmation from this route.
 */
async function viaArxiv(text: string, id: string, env: LookupEnv): Promise<RefResult | null> {
  let rec: Candidate | null;
  try {
    rec = await openAlexByDoi(arxivDoi(id), env);
  } catch {
    return null;
  }
  if (!rec) return null;
  const checks = checkMatch(text, rec);
  if (verdict(rec, checks) !== "verified") return null;
  return withRetraction(result(text, "verified", `Matches ${describe(rec)}. Found in OpenAlex through its arXiv id.`, rec, checks), env);
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
async function openAlexCandidates(text: string, env: LookupEnv): Promise<Candidate[] | null> {
  const title = searchTitle(text);
  if (!title) return null;
  try {
    return await openAlexSearchTitle(title, env);
  } catch {
    return null;
  }
}

const merge = (a: Candidate[], b: Candidate[]): Candidate[] => {
  const seen = new Set(a.map((c) => c.doi ?? `${c.title}|${c.year}`));
  return [...a, ...b.filter((c) => !seen.has(c.doi ?? `${c.title}|${c.year}`))];
};

async function viaSearch(text: string, env: LookupEnv): Promise<RefResult> {
  const { cands, partialFailure } = await candidatesFor(text, env);
  let best = pickBest(text, cands);
  let oa: Candidate[] | null = null;
  if (!best || verdict(best.cand, best.checks) !== "verified") {
    oa = await openAlexCandidates(text, env);
    if (oa) best = pickBest(text, merge(cands, oa));
  }
  const where = oa ? "Crossref or OpenAlex" : "Crossref";
  const via = best && oa?.includes(best.cand) ? " Found in OpenAlex." : "";
  // "Not found" is a claim about the world. If one of the searches failed, absence of evidence is not evidence of absence.
  const kind = referenceKind(text);
  if (!best) return partialFailure ? result(text, "unverifiable", COULD_NOT_CHECK) : result(text, "not_found", kind ? KIND_TEXT[kind] : `No matching paper was found in ${where}.`);
  const v = verdict(best.cand, best.checks);
  if (v === "different" && partialFailure) return result(text, "unverifiable", COULD_NOT_CHECK, null, best.checks);
  if (v === "verified") return withRetraction(result(text, "verified", `Matches ${describe(best.cand)}.${via}`, best.cand, best.checks), env);
  if (v === "no_authors") return withRetraction(result(text, "unverifiable", NO_AUTHORS, best.cand, best.checks), env);
  if (v === "title_only") return withRetraction(result(text, "mismatch", explainTitleOnly(best.cand, best.checks), best.cand, best.checks), env);
  return result(text, "not_found", kind ? KIND_TEXT[kind] : `No paper matching this title, authors and year was found in ${where}.`, null, best.checks);
}

export async function verifyReference(raw: string, env: LookupEnv): Promise<RefResult> {
  const text = joinHyphenated(raw.replace(/\s+/g, " ").trim());
  if (text.length < 15 || tokenize(text).length < 3) {
    return result(raw, "unparsed", "This does not look like a full reference. Paste the whole entry (authors, title, journal, year).");
  }
  try {
    const doi = extractDoi(text);
    if (doi) return await viaDoi(text, doi, env);
    const arxiv = extractArxivId(text);
    return (arxiv && (await viaArxiv(text, arxiv, env))) || (await viaSearch(text, env));
  } catch (e) {
    if (e instanceof LookupError) {
      return result(text, "unverifiable", "We could not reach the reference databases just now, so this was not checked. Please try again.");
    }
    throw e;
  }
}

import { GateBusy, withGate } from "../gate";
import { normalizeDoi, normalizeTitle } from "./normalize";
import type { Provider, ProviderPaper } from "./types";

/**
 * CORE (core.ac.uk): the world's largest collection of open-access research papers held in university and institutional repositories, including
 * theses, working papers and accepted manuscripts that OpenAlex and Crossref often list without an abstract or not at all. Used by Idea Check only.
 *
 * What the service allows (measured 24 Oct 2026): 10 requests a minute for a registered key (`x-ratelimit-limit`; the eleventh gets a 429 and
 * `x-ratelimit-retry-after` says when it opens). That is a small allowance shared by everyone, so every call goes through the shared lane in
 * `gate/` (nine a minute, 800 a day), a search is asked for the first two keyword queries only, and results are kept for a day like any other source.
 */
const API = "https://api.core.ac.uk/v3/search/works/"; // the trailing slash matters: without it CORE answers with a redirect page
/** A call that has been let through may take this long (CORE answered in 0.9 to 2.8 s). */
const CALL_TIMEOUT_MS = 10_000;
/**
 * CORE ranks by relevance but matches any of the words, so the tail of its twenty is mostly loosely related. Only the first ten are kept: in the prior-art eval (40 papers) keeping all
 * twenty cost two points of "at least one reference found" (85% to 83%), keeping ten cost none (85%) and gave 9 records per check that no other source had, keeping five gave 4.
 */
const KEEP = 10;
/** How long a search waits for its turn in the shared lane before going on without CORE. */
export const CORE_GATE_WAIT_MS = 5_000;

type CoreWork = {
  title?: string | null;
  doi?: string | null;
  abstract?: string | null;
  yearPublished?: number | null;
  publishedDate?: string | null;
  authors?: ({ name?: string | null } | string)[] | null;
  documentType?: string | null;
  downloadUrl?: string | null;
  sourceFulltextUrls?: string[] | null;
  journals?: { title?: string | null }[] | null;
};

/** The words of a query, cleaned of everything CORE would read as search syntax (quotes, fields, brackets, AND/OR/NOT), so plain words stay plain words. */
export function coreQuery(q: string): string {
  return q
    .replace(/[^\p{L}\p{M}\p{N}\s'’.-]/gu, " ") // \p{M}: the vowel signs of Hindi and other Indic scripts are marks, not letters
    .replace(/(^|\s)[-.]+(?=\S)/g, "$1") // a leading minus means "not"
    .split(/\s+/)
    // CORE reads and, or and not as operators in any case (found in the eval: every title with "and" in it returned nothing, because the words on both sides were then required); they carry no meaning in a title anyway
    .filter((w) => w && !/^(and|or|not)$/i.test(w))
    .slice(0, 16)
    .join(" ")
    .slice(0, 200);
}

/** CORE writes "Family, Given" and sometimes leaves a marker ("; id_orcid") after the name. */
export function coreAuthor(raw: string): string {
  const name = raw.split(";")[0]!.replace(/\s+/g, " ").trim();
  const m = /^([^,]+),\s*(.+)$/.exec(name);
  return m ? `${m[2]} ${m[1]}` : name;
}

/** What the repository calls the item, as the type words the rest of Idea Check understands. Most records have none, which is left to the venue and DOI. */
export function coreWorkType(t: string | null | undefined): string | null {
  const type = (t ?? "").toLowerCase();
  if (type === "thesis") return "dissertation";
  if (type === "book") return "book";
  if (type === "research" || type === "article" || type === "journal") return "article";
  return null;
}

const yearOf = (w: CoreWork): number | null => {
  if (typeof w.yearPublished === "number" && w.yearPublished > 1000 && w.yearPublished < 2100) return w.yearPublished;
  const y = Number(/^(\d{4})/.exec(w.publishedDate ?? "")?.[1]);
  return y > 1000 && y < 2100 ? y : null;
};

/**
 * One list of papers from CORE's answer. The same work is often held by several repositories and comes back once for each (one thesis came back seven times in a single page);
 * left as they are they would count seven times in the ranking, so records with the same title and year are joined, keeping the one that has a DOI, then the longest abstract.
 */
export function parseCore(body: unknown): ProviderPaper[] {
  const results = (body as { results?: CoreWork[] } | null)?.results;
  if (!Array.isArray(results)) return [];
  const byKey = new Map<string, ProviderPaper>();
  for (const w of results) {
    const title = typeof w.title === "string" ? w.title.replace(/\s+/g, " ").trim() : "";
    if (title.length < 4) continue;
    const abstract = typeof w.abstract === "string" && w.abstract.trim() ? w.abstract.replace(/\s+/g, " ").trim().slice(0, 3000) : null;
    const authors = (w.authors ?? [])
      .map((a) => (typeof a === "string" ? a : a?.name ?? ""))
      .map(coreAuthor)
      .filter(Boolean)
      .slice(0, 10);
    const paper: ProviderPaper = {
      doi: normalizeDoi(w.doi ?? undefined),
      pmid: null,
      title,
      authors,
      year: yearOf(w),
      venue: w.journals?.find((j) => j?.title)?.title ?? null,
      abstract,
      citationCount: null, // CORE's own count is not comparable with the others' and is mostly 0
      oaUrl: w.downloadUrl ?? w.sourceFulltextUrls?.[0] ?? null,
      retracted: false,
      workType: coreWorkType(w.documentType),
    };
    const key = `${normalizeTitle(title)}|${paper.year ?? ""}`;
    const kept = byKey.get(key);
    if (!kept) byKey.set(key, paper);
    else {
      kept.doi ??= paper.doi;
      kept.oaUrl ??= paper.oaUrl;
      kept.venue ??= paper.venue;
      kept.workType ??= paper.workType;
      if ((paper.abstract?.length ?? 0) > (kept.abstract?.length ?? 0)) kept.abstract = paper.abstract;
      if (kept.authors.length === 0) kept.authors = paper.authors;
    }
  }
  return [...byKey.values()];
}

export const core: Provider = {
  name: "core",
  async search(q, limit, env) {
    if (!env.CORE_API_KEY) return [];
    const query = coreQuery(q);
    if (!query) return [];
    const params = new URLSearchParams({ q: query, limit: String(Math.min(limit, 30)), exclude: "fullText" });
    let res: Response;
    try {
      // the call's own time limit starts when the shared lane lets it go; the caller's 6 s limit would already be spent waiting for a turn
      res = await withGate("core", CORE_GATE_WAIT_MS, async (lane) => {
        const r = await fetch(`${API}?${params}`, { headers: { Authorization: `Bearer ${env.CORE_API_KEY}` }, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
        if (r.status === 429) {
          const until = Date.parse(r.headers.get("x-ratelimit-retry-after") ?? "");
          // CORE says when its allowance opens again: nobody asks before then (never more than a day, never in the past)
          lane.closeUntil(Number.isFinite(until) ? Math.min(until, Date.now() + 86_400_000) : Date.now() + 60_000);
        }
        return r;
      });
    } catch (e) {
      // worded without "HTTP 429": Idea Check retries that after a pause, which would only ask a lane that is closed
      if (e instanceof GateBusy) throw new Error(e.reason === "budget" ? "CORE daily allowance is used up" : "CORE is busy, try again in a minute");
      throw e;
    }
    if (res.status === 429) throw new Error("CORE is limiting requests, try again in a minute");
    if (res.status === 401 || res.status === 403) throw new Error(`CORE refused the key (HTTP ${res.status})`);
    if (!res.ok) throw new Error(`CORE HTTP ${res.status}`);
    return parseCore(await res.json().catch(() => null)).slice(0, KEEP);
  },
};

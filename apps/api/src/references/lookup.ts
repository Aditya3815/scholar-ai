import type { Candidate } from "./match";

export type LookupEnv = {
  CROSSREF_MAILTO: string;
  OPENALEX_API_KEY?: string;
  /** Injectable for tests and for the eval harness (record/replay). Defaults to global fetch. */
  fetch?: typeof fetch;
};

export class LookupError extends Error {}

const SELECT = "DOI,title,author,issued,container-title";
const f = (env: LookupEnv) => env.fetch ?? fetch;
const headers = (env: LookupEnv): HeadersInit => ({ "User-Agent": `ScholarRefCheck/0.1 (mailto:${env.CROSSREF_MAILTO})` });

type CRItem = {
  DOI?: string;
  title?: string[];
  author?: { given?: string; family?: string; name?: string }[];
  issued?: { "date-parts"?: (number | null)[][] };
  "container-title"?: string[];
};

function fromCrossref(it: CRItem): Candidate | null {
  const title = it.title?.[0];
  if (!title) return null;
  const authors = it.author ?? [];
  return {
    doi: it.DOI ? it.DOI.toLowerCase() : null,
    title,
    // organisations (e.g. "World Health Organization") come as `name` without `family`
    authorFamilies: authors.map((a) => a.family ?? a.name ?? "").filter(Boolean),
    authors: authors.map((a) => a.name ?? [a.given, a.family].filter(Boolean).join(" ")).filter(Boolean),
    year: it.issued?.["date-parts"]?.[0]?.[0] ?? null,
    venue: it["container-title"]?.[0] ?? null,
  };
}

/** Crossref record for a DOI. null = Crossref says 404 (not registered with Crossref). Throws LookupError on other failures. */
export async function crossrefByDoi(doi: string, env: LookupEnv): Promise<Candidate | null> {
  // No `select` here: Crossref rejects it on the single-work endpoint (HTTP 400); it only works on list queries.
  const url = `https://api.crossref.org/works/${encodeURIComponent(doi).replace(/%2F/g, "/")}?mailto=${encodeURIComponent(env.CROSSREF_MAILTO)}`;
  const res = await f(env)(url, { headers: headers(env), signal: AbortSignal.timeout(10_000) }).catch((e) => {
    throw new LookupError(`Crossref unreachable: ${e instanceof Error ? e.message : e}`);
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new LookupError(`Crossref HTTP ${res.status}`);
  const body = (await res.json()) as { message?: CRItem };
  return body.message ? fromCrossref(body.message) : null;
}

/** Crossref free-text bibliographic search: it ranks well on whole pasted citations. */
export async function crossrefSearch(text: string, env: LookupEnv, rows = 8): Promise<Candidate[]> {
  const params = new URLSearchParams({ "query.bibliographic": text.slice(0, 350), rows: String(rows), select: SELECT, mailto: env.CROSSREF_MAILTO });
  const res = await f(env)(`https://api.crossref.org/works?${params}`, { headers: headers(env), signal: AbortSignal.timeout(12_000) }).catch((e) => {
    throw new LookupError(`Crossref unreachable: ${e instanceof Error ? e.message : e}`);
  });
  if (!res.ok) throw new LookupError(`Crossref HTTP ${res.status}`);
  const body = (await res.json()) as { message?: { items?: CRItem[] } };
  return (body.message?.items ?? []).map(fromCrossref).filter((c): c is Candidate => !!c);
}

/** Title-focused search: ranks the right paper higher than the whole-string search when the reference carries long author lists. */
export async function crossrefSearchTitle(title: string, env: LookupEnv, rows = 8): Promise<Candidate[]> {
  const params = new URLSearchParams({ "query.title": title.slice(0, 300), rows: String(rows), select: SELECT, mailto: env.CROSSREF_MAILTO });
  const res = await f(env)(`https://api.crossref.org/works?${params}`, { headers: headers(env), signal: AbortSignal.timeout(12_000) }).catch((e) => {
    throw new LookupError(`Crossref unreachable: ${e instanceof Error ? e.message : e}`);
  });
  if (!res.ok) throw new LookupError(`Crossref HTTP ${res.status}`);
  const body = (await res.json()) as { message?: { items?: CRItem[] } };
  return (body.message?.items ?? []).map(fromCrossref).filter((c): c is Candidate => !!c);
}

type OAWork = {
  doi?: string | null;
  title?: string | null;
  publication_year?: number | null;
  authorships?: { author?: { display_name?: string | null } | null }[];
  primary_location?: { source?: { display_name?: string | null } | null } | null;
};

/** For DOIs Crossref does not hold (arXiv, Zenodo, other DataCite DOIs). Costs ~$0.001 per call, so only a fallback. */
export async function openAlexByDoi(doi: string, env: LookupEnv): Promise<Candidate | null> {
  const params = new URLSearchParams({ select: "doi,title,publication_year,authorships,primary_location" });
  if (env.OPENALEX_API_KEY) params.set("api_key", env.OPENALEX_API_KEY);
  const res = await f(env)(`https://api.openalex.org/works/doi:${encodeURIComponent(doi).replace(/%2F/g, "/")}?${params}`, { signal: AbortSignal.timeout(10_000) }).catch((e) => {
    throw new LookupError(`OpenAlex unreachable: ${e instanceof Error ? e.message : e}`);
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new LookupError(`OpenAlex HTTP ${res.status}`);
  const w = (await res.json()) as OAWork;
  if (!w.title) return null;
  const names = (w.authorships ?? []).map((a) => a.author?.display_name).filter((n): n is string => !!n);
  return {
    doi: w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//i, "").toLowerCase() : doi,
    title: w.title,
    authorFamilies: names.map((n) => n.trim().split(/\s+/).pop() ?? "").filter(Boolean),
    authors: names,
    year: w.publication_year ?? null,
    venue: w.primary_location?.source?.display_name ?? null,
  };
}

/** Does the DOI resolve at all (any registration agency)? */
export async function doiResolves(doi: string, env: LookupEnv): Promise<boolean> {
  const res = await f(env)(`https://doi.org/api/handles/${encodeURIComponent(doi).replace(/%2F/g, "/")}`, { signal: AbortSignal.timeout(8_000) }).catch((e) => {
    throw new LookupError(`doi.org unreachable: ${e instanceof Error ? e.message : e}`);
  });
  if (res.status === 404) return false;
  if (!res.ok) throw new LookupError(`doi.org HTTP ${res.status}`);
  return ((await res.json()) as { responseCode?: number }).responseCode === 1;
}

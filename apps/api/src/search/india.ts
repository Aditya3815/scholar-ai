import { withGate } from "../gate";
import { invertedIndexToText, normalizeDoi, normalizeTitle, sanitizeQuery, stripJats } from "./normalize";
import type { Provider, ProviderPaper } from "./types";

/**
 * The "Indian sources" search (spike R12, docs/spikes/R12-indian-sources.md): three sources the regular search does not ask, used only when the reader turns the
 * scope on. Checked 28 Oct 2026:
 *   - DOAJ (doaj.org/api/v4): open access journals, filtered to journals published in India (`bibjson.journal.country:IN`, about 310,000 articles). Two requests a
 *     second for everyone (bursts of five are queued), so it has its own lane. DOAJ's metadata is CC0.
 *   - Shodhganga through OpenAlex (source S4377209701, about 117,600 theses): Shodhganga itself refuses programs (a bot wall and `Disallow: /`), OpenAlex lists its
 *     records. They have a title, an author, a year and the page on Shodhganga; almost none has an abstract (about 1,000), a DOI or a PDF. So a thesis is listed with
 *     its link, and the short answer cannot be made from it (it is made from abstracts).
 *   - OpenAlex, papers with an author at an Indian institution (`authorships.institutions.country_code:IN`).
 * Every record is still a real record from an index; the DOI check and the retraction check run on these results as on any other.
 */

export const SHODHGANGA_SOURCE = "S4377209701";
const DOAJ_API = "https://doaj.org/api/v4/search/articles";
const STOP = new Set(["the", "a", "an", "of", "for", "and", "or", "in", "on", "to", "with", "by", "from", "using", "based", "is", "are", "what", "how", "does", "do", "study", "studies", "india", "indian"]);

/** Only a web address can be a link: a record that says `javascript:` or anything else is given no link. */
export function webUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * The words of the search for DOAJ, which reads Elasticsearch's query string syntax: every word that carries meaning must be in the record (AND), and nothing of
 * the syntax gets through (only letters, digits and spaces are kept, so a quote, a colon or a bracket cannot change the query). "India" is left out: the scope says it.
 */
export function doajQuery(q: string): string {
  const words = [...new Set(normalizeTitle(q).split(" ").filter((w) => w.length > 2 && !STOP.has(w)))].slice(0, 8);
  return words.join(" AND ");
}

type DoajArticle = {
  bibjson?: {
    title?: string;
    abstract?: string;
    year?: string;
    author?: { name?: string }[];
    identifier?: { id?: string; type?: string }[];
    journal?: { title?: string; country?: string };
    link?: { type?: string; url?: string }[];
  };
};

export function toDoajPapers(results: DoajArticle[]): ProviderPaper[] {
  const out: ProviderPaper[] = [];
  for (const r of results) {
    const b = r.bibjson;
    const title = stripJats(b?.title);
    if (!b || !title) continue;
    const year = Number(b.year);
    const fulltext = webUrl(b.link?.find((l) => l.type === "fulltext")?.url);
    out.push({
      doi: normalizeDoi(b.identifier?.find((i) => i.type?.toLowerCase() === "doi")?.id),
      pmid: null,
      title,
      authors: (b.author ?? []).map((a) => a.name?.trim()).filter((n): n is string => !!n).slice(0, 10),
      year: Number.isInteger(year) && year > 1800 ? year : null,
      venue: b.journal?.title?.trim() || null,
      abstract: stripJats(b.abstract),
      citationCount: null,
      // every journal in DOAJ is open access: its full-text link is a reader's way in (the server never reads it; "Ask this paper" finds its own copy)
      oaUrl: fulltext,
      retracted: false,
      workType: "article",
    });
  }
  return out;
}

/** DOAJ, articles in journals published in India. */
export const doajIndia: Provider = {
  name: "doaj",
  async search(q, limit, _env, signal) {
    const words = doajQuery(q);
    if (!words) return [];
    const query = `(${words}) AND bibjson.journal.country:IN`;
    const params = new URLSearchParams({ pageSize: String(limit) });
    return withGate("doaj", 3_000, async (ctl) => {
      const res = await fetch(`${DOAJ_API}/${encodeURIComponent(query)}?${params}`, { signal, headers: { Accept: "application/json" } });
      if (res.status === 429) {
        const wait = Number(res.headers.get("retry-after"));
        ctl.closeUntil(Date.now() + (Number.isFinite(wait) && wait > 0 ? wait * 1000 : 2_000));
      }
      if (!res.ok) throw new Error(`DOAJ HTTP ${res.status}`);
      const body = (await res.json()) as { results?: DoajArticle[] };
      return toDoajPapers(body.results ?? []);
    });
  },
};

const SELECT = "id,doi,title,publication_year,cited_by_count,is_retracted,primary_location,open_access,authorships,abstract_inverted_index,ids,type";

type OAWork = {
  doi?: string | null;
  title?: string | null;
  publication_year?: number | null;
  cited_by_count?: number | null;
  is_retracted?: boolean | null;
  type?: string | null;
  primary_location?: { landing_page_url?: string | null; source?: { display_name?: string | null } | null } | null;
  open_access?: { oa_url?: string | null } | null;
  authorships?: { author?: { display_name?: string | null } | null }[];
  abstract_inverted_index?: Record<string, number[]> | null;
  ids?: { pmid?: string | null };
};

/**
 * OpenAlex lists a Shodhganga thesis under several addresses of the same record: `/handle/10603/N`, `/jspui/handle/10603/N?mode=full`, or even the PDF of its title page
 * (`:8080/jspui/bitstream/10603/N/1/01_title.pdf`). All of them become the record's page, `https://shodhganga.inflibnet.ac.in/handle/10603/N`; any other address is kept as it is.
 */
export function recordPage(raw: unknown): string | null {
  const url = webUrl(raw);
  if (!url) return null;
  const u = new URL(url);
  if (u.hostname !== "shodhganga.inflibnet.ac.in") return url;
  const handle = /\/(?:jspui\/)?(?:handle|bitstream)\/10603\/(\d+)/.exec(u.pathname)?.[1];
  return handle ? `https://shodhganga.inflibnet.ac.in/handle/10603/${handle}` : url;
}

/** As src/search/openalex.ts, plus the record's own page when it has no DOI (a thesis on Shodhganga is reached only through its page). */
export function toIndiaPapers(works: OAWork[], opts: { thesis?: boolean } = {}): ProviderPaper[] {
  const out: ProviderPaper[] = [];
  for (const w of works) {
    if (!w.title) continue;
    const doi = normalizeDoi(w.doi);
    const pmid = w.ids?.pmid?.match(/(\d+)\/?$/)?.[1] ?? null;
    out.push({
      doi,
      pmid,
      title: w.title,
      authors: (w.authorships ?? []).map((a) => a.author?.display_name).filter((n): n is string => !!n).slice(0, 10),
      year: w.publication_year ?? null,
      venue: w.primary_location?.source?.display_name ?? null,
      abstract: invertedIndexToText(w.abstract_inverted_index),
      citationCount: w.cited_by_count ?? null,
      oaUrl: webUrl(w.open_access?.oa_url),
      retracted: w.is_retracted === true,
      // Shodhganga holds theses only (OpenAlex calls a few of them "article")
      workType: opts.thesis ? "dissertation" : (w.type ?? null),
      ...(doi || pmid ? {} : { url: recordPage(w.primary_location?.landing_page_url) }),
    });
  }
  return out;
}

async function openalexFiltered(filter: string, q: string, limit: number, key: string | undefined, signal: AbortSignal, opts: { thesis?: boolean } = {}): Promise<ProviderPaper[]> {
  const clean = sanitizeQuery(q);
  if (!clean) return [];
  const params = new URLSearchParams({ filter: `${filter},title_and_abstract.search:${clean}`, "per-page": String(limit), select: SELECT });
  if (key) params.set("api_key", key);
  const res = await fetch(`https://api.openalex.org/works?${params}`, { signal });
  if (!res.ok) throw new Error(`OpenAlex HTTP ${res.status}`);
  return toIndiaPapers(((await res.json()) as { results?: OAWork[] }).results ?? [], opts);
}

/** Theses on Shodhganga, as OpenAlex lists them. */
export const shodhganga: Provider = {
  name: "shodhganga",
  search: (q, limit, env, signal) => openalexFiltered(`locations.source.id:${SHODHGANGA_SOURCE}`, q, limit, env.OPENALEX_API_KEY, signal, { thesis: true }),
};

/** Papers with at least one author at an institution in India. */
export const openalexIndia: Provider = {
  name: "openalex-india",
  search: (q, limit, env, signal) => openalexFiltered("authorships.institutions.country_code:IN", q, limit, env.OPENALEX_API_KEY, signal),
};

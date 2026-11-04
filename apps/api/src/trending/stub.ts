import type { Paper, SearchResponse, SearchScope } from "@scholar/shared";
import { phraseKey } from "@scholar/shared/src/trending";

/**
 * Offline stand-ins for OpenAlex, arXiv and the product's own search, for the Trending job: the unit tests of the job and the local end-to-end run (QA_STUB=1 together with
 * ENABLE_DEV_ROUTES=1, see src/index.ts; never in production, the secrets script refuses to upload those). Nothing here is real data: thirteen made-up topics in thirteen subfields, with
 * counts of the shape the plan describes (a rise of 2 to 3 times in a quarter), enough to give a list of nine through every rule of the job.
 *
 *   - "tirzepatide" is in a held subfield (Endocrinology): the job must log it and never show it;
 *   - "environmental DNA" (Ecology) scores high, and is found by a search that returns a retracted paper in its top 20, so the verifier must leave it out;
 *   - "altermagnetism" (Condensed Matter Physics) is not in last year's top 200 of its subfield, so the job must ask OpenAlex for its real count (22);
 *   - "single-atom catalysts" and "solid-state batteries" are a fifth and a sixth phrase from the Physical Sciences, which hold four at most: they are in the pool and never shown;
 *   - every other subfield answers "no papers" (a total of 0), as a tiny subfield would.
 */
type Topic = { subfield: number; slug: string; name: string; a: number; /** null: not in last year's list */ b: number | null; /** whether the job is to show it */ shown: boolean };

const TOPICS: readonly Topic[] = [
  { subfield: 1702, slug: "retrieval-augmented-generation", name: "retrieval-augmented generation", a: 452, b: 176, shown: true },
  { subfield: 3304, slug: "ai-literacy", name: "AI literacy", a: 220, b: 90, shown: true },
  { subfield: 1110, slug: "plant-microbiome-engineering", name: "plant microbiome engineering", a: 260, b: 100, shown: true },
  { subfield: 2105, slug: "green-hydrogen-production", name: "green hydrogen production", a: 330, b: 120, shown: true },
  { subfield: 3104, slug: "altermagnetism", name: "altermagnetism", a: 150, b: null, shown: true },
  { subfield: 2002, slug: "central-bank-digital-currency", name: "central bank digital currency", a: 210, b: 90, shown: true },
  { subfield: 2805, slug: "predictive-coding", name: "predictive coding", a: 190, b: 70, shown: true },
  { subfield: 2303, slug: "environmental-dna", name: "environmental DNA", a: 300, b: 95, shown: false },
  { subfield: 2208, slug: "reconfigurable-intelligent-surfaces", name: "reconfigurable intelligent surfaces", a: 280, b: 110, shown: true },
  { subfield: 1213, slug: "heritage-digitisation", name: "heritage digitisation", a: 200, b: 80, shown: true },
  { subfield: 1503, slug: "single-atom-catalysts", name: "single-atom catalysts", a: 170, b: 75, shown: false },
  { subfield: 1603, slug: "solid-state-batteries", name: "solid-state batteries", a: 180, b: 80, shown: false },
  // Endocrinology is a held (health) subfield: its phrase is found and logged, and never shown
  { subfield: 2712, slug: "tirzepatide", name: "tirzepatide", a: 300, b: 100, shown: false },
];
export const STUB_SUBFIELDS: readonly number[] = TOPICS.map((t) => t.subfield);
export const STUB_EXACT_B = 22;
/** The list the stand-ins give: nine phrases. */
export const STUB_PHRASES: readonly string[] = TOPICS.filter((t) => t.shown).map((t) => t.name);
export const STUB_HELD_PHRASE = "tirzepatide";
export const STUB_RETRACTED_PHRASE = "environmental DNA";
export const STUB_CAPPED_PHRASES: readonly string[] = ["single-atom catalysts", "solid-state batteries"];

const TOTAL_B = { global: 100_000, in: 1_640 } as const;
const TOTAL_A = { global: 110_000, in: 1_800 } as const;
/** Papers from India are a fifth of the topic's, as a made-up proportion. */
const inShare = (n: number): number => Math.round(n / 5);

const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const atom = (total: number): Response =>
  new Response(`<?xml version='1.0' encoding='UTF-8'?>\n<feed xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns="http://www.w3.org/2005/Atom"><opensearch:totalResults>${total}</opensearch:totalResults></feed>`, { status: 200, headers: { "content-type": "application/atom+xml" } });
const kw = (slug: string, name: string, count: number) => ({ key: `https://openalex.org/keywords/${slug}`, key_display_name: name, count });

/**
 * A stand-in that fails, for the local end-to-end run (scripts/trending-e2e.mjs): the KV key below holds which source fails, and only the QA_STUB branch of the job reads it (job.ts). It is written
 * through the dev-only route /api/v1/dev/kv, so it exists only where ENABLE_DEV_ROUTES=1 and QA_STUB=1 are both set, never in production. It is not one of the feed's own keys (store.ts).
 *   openalex  every call to OpenAlex is answered with HTTP 500 (the scan fails)
 *   arxiv     arXiv answers its Error entry under HTTP 200, as the real one does (the day's confirmation fails)
 *   search    no source of the product's own search answers (the day's verification fails)
 */
export const STUB_FAULT_KEY = "trending:v1:stub-fault";
export type StubFault = "openalex" | "arxiv" | "search";
export const parseStubFault = (v: unknown): StubFault | null => (v === "openalex" || v === "arxiv" || v === "search" ? v : null);

const ARXIV_ERROR_ENTRY = `<?xml version='1.0' encoding='UTF-8'?>\n<feed xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns="http://www.w3.org/2005/Atom"><opensearch:totalResults>1</opensearch:totalResults><entry><id>https://arxiv.org/api/errors</id><title>Error</title><summary>The server encountered an internal error and was unable to complete your request. Either the server is overloaded or there is an error in the application.</summary></entry></feed>`;

export type StubCalls = { openalex: URL[]; arxiv: URL[]; other: URL[]; searches: { q: string; scope: SearchScope }[] };
export type StubOptions = {
  /** Makes one source fail (see STUB_FAULT_KEY). A call a test's own `intercept` answers is answered by that. */
  fault?: StubFault | null;
  /** The day the job is run for: it tells window A from window B. */
  asOf: () => string;
  /** Called with every call before it is answered (a test advances its clock here, or counts). */
  onCall?: (source: "openalex" | "arxiv" | "search", url?: URL) => void;
  /** Return a response to answer a call with it instead (a test makes a source fail here). */
  intercept?: (source: "openalex" | "arxiv", url: URL) => Response | null | undefined;
};

export function makeStubTrending(opts: StubOptions): { fetch: typeof fetch; search: (q: string, scope: SearchScope) => Promise<SearchResponse>; calls: StubCalls } {
  const calls: StubCalls = { openalex: [], arxiv: [], other: [], searches: [] };

  const openalex = (u: URL): Response => {
    const filter = new Map((u.searchParams.get("filter") ?? "").split(",").map((p) => [p.slice(0, p.indexOf(":")), p.slice(p.indexOf(":") + 1)] as const));
    const subfield = Number(filter.get("primary_topic.subfield.id"));
    const group: "global" | "in" = filter.get("authorships.institutions.country_code") === "IN" ? "in" : "global";
    // window A ends 45 days before the day, window B a year before that: told apart by how long ago they end (the scan may go on a day or two after it began)
    const endedDaysAgo = (Date.parse(opts.asOf()) - Date.parse(filter.get("to_publication_date") ?? "")) / 864e5;
    const inA = endedDaysAgo < 200;
    const share = (n: number) => (group === "in" ? inShare(n) : n);
    const topic = TOPICS.find((t) => t.subfield === subfield);
    const slug = filter.get("keywords.id");
    const groupBy = u.searchParams.get("group_by");

    if (slug !== undefined) {
      const t = TOPICS.find((x) => x.slug === slug && x.subfield === subfield);
      if (!t) return json({ meta: { count: 0 }, group_by: [], results: [] });
      const exact = inA ? t.a : (t.b ?? STUB_EXACT_B);
      if (groupBy === "primary_location.source.id") return json({ meta: { count: share(t.a) }, group_by: Array.from({ length: 12 }, (_, i) => ({ key: `https://openalex.org/S${i + 1}`, key_display_name: `Stand-in journal ${i + 1}`, count: Math.ceil(share(t.a) / 12) })) });
      if (groupBy === "authorships.institutions.country_code") {
        const n = share(t.a);
        return json({ meta: { count: n }, group_by: ["US", "CN", "DE", "GB", "FR", "JP", "BR", "ZA"].map((c, i) => ({ key: `https://openalex.org/countries/${c}`, key_display_name: c, count: i === 0 ? Math.round(n * 0.3) : Math.round(n * 0.1) })) });
      }
      return json({ meta: { count: share(exact) }, results: [{ id: "https://openalex.org/W1" }] });
    }

    if (groupBy === "keywords.id") {
      if (!topic) return json({ meta: { count: 0 }, group_by: [] });
      const total = (inA ? TOTAL_A : TOTAL_B)[group];
      const rows = [kw(`old-${subfield}`, `an older topic ${subfield}`, share(inA ? 880 : 900))];
      if (inA) rows.unshift(kw(topic.slug, topic.name, share(topic.a)));
      else {
        if (topic.b !== null) rows.unshift(kw(topic.slug, topic.name, share(topic.b)));
        else rows.push(kw(`low-${subfield}`, `a small topic ${subfield}`, share(20)));
      }
      return json({ meta: { count: total }, group_by: rows });
    }
    return new Response("unsupported stand-in call", { status: 400 });
  };

  // every phrase is rising on arXiv: 150 submissions in the last 30 days, 110 in the 30 before, 40 a year ago (3.75 times)
  // the windows are told apart by how long before the day they begin (30, 60 and 394 days: the job asks on the day it runs, which may be a day or two after the scan's)
  const arxiv = (u: URL): Response => {
    const from = /submittedDate:[[]([0-9]{4})([0-9]{2})([0-9]{2})[0-9]{4} TO/.exec(u.searchParams.get("search_query") ?? "");
    const age = from ? (Date.parse(opts.asOf()) - Date.parse(`${from[1]}-${from[2]}-${from[3]}`)) / 864e5 : NaN;
    return atom(age > 25 && age < 35 ? 150 : age > 55 && age < 65 ? 110 : age > 385 && age < 405 ? 40 : 0);
  };

  const stubFetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const u = new URL(String(input));
    if (u.hostname === "api.openalex.org") {
      opts.onCall?.("openalex", u);
      calls.openalex.push(u);
      return opts.intercept?.("openalex", u) ?? (opts.fault === "openalex" ? new Response("the stand-in is made to fail", { status: 500 }) : openalex(u));
    }
    if (u.hostname === "export.arxiv.org") {
      opts.onCall?.("arxiv", u);
      calls.arxiv.push(u);
      return opts.intercept?.("arxiv", u) ?? (opts.fault === "arxiv" ? new Response(ARXIV_ERROR_ENTRY, { status: 200, headers: { "content-type": "application/atom+xml" } }) : arxiv(u));
    }
    calls.other.push(u);
    return new Response("the stand-in knows no such address", { status: 404 });
  }) as typeof fetch;

  const search = async (q: string, scope: SearchScope): Promise<SearchResponse> => {
    opts.onCall?.("search");
    calls.searches.push({ q, scope });
    const hasRetracted = phraseKey(q) === phraseKey(STUB_RETRACTED_PHRASE);
    const results: Paper[] = Array.from({ length: 24 }, (_, i) => ({
      id: `t:stub-${i}`,
      doi: null,
      pmid: null,
      title: `A stand-in paper ${i} about ${q}`,
      authors: ["A. Author"],
      year: i % 2 ? 2025 : 2026,
      venue: `Stand-in journal ${i}`,
      abstract: `This stand-in abstract is long enough to be read as one: it says what was studied, how, and what was found, in a few plain sentences. (${i})`,
      citationCount: null,
      oaUrl: null,
      retracted: hasRetracted && i === 4,
      retractionSources: [],
      sources: ["openalex"],
      score: 1 - i / 100,
    }));
    const ok = { ok: true, count: results.length, ms: 1, cached: false };
    if (opts.fault === "search") {
      const down = { ok: false, count: 0, ms: 1, cached: false, error: "the stand-in is made to fail" };
      return { query: q, results: [], providers: { openalex: down, s2: down }, doiCheck: { ok: true, count: 0, ms: 0, cached: false }, retractionCheck: { ok: true, count: 0, ms: 0, cached: false }, tookMs: 1, ...(scope !== "all" ? { scope } : {}) };
    }
    return { query: q, results, providers: { openalex: ok }, doiCheck: { ok: true, count: 0, ms: 0, cached: false }, retractionCheck: { ok: true, count: 0, ms: 0, cached: false }, tookMs: 1, ...(scope !== "all" ? { scope } : {}) };
  };

  return { fetch: stubFetch, search, calls };
}

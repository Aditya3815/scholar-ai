import { afterEach, describe, expect, it, vi } from "vitest";
import type { IdeaSearchEvent } from "@scholar/shared";
import { memoryStore } from "../cache/store";
import type { SearchEnv } from "../search/types";
import { sanitizeRequest, runIdeaSearch } from "./search";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

const oa = (title: string, over: Record<string, unknown> = {}) => ({
  doi: null, title, publication_year: 2020, cited_by_count: 5, is_retracted: false, authorships: [{ author: { display_name: "A. Author" } }],
  primary_location: { source: { display_name: "A Journal" } }, abstract_inverted_index: null, ...over,
});
const s2paper = (title: string) => ({ title, abstract: `${title} abstract`, year: 2019, venue: "V", citationCount: 3, authors: [{ name: "S. Author" }], externalIds: {}, openAlexUnused: true });

function env(over: Partial<SearchEnv> = {}): SearchEnv {
  return { store: memoryStore(), OPENALEX_API_KEY: "k", S2_API_KEY: "k", CROSSREF_MAILTO: "t@example.org", ...over };
}

type Calls = { semantic: string[]; keyword: string[]; s2: string[] };
function stubNetwork(handlers: { semantic?: () => Response; keyword?: (u: string) => Response; s2?: () => Response } = {}): Calls {
  const calls: Calls = { semantic: [], keyword: [], s2: [] };
  vi.stubGlobal("fetch", async (input: unknown) => {
    const url = String(input);
    if (url.includes("api.openalex.org") && url.includes("search.semantic")) {
      calls.semantic.push(decodeURIComponent(url));
      return handlers.semantic?.() ?? json({ results: [oa("Semantic hit about glaucoma screening"), oa("Shared paper on fundus imaging")] });
    }
    if (url.includes("api.openalex.org")) {
      calls.keyword.push(decodeURIComponent(url));
      return handlers.keyword?.(url) ?? json({ results: [oa("Shared paper on fundus imaging"), oa("Keyword hit on rural clinics")] });
    }
    if (url.includes("api.semanticscholar.org")) {
      calls.s2.push(decodeURIComponent(url));
      return handlers.s2?.() ?? json({ data: [s2paper("Shared paper on fundus imaging")] });
    }
    return json({ message: { items: [] } }); // Crossref batch (DOI check, retraction check)
  });
  return calls;
}

const PLAN = { semanticQuery: "Smartphone fundus imaging with a convolutional network to screen glaucoma in rural clinics.", keywordQueries: ["smartphone fundus imaging", "glaucoma screening rural"] };

describe("sanitizeRequest", () => {
  it("accepts a plan, cleans it, and refuses an empty one", () => {
    expect(sanitizeRequest(PLAN)).toEqual(PLAN);
    expect(sanitizeRequest({ semanticQuery: "too short", keywordQueries: [] })).toBeNull();
    expect(sanitizeRequest({ keywordQueries: ["only keywords here"] })).toEqual({ semanticQuery: "", keywordQueries: ["only keywords here"] });
    expect(sanitizeRequest(null)).toBeNull();
    expect(sanitizeRequest({ semanticQuery: `${PLAN.semanticQuery} write to me@x.org https://a.b/c`, keywordQueries: [] })!.semanticQuery).not.toMatch(/@|https?:/);
  });
  it("bounds what the browser can ask for", () => {
    const r = sanitizeRequest({ semanticQuery: "x ".repeat(2000), keywordQueries: Array.from({ length: 30 }, (_, i) => `query ${i}`) })!;
    expect(r.semanticQuery.length).toBeLessThanOrEqual(1500);
    expect(r.keywordQueries).toHaveLength(6);
  });
});

describe("runIdeaSearch", () => {
  it("searches by meaning and by keywords, merges duplicates, and says which search found each paper", async () => {
    const calls = stubNetwork();
    const events: IdeaSearchEvent[] = [];
    const out = await runIdeaSearch({ env: env(), embed: null, req: PLAN, retryPauseMs: 0, emit: (e) => void events.push(e) });
    expect(calls.semantic).toHaveLength(1);
    expect(calls.keyword).toHaveLength(2);
    expect(calls.s2).toHaveLength(2);
    // the semantic query is sent exactly as approved
    expect(calls.semantic[0]!.replace(/\+/g, " ")).toContain(PLAN.semanticQuery);

    const titles = out.papers.map((p) => p.title);
    expect(new Set(titles).size).toBe(titles.length); // one entry per paper
    expect(titles).toHaveLength(3);
    const shared = out.papers.find((p) => p.title === "Shared paper on fundus imaging")!;
    expect(shared.foundBy).toEqual(expect.arrayContaining(["OpenAlex (meaning)", "OpenAlex (keywords)", "Semantic Scholar"]));
    expect(shared.sources.sort()).toEqual(["openalex", "s2"]);
    expect(shared.sources.every((s) => !s.includes(":"))).toBe(true);
    expect(out.searched.filter((s) => s.ok)).toHaveLength(5);
    expect(out.considered).toBe(3);
    expect(out.checked).toEqual({ doi: true, retraction: true });
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["stage", "papers"]));
  });

  it("orders by closeness in meaning when an embedder is available, and reports it", async () => {
    stubNetwork();
    // a toy embedder: texts mentioning 'rural' sit next to the query, the others far away
    const embed = async (texts: string[]) => texts.map((t) => (/rural/i.test(t) ? [1, 0] : [0, 1]));
    const out = await runIdeaSearch({ env: env(), embed, req: PLAN, retryPauseMs: 0 });
    expect(out.papers[0]!.title).toBe("Keyword hit on rural clinics");
    expect(out.papers[0]!.relevance).toBeGreaterThan(out.papers.at(-1)!.relevance);
  });

  it("keeps working when the embedding service fails (order then follows how many searches agreed)", async () => {
    stubNetwork();
    const out = await runIdeaSearch({ env: env(), embed: async () => { throw new Error("down"); }, req: PLAN, retryPauseMs: 0 });
    expect(out.papers[0]!.title).toBe("Shared paper on fundus imaging");
    expect(out.papers.every((p) => p.relevance === 0)).toBe(true);
  });

  it("reports a service that failed instead of hiding it, and still returns what the others found", async () => {
    stubNetwork({ semantic: () => json({}, 500), s2: () => json({}, 503) });
    const out = await runIdeaSearch({ env: env(), embed: null, req: PLAN, retryPauseMs: 0 });
    const failed = out.searched.filter((s) => !s.ok);
    expect(failed.map((s) => `${s.source}:${s.kind}`).sort()).toEqual(["openalex:semantic", "s2:keyword", "s2:keyword"]);
    expect(failed.every((s) => s.error)).toBe(true);
    expect(out.papers.length).toBeGreaterThan(0);
  });

  it("retries a 429 instead of reporting the service as down, and gives up after three tries", async () => {
    let semanticCalls = 0;
    stubNetwork({ semantic: () => (++semanticCalls < 3 ? json({}, 429) : json({ results: [oa("Found on the third try about fundus imaging")] })) });
    const out = await runIdeaSearch({ env: env(), embed: null, req: { semanticQuery: PLAN.semanticQuery, keywordQueries: [] }, retryPauseMs: 0 });
    expect(semanticCalls).toBe(3);
    expect(out.searched.every((s) => s.ok)).toBe(true);
    expect(out.papers.map((p) => p.title)).toContain("Found on the third try about fundus imaging");

    let always = 0;
    stubNetwork({ semantic: () => (always++, json({}, 429)) });
    const gaveUp = await runIdeaSearch({ env: env(), embed: null, req: { semanticQuery: PLAN.semanticQuery, keywordQueries: [] }, retryPauseMs: 0 });
    expect(always).toBe(3);
    expect(gaveUp.searched[0]).toMatchObject({ ok: false, source: "openalex", kind: "semantic" });
  });

  it("never asks OpenAlex for more than two things at once", async () => {
    let running = 0;
    let peak = 0;
    vi.stubGlobal("fetch", async (input: unknown) => {
      const url = String(input);
      if (!url.includes("api.openalex.org")) return json({ data: [], message: { items: [] } });
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 15));
      running--;
      return json({ results: [] });
    });
    await runIdeaSearch({ env: env(), embed: null, req: { semanticQuery: PLAN.semanticQuery, keywordQueries: ["alpha beta", "beta gamma", "gamma delta", "delta epsilon"] }, retryPauseMs: 0 });
    expect(peak).toBe(2);
  });

  it("limits Semantic Scholar to three queries and sends the approved keywords only", async () => {
    const calls = stubNetwork();
    const out = await runIdeaSearch({ env: env(), embed: null, req: { semanticQuery: "", keywordQueries: ["alpha beta", "beta gamma", "gamma delta", "delta epsilon", "epsilon zeta"] }, retryPauseMs: 0 });
    expect(calls.semantic).toHaveLength(0);
    expect(calls.keyword).toHaveLength(5);
    expect(calls.s2).toHaveLength(3);
    expect(out.searched.every((s) => s.kind === "keyword")).toBe(true);
  });

  it("removes a DOI that does not exist, so it cannot be cited, and flags a retracted paper", async () => {
    vi.stubGlobal("fetch", async (input: unknown) => {
      const url = decodeURIComponent(String(input));
      if (url.includes("search.semantic")) return json({ results: [oa("A paper with a bad DOI", { doi: "https://doi.org/10.9999/nope" }), oa("A retracted paper", { doi: "https://doi.org/10.1000/ret.1", is_retracted: true })] });
      if (url.includes("api.openalex.org")) return json({ results: [] });
      if (url.includes("api.semanticscholar.org")) return json({ data: [] });
      if (url.includes("filter=doi:")) return json({ message: { items: [{ DOI: "10.1000/ret.1", title: ["A retracted paper"] }] } });
      if (url.includes("doi.org/api/handles")) return json({ responseCode: 100 }, 404);
      return json({ message: { items: [] } });
    });
    const out = await runIdeaSearch({ env: env(), embed: null, req: { semanticQuery: PLAN.semanticQuery, keywordQueries: [] }, retryPauseMs: 0 });
    const bad = out.papers.find((p) => p.title === "A paper with a bad DOI")!;
    expect(bad.doi).toBeNull();
    expect(bad.doiStatus).toBe("dropped_unresolvable");
    expect(out.papers.find((p) => p.title === "A retracted paper")!.retracted).toBe(true);
  });
});

import { describe, expect, it, vi } from "vitest";
import KEYWORDS_A from "./fixtures/oa-keywords-1702-a.json?raw";
import KEYWORDS_B from "./fixtures/oa-keywords-1702-b.json?raw";
import JOURNALS from "./fixtures/oa-journals-class-imbalance.json?raw";
import COUNTRIES from "./fixtures/oa-countries-class-imbalance.json?raw";
import EXACT from "./fixtures/oa-exact-count.json?raw";
import { trendWindows, type KeywordRow } from "@scholar/shared/src/trending";
import { CallBudget, SourceError, type Http } from "./sources";
import { countriesOf, exactCount, keywordCounts, oaFilter, venuesOf, type OaDeps } from "./openalex";

/**
 * The OpenAlex half of the fetch layer. The fixtures are real answers of 3 Nov 2026 (subfield 1702, Artificial Intelligence; the keyword "class imbalance"), cut to their first rows.
 * What is checked: the filters of the plan's T5 as they go on the wire, the polite mailto and the API key the way the search's own client sends them, the shape of what comes back, and a
 * clear failure on anything else.
 */

const W = trendWindows("2026-11-03");
const SCOPE = { subfield: 1702, window: W.a };

function deps(answer: (url: URL) => Response | Promise<Response>, over: Partial<OaDeps> = {}) {
  const urls: URL[] = [];
  const http: Http = {
    fetch: (async (input: RequestInfo | URL) => {
      const u = new URL(String(input));
      urls.push(u);
      return answer(u);
    }) as typeof fetch,
    sleep: async () => {},
    timeoutMs: 1000,
    retries: 0,
    retryWaitMs: 1,
    maxRetryWaitMs: 10_000,
  };
  const d: OaDeps = { http, mailto: "ops@example.org", apiKey: "KEY-123", budget: new CallBudget(100, "OpenAlex calls"), ...over };
  return { d, urls };
}
const json = (s: string) => new Response(s, { status: 200, headers: { "content-type": "application/json" } });

describe("the filter (T5)", () => {
  it("is journal articles with abstracts and fewer than 60 authors, not retracted, not paratext, in the window, in the subfield", () => {
    expect(oaFilter(SCOPE)).toBe(
      `type:article,is_retracted:false,is_paratext:false,primary_location.source.type:journal,has_abstract:true,authors_count:<60,from_publication_date:${W.a.from},to_publication_date:${W.a.to},primary_topic.subfield.id:1702`,
    );
  });
  it("adds the Indian institutions for the India group and the keyword for a follow-up question", () => {
    const f = oaFilter({ ...SCOPE, country: "IN", keywordId: "class-imbalance" });
    expect(f.endsWith(",authorships.institutions.country_code:IN,keywords.id:class-imbalance")).toBe(true);
    expect(f.startsWith("type:article,is_retracted:false,is_paratext:false,")).toBe(true);
  });
  it("refuses anything that could add a filter of its own: a subfield that is not a whole number, a window that is not dates, a keyword id with a comma", () => {
    expect(() => oaFilter({ ...SCOPE, subfield: 1702.5 })).toThrow();
    expect(() => oaFilter({ ...SCOPE, subfield: NaN })).toThrow();
    expect(() => oaFilter({ ...SCOPE, window: { from: "2026-06-21", to: "2026-09-19,is_retracted:true" } })).toThrow();
    expect(() => oaFilter({ ...SCOPE, keywordId: "a,is_retracted:true" })).toThrow();
    expect(() => oaFilter({ ...SCOPE, keywordId: "" })).toThrow();
  });
});

describe("keywordCounts", () => {
  it("asks for a group_by on keywords.id with the filter, the polite mailto and the key, and reads the total and the rows", async () => {
    const { d, urls } = deps(() => json(KEYWORDS_A));
    const out = await keywordCounts(d, SCOPE);
    expect(urls).toHaveLength(1);
    const u = urls[0]!;
    expect(u.origin + u.pathname).toBe("https://api.openalex.org/works");
    expect(u.searchParams.get("group_by")).toBe("keywords.id");
    expect(u.searchParams.get("filter")).toBe(oaFilter(SCOPE));
    expect(u.searchParams.get("mailto")).toBe("ops@example.org");
    expect(u.searchParams.get("api_key")).toBe("KEY-123");
    expect(out.total).toBe(18526); // the group_by answer's own meta.count: the subfield's papers in the window, no second call
    expect(out.rows).toHaveLength(30);
    expect(out.rows[0]).toEqual({ id: "large-language-models", name: "large language models", count: 1345 });
  });

  it("passes a keyword's display name on exactly as OpenAlex wrote it", async () => {
    const { d } = deps(() => json(KEYWORDS_A));
    const names = (await keywordCounts(d, SCOPE)).rows.map((r: KeywordRow) => r.name);
    expect(names).toContain("explainable AI");
  });

  it("works for window B and for the India group, with no key when there is none", async () => {
    const { d, urls } = deps(() => json(KEYWORDS_B), { apiKey: undefined });
    const out = await keywordCounts(d, { subfield: 1702, window: W.b, country: "IN" });
    expect(out.total).toBe(16924);
    expect(urls[0]!.searchParams.has("api_key")).toBe(false);
    expect(urls[0]!.searchParams.get("filter")).toContain("authorships.institutions.country_code:IN");
    expect(urls[0]!.searchParams.get("filter")).toContain(`from_publication_date:${W.b.from}`);
  });

  it("leaves out a row that cannot be a chip or followed up (no name, a count that is not a count, an id that could add a filter), and keeps the rest", async () => {
    const body = JSON.stringify({
      meta: { count: 500 },
      group_by: [
        { key: "https://openalex.org/keywords/good-one", key_display_name: "good one", count: 60 },
        { key: "https://openalex.org/keywords/no-name", key_display_name: null, count: 60 },
        { key: "https://openalex.org/keywords/bad-count", key_display_name: "bad count", count: "60" },
        { key: "https://openalex.org/keywords/a,b", key_display_name: "comma", count: 60 },
        { key: "https://openalex.org/keywords/fractional", key_display_name: "fractional", count: 60.5 },
      ],
    });
    const out = await keywordCounts(deps(() => json(body)).d, SCOPE);
    expect(out.rows).toEqual([{ id: "good-one", name: "good one", count: 60 }]);
  });

  it("fails clearly when the answer is not the shape of a group_by: no groups, no total, not JSON, an error body", async () => {
    for (const body of ['{"meta":{"count":5}}', '{"group_by":[]}', '{"meta":{"count":"5"},"group_by":[]}', '{"meta":{"count":-1},"group_by":[]}', "<html>maintenance</html>", '{"error":"Invalid query","message":"x"}', "null", "[]"]) {
      const err = await keywordCounts(deps(() => json(body)).d, SCOPE).catch((e) => e);
      expect(err, body).toBeInstanceOf(SourceError);
      expect(err, body).toMatchObject({ source: "openalex", kind: "shape" });
    }
  });

  it("fails clearly on an HTTP error, and the error does not hold the key or the address", async () => {
    const err = await keywordCounts(deps(() => new Response("no", { status: 403 })).d, SCOPE).catch((e) => e);
    expect(err).toMatchObject({ source: "openalex", kind: "http", status: 403 });
    expect(String(err.message)).not.toMatch(/KEY-123|api_key|ops@example/);
  });

  it("each call is one call of the budget, and the call over the budget is not made", async () => {
    const fetchSpy = vi.fn(() => json(KEYWORDS_A));
    const { d } = deps(fetchSpy, { budget: new CallBudget(1, "OpenAlex calls") });
    await keywordCounts(d, SCOPE);
    await expect(keywordCounts(d, SCOPE)).rejects.toThrow(/budget/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("the follow-up questions about one keyword", () => {
  const KW = { ...SCOPE, keywordId: "class-imbalance" };

  it("journals: group_by on the journal, the same filters as the count, the keyword added", async () => {
    const { d, urls } = deps(() => json(JOURNALS));
    const v = await venuesOf(d, KW);
    expect(urls[0]!.searchParams.get("group_by")).toBe("primary_location.source.id");
    expect(urls[0]!.searchParams.get("filter")).toBe(oaFilter(KW));
    expect(v).toHaveLength(12);
    expect(v[0]).toEqual({ id: "https://openalex.org/S196734849", count: 24 });
  });

  it("countries: group_by on the institutions' country code", async () => {
    const { d, urls } = deps(() => json(COUNTRIES));
    const c = await countriesOf(d, KW);
    expect(urls[0]!.searchParams.get("group_by")).toBe("authorships.institutions.country_code");
    expect(c[0]).toEqual({ id: "https://openalex.org/countries/ID", count: 299 });
    expect(c.find((k) => k.id.endsWith("/IN"))!.count).toBe(85);
  });

  it("the exact count of one keyword in a window: one paper per page, the total from meta.count", async () => {
    const { d, urls } = deps(() => json(EXACT));
    expect(await exactCount(d, { ...KW, window: W.b })).toBe(537);
    expect(urls[0]!.searchParams.get("per-page")).toBe("1");
    expect(urls[0]!.searchParams.get("select")).toBe("id");
    expect(urls[0]!.searchParams.has("group_by")).toBe(false);
  });

  it("each needs a keyword", async () => {
    const { d } = deps(() => json(JOURNALS));
    await expect(venuesOf(d, SCOPE as never)).rejects.toThrow();
    await expect(countriesOf(d, SCOPE as never)).rejects.toThrow();
    await expect(exactCount(d, SCOPE as never)).rejects.toThrow();
  });

  it("a journal or country row with no count is left out; a group_by with no groups at all is a shape error", async () => {
    const odd = JSON.stringify({ meta: { count: 9 }, group_by: [{ key: "S1", key_display_name: null, count: 4 }, { key: "S2", count: "x" }, { key: 5, count: 3 }] });
    expect(await venuesOf(deps(() => json(odd)).d, KW)).toEqual([{ id: "S1", count: 4 }]);
    const err = await countriesOf(deps(() => json('{"meta":{"count":1}}')).d, KW).catch((e) => e);
    expect(err).toMatchObject({ kind: "shape" });
  });
});

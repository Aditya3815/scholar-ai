import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GateBusy, resetGates, withGate } from "../gate";
import { memoryStore } from "../cache/store";
import { core, coreAuthor, coreQuery, coreWorkType, parseCore } from "./core";
import type { SearchEnv } from "./types";

const env: SearchEnv = { store: memoryStore(), CORE_API_KEY: "k", CROSSREF_MAILTO: "t@example.org" };
const work = (o: Record<string, unknown> = {}) => ({ title: "Smartphone fundus photography for glaucoma screening", doi: "10.1000/ABC", abstract: "We test it.", yearPublished: 2021, authors: [{ name: "Campbell, M" }], documentType: null, downloadUrl: "https://core.ac.uk/download/1.pdf", journals: [{ title: "Journal of Eyes" }], ...o });

beforeEach(() => resetGates({ core: { minIntervalMs: 0, window: undefined } }));
afterEach(() => vi.unstubAllGlobals());

describe("coreQuery", () => {
  it("keeps plain words and removes everything CORE would read as search syntax", () => {
    expect(coreQuery("smartphone fundus photography glaucoma")).toBe("smartphone fundus photography glaucoma");
    expect(coreQuery('title:(soil) "moisture" [sensors] -tractor')).toBe("title soil moisture sensors tractor");
    expect(coreQuery("deep learning (CNN) / transfer*")).toBe("deep learning CNN transfer");
  });
  it("drops and, or and not in any case: CORE reads them as operators, and a title with 'and' in it would otherwise return almost nothing", () => {
    expect(coreQuery("Energy Efficiency Optimization for Sensing and Communications")).toBe("Energy Efficiency Optimization for Sensing Communications");
    expect(coreQuery("NOT working AND OR Not or And")).toBe("working");
    expect(coreQuery("android order notation")).toBe("android order notation");
  });
  it("keeps letters of any script, digits, apostrophes and hyphens inside words", () => {
    expect(coreQuery("जल संरक्षण 2024 children's well-being")).toBe("जल संरक्षण 2024 children's well-being");
  });
  it("is bounded and can be empty", () => {
    expect(coreQuery("a ".repeat(100)).split(" ").length).toBeLessThanOrEqual(16);
    expect(coreQuery("(((:)))")).toBe("");
    expect(coreQuery("x".repeat(500)).length).toBe(200);
  });
});

describe("coreAuthor and coreWorkType", () => {
  it("turns 'Family, Given' into 'Given Family' and drops the ORCID marker", () => {
    expect(coreAuthor("Campbell, M")).toBe("M Campbell");
    expect(coreAuthor("Azuara-Blanco, Augusto; id_orcid")).toBe("Augusto Azuara-Blanco");
    expect(coreAuthor("World Health Organization")).toBe("World Health Organization");
  });
  it("maps what a repository says to the kinds Idea Check knows, and leaves the rest to the venue and the DOI", () => {
    expect(coreWorkType("thesis")).toBe("dissertation");
    expect(coreWorkType("book")).toBe("book");
    expect(coreWorkType("research")).toBe("article");
    expect(coreWorkType("text")).toBeNull();
    expect(coreWorkType(null)).toBeNull();
  });
});

describe("parseCore", () => {
  it("reads a record into the shape the other sources use", () => {
    const [p] = parseCore({ results: [work()] });
    expect(p).toMatchObject({ doi: "10.1000/abc", title: "Smartphone fundus photography for glaucoma screening", authors: ["M Campbell"], year: 2021, venue: "Journal of Eyes", abstract: "We test it.", citationCount: null, oaUrl: "https://core.ac.uk/download/1.pdf", retracted: false, workType: null });
  });
  it("joins copies of one work held by several repositories, keeping the DOI, the link and the longest abstract", () => {
    const list = parseCore({ results: [work({ doi: null, abstract: "short", downloadUrl: null }), work({ doi: "10.5555/x", abstract: "a much longer abstract of the same work" }), work({ doi: null, abstract: "mid length one" })] });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ doi: "10.5555/x", abstract: "a much longer abstract of the same work", oaUrl: "https://core.ac.uk/download/1.pdf" });
  });
  it("keeps different works that share only a title word, and the same title in different years", () => {
    expect(parseCore({ results: [work(), work({ title: "Another study of glaucoma screening cameras" }), work({ yearPublished: 2019 })] })).toHaveLength(3);
  });
  it("copes with missing and odd fields: no title, no abstract, no year, authors as plain strings, a date instead of a year", () => {
    const list = parseCore({
      results: [
        { title: null },
        { title: "x" },
        { title: "A record with almost nothing in it", abstract: "   ", yearPublished: null, publishedDate: "2015-06-01T00:00:00+01:00", authors: ["Doe, Jane", null, { name: "" }], journals: [{ title: null }] },
        { title: "Another record with a wrong year value", yearPublished: 99999 },
      ],
    });
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ abstract: null, year: 2015, authors: ["Jane Doe"], venue: null, doi: null, oaUrl: null });
    expect(list[1]!.year).toBeNull();
  });
  it("returns nothing for an answer that is not a list", () => {
    expect(parseCore(null)).toEqual([]);
    expect(parseCore({})).toEqual([]);
    expect(parseCore({ results: "no" })).toEqual([]);
  });
});

const answer = (body: unknown) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 });
const stubFetch = (f: (url: string, init: RequestInit) => Response | Promise<Response>) => vi.stubGlobal("fetch", vi.fn(async (u: string, i: RequestInit) => f(u, i)));
const search = (q: string, e: SearchEnv = env) => core.search(q, 20, e, AbortSignal.timeout(1000));

describe("core.search", () => {
  it("asks CORE with the key and without full texts, with the slash that stops a redirect, and returns the records", async () => {
    let seen: { url: string; auth: string | null } | null = null;
    stubFetch((url, init) => ((seen = { url, auth: new Headers(init.headers).get("authorization") }), answer({ results: [work()] })));
    const out = await search("smartphone glaucoma");
    expect(out).toHaveLength(1);
    expect(seen!.url.startsWith("https://api.core.ac.uk/v3/search/works/?")).toBe(true);
    expect(seen!.url).toContain("exclude=fullText");
    expect(seen!.url).toContain("q=smartphone+glaucoma");
    expect(seen!.auth).toBe("Bearer k");
  });

  it("does not call CORE at all without a key, or when nothing is left of the query", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await search("x y z", { ...env, CORE_API_KEY: undefined })).toEqual([]);
    expect(await search("((()))")).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it("on a 429 closes the lane until the time CORE gave, and says it in words that Idea Check does not retry", async () => {
    const until = new Date(Date.now() + 40_000).toISOString();
    let calls = 0;
    stubFetch(() => (calls++, new Response("slow down", { status: 429, headers: { "x-ratelimit-retry-after": until } })));
    const e = await search("a b c").catch((x) => x as Error);
    expect((e as Error).message).not.toMatch(/HTTP 429/);
    expect((e as Error).message).toMatch(/limiting requests/);
    // the lane is closed: a second search does not reach CORE
    const e2 = await search("d e f").catch((x) => x as Error);
    expect((e2 as Error).message).toMatch(/busy/);
    expect(calls).toBe(1);
  });

  it("closes for a minute when a 429 comes without a reset time, and never for longer than a day", async () => {
    stubFetch(() => new Response("", { status: 429 }));
    await search("a b c").catch(() => {});
    const probe = await withGate("core", 0, async () => "in").catch((e) => e as GateBusy);
    expect(probe).toBeInstanceOf(GateBusy);
    expect((probe as GateBusy).retryInMs).toBeGreaterThan(50_000);
    expect((probe as GateBusy).retryInMs).toBeLessThanOrEqual(60_000);

    resetGates({ core: { minIntervalMs: 0, window: undefined } });
    const far = new Date(Date.now() + 10 * 86_400_000).toISOString();
    stubFetch(() => new Response("", { status: 429, headers: { "x-ratelimit-retry-after": far } }));
    await search("a b c").catch(() => {});
    const probe2 = await withGate("core", 0, async () => "in").catch((e) => e as GateBusy);
    expect((probe2 as GateBusy).retryInMs).toBeLessThanOrEqual(86_400_000);
  });

  it("reports a refused key, a server error, and treats an answer that is not JSON as no records", async () => {
    stubFetch(() => new Response("", { status: 401 }));
    await expect(search("a b c")).rejects.toThrow(/refused the key/);
    stubFetch(() => new Response("", { status: 502 }));
    await expect(search("a b c")).rejects.toThrow("CORE HTTP 502");
    stubFetch(() => answer("<html>not json</html>"));
    expect(await search("a b c")).toEqual([]);
  });

  it("is turned away with a clear message when the daily allowance is used up", async () => {
    resetGates({ core: { minIntervalMs: 0, window: undefined, dailyBudget: 1 } });
    stubFetch(() => answer({ results: [] }));
    await search("a b c");
    await expect(search("d e f")).rejects.toThrow(/daily allowance/);
  });
});

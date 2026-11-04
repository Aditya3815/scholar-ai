import { afterEach, describe, expect, it, vi } from "vitest";
import { gatesOff, installGates, resetGates, type RemoteGate } from "../gate";
import COUNT_XML from "./fixtures/arxiv-count.xml?raw";
import ERROR_XML from "./fixtures/arxiv-error.xml?raw";
import { CallBudget, SourceError, makePacer, type Http } from "./sources";
import { arxivCounts, arxivWindows, parseArxivCount, type ArxivDeps } from "./arxiv";

/**
 * The arXiv half of the fetch layer (T3, T5): submissions with a phrase in the last 30 days, the 30 days before, and the same 30 days a year earlier. arXiv answers a bad query or an
 * overloaded server with an Atom feed whose only entry is titled "Error", sometimes under HTTP 200: that is an error, never a count of 1. One request every three seconds, one after the other.
 * The fixtures are real answers of 3 Nov 2026 (the Error answer came with HTTP 500 that time; it is served here under 200, as the plan says it can come).
 */

function deps(answer: (url: URL, init: RequestInit) => Response | Promise<Response>, over: Partial<ArxivDeps> = {}) {
  const seen: { url: URL; init: RequestInit; at: number }[] = [];
  let t = 0;
  const sleeps: number[] = [];
  const sleep = async (ms: number) => {
    sleeps.push(ms);
    t += ms;
  };
  const http: Http = {
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: new URL(String(input)), init: init ?? {}, at: t });
      return answer(new URL(String(input)), init ?? {});
    }) as typeof fetch,
    sleep,
    timeoutMs: 1000,
    retries: 0,
    retryWaitMs: 1,
    maxRetryWaitMs: 10_000,
  };
  const d: ArxivDeps = { http, mailto: "ops@example.org", budget: new CallBudget(100, "arXiv calls"), pace: makePacer(3100, () => t, sleep), ...over };
  return { d, seen, sleeps, tick: (ms: number) => void (t += ms) };
}
const xml = (s: string, status = 200) => new Response(s, { status, headers: { "content-type": "application/atom+xml" } });
const withTotal = (n: string) => COUNT_XML.replace(/<opensearch:totalResults>\d+<\/opensearch:totalResults>/, `<opensearch:totalResults>${n}</opensearch:totalResults>`);

describe("arxivWindows", () => {
  it("are 30 full days ending yesterday, the 30 before, and the same 30 days 364 days earlier (the same weekdays), in arXiv's YYYYMMDDHHMM", () => {
    expect(arxivWindows("2026-11-03")).toEqual({
      recent: { from: "202610040000", to: "202611022359" },
      previous: { from: "202609040000", to: "202610032359" },
      yearAgo: { from: "202510050000", to: "202511032359" },
    });
  });
  it("crosses a year and a leap day without losing a day", () => {
    expect(arxivWindows("2027-01-05").recent).toEqual({ from: "202612060000", to: "202701042359" });
    const w = arxivWindows("2024-03-10");
    expect(w.recent).toEqual({ from: "202402090000", to: "202403092359" }); // 21 days of February 2024 (it has 29) and 9 of March
    expect(w.yearAgo).toEqual({ from: "202302100000", to: "202303112359" }); // 19 days of February 2023 and 11 of March
  });
  it("throws for a day that is not a day", () => {
    expect(() => arxivWindows("2026-13-45")).toThrow();
    expect(() => arxivWindows("yesterday")).toThrow();
  });
});

describe("parseArxivCount", () => {
  it("reads totalResults from a real answer", () => {
    expect(parseArxivCount(COUNT_XML)).toBe(204);
    expect(parseArxivCount(withTotal("0"))).toBe(0);
  });
  it("an Error entry is an error, not a count of 1", () => {
    const err = (() => {
      try {
        parseArxivCount(ERROR_XML);
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(SourceError);
    expect(err).toMatchObject({ source: "arxiv", kind: "error_entry" });
  });
  it("a feed with no total, or one that is not a number, is a shape error", () => {
    for (const bad of [COUNT_XML.replace(/<opensearch:totalResults>\d+<\/opensearch:totalResults>/, ""), withTotal("many"), withTotal("-3"), "", "<html>busy</html>"]) {
      expect(() => parseArxivCount(bad), bad.slice(0, 40)).toThrowError(expect.objectContaining({ kind: "shape" }));
    }
  });
});

describe("arxivCounts", () => {
  it("makes three calls, one after the other, three seconds apart, with a descriptive User-Agent, and returns the three numbers", async () => {
    const totals = ["204", "150", "60"];
    const { d, seen, sleeps } = deps(() => xml(withTotal(totals.shift()!)));
    const out = await arxivCounts(d, "retrieval-augmented generation", "2026-11-03");
    expect(out).toEqual({ recent: 204, previous: 150, yearAgo: 60 });
    expect(seen).toHaveLength(3);
    const q = seen.map((s) => s.url.searchParams.get("search_query"));
    expect(q[0]).toBe('all:"retrieval augmented generation" AND submittedDate:[202610040000 TO 202611022359]');
    expect(q[1]).toBe('all:"retrieval augmented generation" AND submittedDate:[202609040000 TO 202610032359]');
    expect(q[2]).toBe('all:"retrieval augmented generation" AND submittedDate:[202510050000 TO 202511032359]');
    for (const s of seen) {
      expect(s.url.origin + s.url.pathname).toBe("https://export.arxiv.org/api/query");
      expect(s.url.searchParams.get("max_results")).toBe("1");
      expect(s.url.searchParams.get("start")).toBe("0");
      const ua = String((s.init.headers as Record<string, string>)["User-Agent"]);
      expect(ua).toMatch(/Sodhsetu/);
      expect(ua).toContain("mailto:ops@example.org");
    }
    expect(seen.map((s) => s.at)).toEqual([0, 3100, 6200]);
    expect(sleeps).toEqual([3100, 3100]);
  });

  it("is never faster than one request in 3 seconds across phrases either", async () => {
    const { d, seen } = deps(() => xml(withTotal("50")));
    await arxivCounts(d, "world model", "2026-11-03");
    await arxivCounts(d, "diffusion language model", "2026-11-03");
    const gaps = seen.slice(1).map((s, i) => s.at - seen[i]!.at);
    expect(gaps).toHaveLength(5);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(3000);
  });

  it("fails on an Error entry under HTTP 200, and stops there (no more calls for that phrase)", async () => {
    const fetchSpy = vi.fn(() => xml(ERROR_XML, 200));
    const { d } = deps(fetchSpy);
    const err = await arxivCounts(d, "world model", "2026-11-03").catch((e) => e);
    expect(err).toMatchObject({ source: "arxiv", kind: "error_entry" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("fails on an HTTP error, a timeout and a feed with no total", async () => {
    expect(await arxivCounts(deps(() => xml(ERROR_XML, 500)).d, "world model", "2026-11-03").catch((e) => e)).toMatchObject({ kind: "http", status: 500 });
    expect(await arxivCounts(deps(() => { throw new DOMException("t", "TimeoutError"); }).d, "world model", "2026-11-03").catch((e) => e)).toMatchObject({ kind: "timeout" });
    expect(await arxivCounts(deps(() => xml("<feed></feed>")).d, "world model", "2026-11-03").catch((e) => e)).toMatchObject({ kind: "shape" });
  });

  it("each request is one call of the budget; over the budget nothing more is asked", async () => {
    const fetchSpy = vi.fn(() => xml(withTotal("50")));
    const { d } = deps(fetchSpy, { budget: new CallBudget(2, "arXiv calls") });
    await expect(arxivCounts(d, "world model", "2026-11-03")).rejects.toThrow(/budget/);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("puts the phrase in quotes as plain words: no quote, operator or bracket of the phrase's own reaches the query", async () => {
    const { d, seen } = deps(() => xml(withTotal("50")));
    await arxivCounts(d, 'say "hi" OR all:x] AND (cat:cs.AI)', "2026-11-03");
    const q = seen[0]!.url.searchParams.get("search_query")!;
    expect(q).toBe('all:"say hi or all x and cat cs ai" AND submittedDate:[202610040000 TO 202611022359]');
    expect(q.match(/"/g)).toHaveLength(2);
    expect(q.match(/\[/g)).toHaveLength(1);
  });

  it("keeps the + and # of C++ and C#, and refuses a phrase with no word in it", async () => {
    const { d, seen } = deps(() => xml(withTotal("50")));
    await arxivCounts(d, "C++ templates", "2026-11-03");
    expect(seen[0]!.url.searchParams.get("search_query")).toContain('all:"c++ templates"');
    await expect(arxivCounts(d, "?!", "2026-11-03")).rejects.toThrow();
    await expect(arxivCounts(d, "", "2026-11-03")).rejects.toThrow();
  });
});

describe("the lane arXiv has in common with the open-access ingest (src/gate: one request every 3.2 s, one at a time, for every caller)", () => {
  // the tests run with the lanes off (vitest.setup.ts); these turn them on for the one test and put them back
  afterEach(() => {
    installGates(null);
    gatesOff();
  });
  const lane = (over: Partial<RemoteGate> = {}) => {
    const calls: string[] = [];
    const r: RemoteGate = {
      acquire: async (n, wait) => (calls.push(`acquire ${n} ${wait}`), { ok: true, lease: `L${calls.length}` }),
      release: async (n, l) => void calls.push(`release ${n} ${l}`),
      closeUntil: async () => {},
      ...over,
    };
    return { r, calls };
  };

  it("every request of the three, retries included, is made inside the 'arxiv' lane: acquired before it, released after it", async () => {
    resetGates();
    const { r, calls } = lane();
    installGates(r);
    const order: string[] = [];
    const { d } = deps(() => (order.push("fetch"), xml(withTotal("50"))));
    const inner = d.http.fetch;
    d.http.fetch = (async (i: RequestInfo | URL, init?: RequestInit) => (calls.push("fetch"), inner(i, init))) as typeof fetch;
    await arxivCounts(d, "world model", "2026-11-03");
    expect(calls.map((c) => c.replace(/ \d+$/, "").replace(/ L\d+$/, ""))).toEqual(["acquire arxiv", "fetch", "release arxiv", "acquire arxiv", "fetch", "release arxiv", "acquire arxiv", "fetch", "release arxiv"]);
    // the waiting is short: the request's own 30 seconds begin before it, and a lease is 40 seconds
    for (const c of calls.filter((x) => x.startsWith("acquire"))) expect(Number(c.split(" ")[2])).toBeLessThanOrEqual(10_000);
  });

  it("with lane: false (the local run on stand-ins, where nothing real is asked) the lane is not used", async () => {
    resetGates();
    const { r, calls } = lane();
    installGates(r);
    const { d } = deps(() => xml(withTotal("50")), { lane: false });
    await arxivCounts(d, "world model", "2026-11-03");
    expect(calls).toEqual([]);
  });

  it("a lane that turns the job away is a failed request (arXiv was not asked), tried once more like any other, and then an error of the source", async () => {
    resetGates();
    installGates(lane({ acquire: async () => ({ ok: false, reason: "busy", retryInMs: 500 }) }).r);
    const fetchSpy = vi.fn(() => xml(withTotal("50")));
    const { d } = deps(fetchSpy);
    d.http.retries = 1;
    const err = await arxivCounts(d, "world model", "2026-11-03").catch((e) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect(err).toMatchObject({ source: "arxiv", kind: "network" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

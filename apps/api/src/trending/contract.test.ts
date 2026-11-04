import { describe, expect, it } from "vitest";
import * as TC from "@scholar/shared/src/trending-client";
import * as T from "@scholar/shared/src/trending";
// the weekly live check's own decisions (scripts/trending-contract-live.mjs; a script, not a typed module): what makes a run fail
// @ts-expect-error a script, not a typed module
import { detailLine, judgeFeed, judgeSearch, outputLine } from "../../scripts/trending-contract-live.mjs";

/**
 * The contract of the Trending feed against the live product (docs/design/chatview-and-trending.md, section 3): the published file and the bundled Try chips are searched with the product's own
 * search every week, and the run fails on a file the page would not show, a published phrase that fails the verifier, and a Try chip that finds nothing or finds a retracted paper. These are
 * the decisions, on made-up answers; the live half (the real network, the real site) is the workflow that runs the script.
 */

type P = { abstract?: string | null; year?: number | null; retracted?: boolean; venue?: string | null };
const ABSTRACT = "This abstract is long enough to be read as one: it says what was studied, how, and what was found.";
const paper = (i: number, over: P = {}): P => ({ abstract: ABSTRACT, year: 2025, retracted: false, venue: `Journal ${i}`, ...over });
/** A search answer with `n` papers, each made by `make`, from the providers given (all answering by default). */
const found = (n: number, make: (i: number) => P = paper, providers: Record<string, { ok: boolean }> = { openalex: { ok: true }, pubmed: { ok: true } }, retractionCheck: { ok: boolean } | null = { ok: true }) => ({ results: Array.from({ length: n }, (_, i) => make(i)), providers, ...(retractionCheck ? { retractionCheck } : {}) });
const failures = (r: { failures: string[] }) => r.failures;

describe("a published phrase, and a phrase given by hand, are held to the whole verifier", () => {
  for (const kind of ["trending", "hand"] as const) {
    it(`${kind}: 24 papers with abstracts, recent, none retracted, from many journals: passes`, () => {
      const r = judgeSearch(T, kind, found(24), 2025);
      expect(r).toMatchObject({ answered: true, ok: true, failures: [], warnings: [] });
      expect(r.summary).toEqual({ total: 24, withAbstract: 20, recent: 20, retracted: 0, topVenueShare: 1 / 24 });
    });

    it(`${kind}: fewer than 20 results, fewer than 10 abstracts, fewer than 5 recent, a retracted paper in the top 20, one journal over half: each fails, by its own name`, () => {
      expect(failures(judgeSearch(T, kind, found(19), 2025))).toEqual(["too few results"]);
      expect(judgeSearch(T, kind, found(20), 2025).ok).toBe(true);
      expect(failures(judgeSearch(T, kind, found(24, (i) => paper(i, i < 11 ? { abstract: null } : {})), 2025))).toEqual(["too few abstracts"]); // 9 of the top 20 have one
      expect(judgeSearch(T, kind, found(24, (i) => paper(i, i < 10 ? { abstract: null } : {})), 2025).ok).toBe(true); // 10 do
      expect(failures(judgeSearch(T, kind, found(24, (i) => paper(i, i < 16 ? { year: 2019 } : {})), 2025))).toEqual(["too few recent"]); // 4 of the top 20 are recent
      expect(judgeSearch(T, kind, found(24, (i) => paper(i, i < 15 ? { year: 2019 } : {})), 2025).ok).toBe(true); // 5 are
      expect(failures(judgeSearch(T, kind, found(24, (i) => paper(i, i === 2 ? { retracted: true } : {})), 2025))).toEqual(["retracted"]);
      expect(failures(judgeSearch(T, kind, found(24, (i) => paper(i, i < 13 ? { venue: "One Journal" } : {})), 2025))).toEqual(["one venue"]); // 13 of 24 is over half
      expect(judgeSearch(T, kind, found(24, (i) => paper(i, i < 12 ? { venue: "One Journal" } : {})), 2025).ok).toBe(true); // exactly half is not
      // several at once are all said, in the order of the rules
      expect(failures(judgeSearch(T, kind, found(5, (i) => paper(i, { retracted: true })), 2025))).toEqual(["too few results", "too few abstracts", "retracted"]);
    });

    it(`${kind}: a retracted paper below the top 20 is not counted (the answer is written from the top 20), a paper from before the search year is not recent`, () => {
      expect(judgeSearch(T, kind, found(30, (i) => paper(i, i === 25 ? { retracted: true } : {})), 2025).ok).toBe(true);
      expect(judgeSearch(T, kind, found(30, (i) => paper(i, { year: i < 5 ? 2024 : 2025 })), 2025).summary?.recent).toBe(15);
    });
  }
});

describe("a search whose own check for retracted papers did not answer has not shown that none is retracted", () => {
  // Crossref answering 429 or 5xx, or its shared lane being busy, makes retractionCheck.ok false and flags nothing; OpenAlex's own flag is nearly blind for fresh papers (plan, section 1)
  const good = { openalex: { ok: true }, pubmed: { ok: true } };
  for (const kind of ["trending", "hand"] as const) {
    it(`${kind}: a clean top 20 with retractionCheck.ok false (or no retractionCheck at all) FAILS, saying so; the same answer with the check answering passes`, () => {
      expect(judgeSearch(T, kind, found(24, paper, good, { ok: true }), 2025)).toMatchObject({ ok: true, failures: [] });
      for (const check of [{ ok: false }, null]) {
        const r = judgeSearch(T, kind, found(24, paper, good, check), 2025);
        expect(r, JSON.stringify(check)).toMatchObject({ answered: true, ok: false, failures: ["the retraction check did not answer"] });
      }
    });
  }

  it("a retracted paper is still said by its own name, together with it", () => {
    const r = judgeSearch(T, "trending", found(24, (i) => paper(i, i === 2 ? { retracted: true } : {}), good, { ok: false }), 2025);
    expect(r.failures).toEqual(["retracted", "the retraction check did not answer"]);
  });

  it("a Try chip is only warned (an evergreen search the owner chose; a Crossref hiccup is not an alert), and is not said to have no retracted paper", () => {
    expect(judgeSearch(T, "try", found(24, paper, good, { ok: false }), 2025)).toMatchObject({ ok: true, failures: [], warnings: ["the retraction check did not answer"] });
    expect(judgeSearch(T, "try", found(24, (i) => paper(i, i === 3 ? { retracted: true } : {}), good, { ok: false }), 2025)).toMatchObject({ ok: false, failures: ["1 retracted paper in the top 20"] });
  });
});

describe("a bundled Try chip only has to find something, and nothing retracted", () => {
  it("finding nothing fails; so does a retracted paper in the top 20, whatever else is good", () => {
    expect(judgeSearch(T, "try", found(0), 2025)).toMatchObject({ answered: true, ok: false, failures: ["found nothing"] });
    const r = judgeSearch(T, "try", found(24, (i) => paper(i, i === 7 ? { retracted: true } : {})), 2025);
    expect(r).toMatchObject({ ok: false, failures: ["1 retracted paper in the top 20"] });
    expect(judgeSearch(T, "try", found(24, (i) => paper(i, i < 2 ? { retracted: true } : {})), 2025).failures).toEqual(["2 retracted papers in the top 20"]);
  });

  it("an evergreen search whose papers are old, and one with few results or few abstracts, passes and says so", () => {
    expect(judgeSearch(T, "try", found(24, (i) => paper(i, { year: 2012 })), 2025)).toMatchObject({ ok: true, failures: [], warnings: [] });
    expect(judgeSearch(T, "try", found(6), 2025)).toMatchObject({ ok: true, warnings: ["only 6 results"] });
    expect(judgeSearch(T, "try", found(24, (i) => paper(i, i < 20 ? { abstract: null } : {})), 2025)).toMatchObject({ ok: true, warnings: ["only 0 with an abstract in the top 20"] });
    expect(judgeSearch(T, "try", found(12, (i) => paper(i, { abstract: i < 2 ? ABSTRACT : null })), 2025).warnings).toEqual(["only 2 with an abstract in the top 20"]);
  });
});

describe("a search that could not be had is a failure, not an empty result", () => {
  it("no answer at all, a body that is not a search, and a search that no source answered", () => {
    for (const kind of ["trending", "try", "hand"] as const) {
      expect(judgeSearch(T, kind, null, 2025)).toMatchObject({ answered: false, ok: false, failures: ["the search could not be read"] });
      expect(judgeSearch(T, kind, { type: "rate_limited" }, 2025)).toMatchObject({ ok: false, failures: ["the search could not be read"] });
      expect(judgeSearch(T, kind, { results: [], providers: { openalex: { ok: false }, pubmed: { ok: false } } }, 2025)).toMatchObject({ answered: false, ok: false, failures: ["no source answered the search"] });
      expect(judgeSearch(T, kind, { results: [] }, 2025)).toMatchObject({ answered: false, ok: false });
    }
  });

  it("a source that did not answer while others did is said, and does not fail the check", () => {
    const r = judgeSearch(T, "trending", found(24, paper, { openalex: { ok: true }, s2: { ok: false } }), 2025);
    expect(r).toMatchObject({ ok: true, warnings: ["did not answer: s2"] });
  });
});

/* ---------------------------------------------------------------- the file */

const NOW = Date.parse("2026-11-05T09:00:00Z");
const chip = (text: string, over: Record<string, unknown> = {}) => ({ text, sinceYear: 2025, a: 300, b: 100, field: "Computer Science", ...over });
const TEXTS = ["retrieval-augmented generation", "AI literacy", "green hydrogen production", "predictive coding", "altermagnetism", "central bank digital currency", "heritage digitisation", "reconfigurable intelligent surfaces", "plant microbiome engineering", "single-atom catalysts", "solid-state batteries", "environmental DNA"];
const file = (n = 12, over: Record<string, unknown> = {}, india: string[] = ["retrieval-augmented generation"]) => ({
  version: 1,
  asOf: "2026-11-05",
  generatedAt: "2026-11-05T03:20:00.000Z",
  validUntil: "2026-11-07T03:20:00.000Z",
  poolAsOf: "2026-11-03",
  disabled: false,
  groups: { global: { chips: TEXTS.slice(0, n).map((t) => chip(t)) }, in: { chips: india.map((t) => chip(t)) } },
  ...over,
});

describe("the file the route answers: what the page would do with it", () => {
  it("a fresh file with 12 phrases and one for India: nothing wrong, and every phrase is to be searched in its own scope", () => {
    const v = judgeFeed(T, TC, file(), NOW);
    expect(v.state).toBe("fresh");
    expect(v.problems).toEqual([]);
    expect(v.chips).toHaveLength(13);
    expect(v.chips.filter((c: { group: string }) => c.group === "in").map((c: { text: string }) => c.text)).toEqual(["retrieval-augmented generation"]);
    expect(v.chips[0]).toEqual({ group: "global", text: "retrieval-augmented generation", sinceYear: 2025, a: 300, b: 100, field: "Computer Science" });
  });

  it("exactly 8 phrases for everyone is enough, 7 is not (the job never publishes fewer than 8), and none for India is fine", () => {
    expect(judgeFeed(T, TC, file(8, {}, []), NOW).problems).toEqual([]);
    expect(judgeFeed(T, TC, file(7, {}, []), NOW).problems).toEqual(["only 7 phrases for everyone, at least 8 are needed"]);
  });

  it("something the page's own reader refuses is a problem and nothing is searched: another version, a bad date, a bad chip, more than 12 phrases, not an object", () => {
    for (const raw of [null, "x", [], {}, file(12, { version: 2 }), file(12, { validUntil: "tomorrow" }), file(12, { disabled: "no" }), { ...file(), groups: { global: { chips: [chip("a")] }, in: { chips: [] } } }, { ...file(), groups: { global: { chips: [...TEXTS, "one more"].map((t) => chip(t)) }, in: { chips: [] } } }]) {
      const v = judgeFeed(T, TC, raw, NOW);
      expect(v.state, JSON.stringify(raw)?.slice(0, 60)).toBe("unreadable");
      expect(v.problems).toEqual(["the page's own reader does not accept the file"]);
      expect(v.chips).toEqual([]);
    }
  });

  it("an expired file and a file whose weekly pool is older than 14 days are not shown by the page, so they fail here (the job has stopped)", () => {
    const expired = judgeFeed(T, TC, file(12, { validUntil: "2026-11-05T08:59:59.000Z" }), NOW);
    expect(expired.state).toBe("stale");
    expect(expired.problems).toHaveLength(1);
    expect(expired.problems[0]).toMatch(/expired or its pool is too old/);
    expect(expired.chips).toEqual([]);
    // the pool is a day, counted from its midnight: 14.4 days before this moment is too old, 13.4 is not
    expect(judgeFeed(T, TC, file(12, { poolAsOf: "2026-10-22" }), NOW).state).toBe("stale");
    expect(judgeFeed(T, TC, file(12, { poolAsOf: "2026-10-23" }), NOW).state).toBe("fresh");
    expect(judgeFeed(T, TC, file(12, { validUntil: "2026-11-05T09:00:01.000Z" }), NOW).state).toBe("fresh");
  });

  it("a file that is switched off (disabled: true) is the owner's own switch, not a failure; --require-feed makes it one", () => {
    const off = file(0, { disabled: true }, []);
    expect(judgeFeed(T, TC, off, NOW)).toMatchObject({ state: "off", problems: [], chips: [] });
    expect(judgeFeed(T, TC, off, NOW, { requireFeed: true }).problems).toEqual(["the feed is switched off (disabled: true) and --require-feed was given"]);
    // the empty file the route gives when it has nothing is already expired, and says disabled: false: that is a stale feed
    expect(judgeFeed(T, TC, T.emptyPayload(new Date(NOW), false), NOW).state).toBe("stale");
  });

  it("a phrase whose text breaks a chip rule is a problem even when the page's reader accepts it (a generic word, small talk, a URL)", () => {
    for (const [text, rule] of [["machine learning", /generic/], ["thanks a lot", /small_talk/], ["see https://example.org", /url|not_clean/]] as const) {
      const v = judgeFeed(T, TC, { ...file(), groups: { global: { chips: [...TEXTS.slice(0, 8).map((t) => chip(t)), chip(text)] }, in: { chips: [] } } }, NOW);
      expect(v.problems.join(" "), text).toMatch(rule);
    }
  });
});

describe("the line the alert issue quotes", () => {
  it("names what failed, marks India, and is cut at 400 characters", () => {
    const results = [
      { ok: true, kind: "try", group: "global", text: "fine", failures: [] },
      { ok: false, kind: "trending", group: "in", text: "altermagnetism", failures: ["retracted"] },
      { ok: false, kind: "try", group: "global", text: "NEP 2020 higher education India", failures: ["found nothing"] },
    ];
    expect(detailLine(["the file is expired"], results)).toBe('the file is expired; trending "altermagnetism" (India): retracted; try "NEP 2020 higher education India": found nothing');
    expect(detailLine([], [])).toBe("");
    expect(detailLine(["x".repeat(500)], results)).toHaveLength(400);
  });
});

describe("the line the workflow's output file gets", () => {
  // GITHUB_OUTPUT is read line by line as name=value: a second line that is not one makes the runner refuse the whole file, and the alert issue loses its detail
  it("is one line, whatever the message holds: an esbuild failure has several, a chip's text may have a line break", () => {
    const failure = 'Build failed with 1 error:\n<stdin>:1:14: ERROR: Could not resolve "../web/src/workspace/starters"\r\n\tat somewhere';
    const line = outputLine("detail", `the check could not run: ${failure}`);
    expect(line).toBe('detail=the check could not run: Build failed with 1 error: <stdin>:1:14: ERROR: Could not resolve "../web/src/workspace/starters" at somewhere');
    expect(line).not.toMatch(/[\r\n]/);
    expect(outputLine("detail", detailLine(['the text of "a\nb" breaks a chip rule (invisible)'], []))).not.toMatch(/[\r\n]/);
  });

  it("keeps at most 400 characters of the message, and never throws on what is not a string", () => {
    expect(outputLine("detail", "x".repeat(1000))).toBe(`detail=${"x".repeat(400)}`);
    expect(outputLine("detail", "  a   b  ")).toBe("detail=a b");
    for (const v of [undefined, null, 5, {}, new Error("boom")]) expect(() => outputLine("detail", v as never)).not.toThrow();
    expect(outputLine("detail", new Error("boom") as never)).toBe("detail=Error: boom");
  });
});

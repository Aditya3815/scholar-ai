import { describe, expect, it } from "vitest";
import { VERIFY, retractionChecked, summarizeSearch, verifySummary, type SearchSummary, type VerifyPaper } from "@scholar/shared/src/trending";

/**
 * T8: a phrase is published only if the product's own search, run on it (all providers, the same merge, from the search year on), finds enough: at least 20 results, 10 with abstracts,
 * 5 from the last 24 months, none retracted in the top 20, and no venue with more than half of the results. These tests are on the summary of a search and on the thresholds;
 * the search itself is the job's.
 */

const abstract = (n = 200) => `${"word ".repeat(Math.ceil(n / 5)).slice(0, n - 1)}.`; // n characters, ending in a full stop
const paper = (i: number, over: Partial<VerifyPaper> = {}): VerifyPaper => ({ abstract: abstract(), year: 2026, retracted: false, venue: `Journal number ${i}`, ...over });
const results = (n: number, over: (i: number) => Partial<VerifyPaper> = () => ({})): VerifyPaper[] => Array.from({ length: n }, (_, i) => paper(i, over(i)));
const SINCE = 2025;
const sum = (r: readonly VerifyPaper[]) => summarizeSearch(r, SINCE);

describe("the thresholds", () => {
  it("are the plan's: 20 results, 10 abstracts, 5 recent, no retracted in the top 20, no venue over half", () => {
    expect(VERIFY).toMatchObject({ minResults: 20, minAbstracts: 10, minRecent: 5, window: 20, maxRetracted: 0, maxVenueShare: 0.5 });
  });
});

describe("summarizeSearch", () => {
  it("counts what the thresholds ask for, over the first 20 results", () => {
    const s = sum(results(25));
    expect(s).toMatchObject({ total: 25, withAbstract: 20, recent: 20, retracted: 0 });
    expect(s.topVenueShare).toBeCloseTo(1 / 25, 5);
  });

  it("counts an abstract only if it is long enough to be read (80 characters, as the answer needs)", () => {
    const r = results(20, (i) => ({ abstract: i < 4 ? abstract(80) : i < 8 ? abstract(79) : i < 12 ? "" : i < 14 ? null : i < 16 ? "   " : undefined }));
    expect(sum(r).withAbstract).toBe(4);
    expect(abstract(80)).toHaveLength(80);
  });

  it("counts a paper as recent when its year is the search year or later; a paper with no year is not recent", () => {
    const r = results(20, (i) => ({ year: i === 0 ? 2025 : i === 1 ? 2024 : i === 2 ? null : i === 3 ? undefined : i === 4 ? 2030 : 2013 }));
    expect(sum(r).recent).toBe(2); // 2025 and 2030 (a year ahead is a year that counts)
  });

  it("counts retracted papers among the first 20 only: the 21st is not in the answer", () => {
    expect(sum(results(25, (i) => ({ retracted: i === 19 }))).retracted).toBe(1);
    expect(sum(results(25, (i) => ({ retracted: i === 20 }))).retracted).toBe(0);
    expect(sum(results(25, (i) => ({ retracted: i % 2 === 0 }))).retracted).toBe(10);
  });

  it("counts abstracts and recent papers among the first 20 only, too", () => {
    expect(sum(results(30, (i) => ({ abstract: i < 20 ? "" : abstract() }))).withAbstract).toBe(0);
    expect(sum(results(30, (i) => ({ year: i < 20 ? 2010 : 2026 }))).recent).toBe(0);
  });

  it("measures the biggest venue as a share of all the results, ignoring case and spacing; a paper with no venue is in none", () => {
    const r = results(20, (i) => ({ venue: i < 9 ? (i % 2 ? "Nature Communications" : "  nature  communications ") : i < 12 ? null : `Other ${i}` }));
    expect(sum(r).topVenueShare).toBeCloseTo(9 / 20, 5);
    expect(sum(results(10, () => ({ venue: null }))).topVenueShare).toBe(0);
    expect(sum(results(10, () => ({ venue: "  " }))).topVenueShare).toBe(0);
  });

  it("gives zeros for nothing, and skips what is not a paper", () => {
    expect(sum([])).toEqual({ total: 0, withAbstract: 0, recent: 0, retracted: 0, topVenueShare: 0 });
    expect(sum([null, undefined, 5, "x"] as unknown as VerifyPaper[]).total).toBe(0);
    expect(() => sum(null as unknown as VerifyPaper[])).not.toThrow();
    expect(sum(null as unknown as VerifyPaper[]).total).toBe(0);
  });

  it("verifies as nothing found when the results cannot be read at all (a paper that throws)", () => {
    const boom = new Proxy({}, { get() { throw new Error("unreadable"); } }) as unknown as VerifyPaper;
    const s = sum([paper(1), boom]);
    expect(s).toEqual({ total: 0, withAbstract: 0, recent: 0, retracted: 0, topVenueShare: 0 });
    expect(verifySummary(s).ok).toBe(false);
    expect(verifySummary(new Proxy({}, { get() { throw new Error("unreadable"); } }) as unknown as SearchSummary).ok).toBe(false);
  });

  it("a retracted flag that is anything but true does not count (the search sets a boolean)", () => {
    expect(sum(results(20, () => ({ retracted: null }))).retracted).toBe(0);
    expect(sum(results(20, () => ({ retracted: undefined }))).retracted).toBe(0);
  });
});

describe("verifySummary", () => {
  const good: SearchSummary = { total: 25, withAbstract: 20, recent: 20, retracted: 0, topVenueShare: 0.1 };

  it("passes a search that has enough of everything", () => {
    expect(verifySummary(good)).toEqual({ ok: true, failures: [] });
  });

  it("wants at least 20 results (19 fails, 20 passes)", () => {
    expect(verifySummary({ ...good, total: 19 })).toEqual({ ok: false, failures: ["too_few_results"] });
    expect(verifySummary({ ...good, total: 20 }).ok).toBe(true);
  });

  it("wants at least 10 abstracts (9 fails, 10 passes)", () => {
    expect(verifySummary({ ...good, withAbstract: 9 })).toEqual({ ok: false, failures: ["too_few_abstracts"] });
    expect(verifySummary({ ...good, withAbstract: 10 }).ok).toBe(true);
  });

  it("wants at least 5 from the last 24 months (4 fails, 5 passes)", () => {
    expect(verifySummary({ ...good, recent: 4 })).toEqual({ ok: false, failures: ["too_few_recent"] });
    expect(verifySummary({ ...good, recent: 5 }).ok).toBe(true);
  });

  it("wants no retracted paper in the top 20: one is enough to drop the phrase", () => {
    expect(verifySummary({ ...good, retracted: 1 })).toEqual({ ok: false, failures: ["retracted"] });
    expect(verifySummary({ ...good, retracted: 0 }).ok).toBe(true);
  });

  it("wants no venue above half of the results (0.5 passes, over it fails)", () => {
    expect(verifySummary({ ...good, topVenueShare: 0.5 }).ok).toBe(true);
    expect(verifySummary({ ...good, topVenueShare: 0.51 })).toEqual({ ok: false, failures: ["one_venue"] });
  });

  it("names every reason, not only the first", () => {
    expect(verifySummary({ total: 3, withAbstract: 0, recent: 0, retracted: 2, topVenueShare: 0.9 }).failures).toEqual(["too_few_results", "too_few_abstracts", "too_few_recent", "retracted", "one_venue"]);
  });

  it("fails what it cannot read: a missing number is not a pass", () => {
    for (const key of ["total", "withAbstract", "recent", "retracted", "topVenueShare"] as const) {
      expect(verifySummary({ ...good, [key]: NaN }).ok, key).toBe(false);
      expect(verifySummary({ ...good, [key]: undefined } as unknown as SearchSummary).ok, key).toBe(false);
    }
    expect(verifySummary(null as unknown as SearchSummary).ok).toBe(false);
    expect(verifySummary({} as SearchSummary).ok).toBe(false);
    expect(verifySummary({ ...good, retracted: -1 }).ok).toBe(false);
    expect(verifySummary({ ...good, topVenueShare: -0.1 }).ok).toBe(false);
  });
});

describe("whole searches (shaped like the live probe: since 2025, journal articles)", () => {
  const verdict = (r: readonly VerifyPaper[]) => verifySummary(sum(r));

  it("retrieval-augmented generation: 25 results, 24 with abstracts, all recent", () => {
    const r = results(25, (i) => ({ abstract: i === 3 ? null : abstract(), year: 2025 + (i % 2) }));
    expect(verdict(r).ok).toBe(true);
  });

  it("a drug with few abstracts at one provider but a merged list that has enough (tirzepatide: OpenAlex alone had 2 of 25)", () => {
    const merged = results(25, (i) => ({ abstract: i < 12 ? abstract() : null }));
    expect(verdict(merged).ok).toBe(true);
    const openalexOnly = results(25, (i) => ({ abstract: i < 2 ? abstract() : null }));
    expect(verdict(openalexOnly).failures).toEqual(["too_few_abstracts"]);
  });

  it("an old topic: the default search returns old papers (median year 2013, 2 of 25 since 2024), so without the year it fails", () => {
    const old = results(25, (i) => ({ year: i < 2 ? 2025 : 2013 }));
    expect(verdict(old).failures).toEqual(["too_few_recent"]);
  });

  it("a topic that one venue fills (a repository, a regional batch)", () => {
    const batch = results(25, (i) => ({ venue: i < 14 ? "Indonesian Regional Journal" : `Journal ${i}` }));
    expect(verdict(batch).failures).toEqual(["one_venue"]);
  });

  it("a topic with a retracted paper in the top 20 fails, even if everything else is fine", () => {
    expect(verdict(results(25, (i) => ({ retracted: i === 7 }))).failures).toEqual(["retracted"]);
  });

  it("a phrase that finds almost nothing", () => {
    expect(verdict(results(6)).failures).toEqual(["too_few_results", "too_few_abstracts"]); // 6 abstracts are fewer than 10 as well
    expect(verdict([]).failures).toContain("too_few_results");
  });
});

describe("retractionChecked: the search's own check for retracted papers (Crossref and Retraction Watch) answered", () => {
  it("is true only for a check that says ok: true; a failed one, a missing one and anything that is not a search answer are not", () => {
    expect(retractionChecked({ retractionCheck: { ok: true, count: 0, ms: 3, cached: false } })).toBe(true);
    expect(retractionChecked({ retractionCheck: { ok: false, count: 0, ms: 3, cached: false, error: "HTTP 429" } })).toBe(false);
    for (const v of [{}, { retractionCheck: null }, { retractionCheck: {} }, { retractionCheck: { ok: "true" } }, { retractionCheck: { ok: 1 } }, null, undefined, 5, "x", []]) expect(retractionChecked(v), JSON.stringify(v)).toBe(false);
  });

  it("never throws, whatever it is given", () => {
    const evil = { get retractionCheck(): never { throw new Error("boom"); } };
    expect(retractionChecked(evil)).toBe(false);
  });
});

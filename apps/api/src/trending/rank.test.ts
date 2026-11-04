import { describe, expect, it } from "vitest";
import { TREND, confirmation, countryProblem, evaluate, journalProblem, scoreSubfields, trendScore, trendWindows, usesSecondSource, wilsonLower, withExactBaseline, type Candidate, type KeywordRow, type SubfieldInput } from "@scholar/shared/src/trending";
import { SUBFIELDS } from "@scholar/shared/src/subfield-policy";

/**
 * T5: the signal. a = journal papers with the keyword in window A (91 days that end 45 days ago), b = the same dates 364 days earlier, score = the Wilson lower bound of a/(a+b) as odds,
 * against the subfield's own growth. Numbers marked (probe) are the live counts of 2 Nov 2026 (docs: r2-trend-method), so the cases are real ones.
 */

// real subfield ids: 1702 Artificial Intelligence, 1707 Computer Vision, 1706 Computer Science Applications (Computer Science, Physical Sciences);
// 2712 Endocrinology and 2730 Oncology (Health Sciences, held); 2200 General Engineering (never); 9999 is not in OpenAlex
const AI = 1702, CV = 1707, CSA = 1706, ENDO = 2712, ONCO = 2730, GENERAL = 2200, UNKNOWN = 9999;
const row = (id: string, name: string, count: number): KeywordRow => ({ id, name, count });
const sf = (subfield: number, a: KeywordRow[], b: KeywordRow[], ratio = 1, totalB = 100_000): SubfieldInput => ({ subfield, totalA: Math.round(totalB * ratio), totalB, rowsA: a, rowsB: b });
const names = (xs: readonly Candidate[]) => xs.map((c) => c.text);

describe("wilsonLower: how much of a rise can be believed", () => {
  it("matches the live probe values (Evan Miller's formula, z = 1.96)", () => {
    const R = 1.11;
    const score = (a: number, b: number) => trendScore(a, b, R)!;
    expect(score(40, 20)).toBeCloseTo(1.06, 2); // raw 2.00, falls under the 1.2 line
    expect(score(40, 15)).toBeCloseTo(1.34, 2); // raw 2.67
    expect(score(100, 50)).toBeCloseTo(1.29, 2);
    expect(score(452, 176)).toBeCloseTo(1.94, 2); // retrieval-augmented generation (probe)
    expect(score(1455, 934)).toBeCloseTo(1.29, 2);
    expect(score(13, 2)).toBeCloseTo(1.48, 2); // raw 6.5 on 15 papers
  });

  it("is lower than the raw share, and nearer to it with more papers", () => {
    const p = 0.75;
    let last = 0;
    for (const n of [4, 20, 100, 1000, 100_000]) {
      const L = wilsonLower(p * n, n);
      expect(L).toBeLessThan(p);
      expect(L).toBeGreaterThan(last);
      last = L;
    }
    expect(last).toBeCloseTo(p, 2);
  });

  it("is a number between 0 and 1 for any input, and 0 when there is nothing", () => {
    expect(wilsonLower(0, 0)).toBe(0);
    expect(wilsonLower(5, 0)).toBe(0);
    expect(wilsonLower(0, 50)).toBe(0);
    expect(wilsonLower(50, 50)).toBeGreaterThan(0.9);
    expect(wilsonLower(50, 50)).toBeLessThan(1);
    for (const [k, n] of [[-1, 10], [10, -1], [NaN, 10], [10, NaN], [Infinity, Infinity], [11, 10]] as const) {
      const L = wilsonLower(k, n);
      expect(L >= 0 && L <= 1, `${k}/${n}`).toBe(true);
    }
  });

  it("at the floors: 40 papers that are all new give about 0.91, so even a perfect rise is not infinite", () => {
    expect(wilsonLower(40, 40)).toBeCloseTo(0.9124, 3);
    expect(wilsonLower(150, 150)).toBeCloseTo(0.975, 3);
  });
});

describe("trendScore: the rise against the subfield's own rise", () => {
  it("is 1.0 for a keyword that grows exactly as fast as its subfield, with plenty of evidence", () => {
    expect(trendScore(100_000, 100_000, 1)).toBeCloseTo(0.99, 1);
  });

  it("divides by the subfield's growth: the same counts score lower in a subfield that is itself growing", () => {
    expect(trendScore(200, 100, 1)!).toBeGreaterThan(trendScore(200, 100, 1.5)!);
    expect(trendScore(200, 100, 1.5)!).toBeLessThan(trendScore(200, 100, 1)! / 1.4);
  });

  it("is null when there is nothing to compare: no subfield growth, a nonsense number, or no papers at all", () => {
    for (const ratio of [0, -1, NaN, Infinity]) expect(trendScore(100, 50, ratio)).toBeNull();
    expect(trendScore(0, 0, 1)).toBeNull();
    expect(trendScore(-5, 10, 1)).toBeNull();
    expect(trendScore(NaN, 10, 1)).toBeNull();
    expect(trendScore(10, -5, 1)).toBeNull();
  });
});

describe("trendWindows: the two windows of dates", () => {
  it("is 91 days that end 45 days before the day, and the same dates 364 days earlier (the same weekdays)", () => {
    const w = trendWindows("2026-11-03");
    expect(w.a).toEqual({ from: "2026-06-21", to: "2026-09-19" });
    expect(w.b).toEqual({ from: "2025-06-22", to: "2025-09-20" });
    const days = (x: { from: string; to: string }) => (Date.parse(x.to) - Date.parse(x.from)) / 864e5 + 1;
    expect(days(w.a)).toBe(91);
    expect(days(w.b)).toBe(91);
    expect(new Date(w.a.to).getUTCDay()).toBe(new Date(w.b.to).getUTCDay());
    expect(new Date(w.a.from).getUTCDay()).toBe(new Date(w.b.from).getUTCDay());
  });

  it("crosses a leap day without losing one", () => {
    const w = trendWindows("2028-04-20"); // window A ends 2028-03-06 and starts 2027-12-07; B is 364 days before
    expect(w.a).toEqual({ from: "2027-12-07", to: "2028-03-06" });
    expect((Date.parse(w.a.to) - Date.parse(w.b.to)) / 864e5).toBe(364);
    expect((Date.parse(w.a.from) - Date.parse(w.b.from)) / 864e5).toBe(364);
  });

  it("throws on a day that is not a day", () => {
    for (const bad of ["", "tomorrow", "2026-02-31", "2026-11-3", "2026-13-01"]) expect(() => trendWindows(bad)).toThrow();
  });
});

describe("scoreSubfields: floors", () => {
  // every keyword here has a tiny baseline, so only the floors decide
  const rows = (counts: [string, number][]) => counts.map(([n, c]) => row(n, n, c));
  const baseline = (counts: [string, number][]) => counts.map(([n]) => row(n, n, 5));

  it("global list: 40 papers in the subfield and 150 in all (probe: tirzepatide has 116, so it stays out)", () => {
    const a: [string, number][] = [["phrase at 150", 150], ["phrase at 149", 149], ["phrase at 116", 116], ["phrase at 40", 40]];
    const { candidates, stats } = scoreSubfields([sf(AI, rows(a), baseline(a))], "global");
    expect(names(candidates)).toEqual(["phrase at 150"]);
    expect(stats.floor).toBe(3);
  });

  it("the 40 is per subfield: a row of 39 is never a candidate, even when the phrase has more than 150 in all", () => {
    const big: [string, number][] = [["spread phrase", 120]];
    const small: [string, number][] = [["spread phrase", 39]];
    const out = scoreSubfields([sf(AI, rows(big), baseline(big)), sf(CSA, rows(small), baseline(small))], "global");
    expect(out.candidates.map((c) => [c.text, c.subfield, c.a])).toEqual([["spread phrase", AI, 120]]);
  });

  it("the 150 is for the phrase in all subfields together: rows that are not candidates themselves still count", () => {
    const a: [string, number][] = [["sums up", 100]];
    const other: [string, number][] = [["sums up", 60]];
    const alone = scoreSubfields([sf(AI, rows(a), baseline(a))], "global");
    expect(alone.candidates).toHaveLength(0);
    // the second subfield's row is no candidate itself (its baseline is 500, so its score is far under the line) but its 60 papers are papers with the keyword
    const together = scoreSubfields([sf(AI, rows(a), baseline(a)), sf(CSA, rows(other), [row("sums up", "sums up", 500)])], "global");
    expect(together.candidates.map((c) => [c.text, c.subfield, c.total])).toEqual([["sums up", AI, 160]]);
  });

  it("India list: 30 papers, not 40 and not 150", () => {
    const a: [string, number][] = [["indian phrase 30", 30], ["indian phrase 29", 29]];
    const { candidates } = scoreSubfields([sf(AI, rows(a), baseline(a))], "in");
    expect(names(candidates)).toEqual(["indian phrase 30"]);
    expect(names(scoreSubfields([sf(AI, rows(a), baseline(a))], "global").candidates)).toEqual([]);
  });

  it("a keyword with no papers or a nonsense count is never a candidate", () => {
    const bad = [row("z", "zero papers", 0), row("n", "negative papers", -40), row("f", "fraction papers", 99.5), row("nan", "nan papers", NaN)];
    expect(() => scoreSubfields([sf(AI, bad, [row("q", "other", 5)])], "global")).not.toThrow();
    expect(scoreSubfields([sf(AI, bad, [row("q", "other", 5)])], "global").candidates).toEqual([]);
  });
});

describe("scoreSubfields: the score and a missing baseline", () => {
  it("keeps a rise that the Wilson bound believes and drops one it does not (40 vs 15 passes, 40 vs 20 does not; both with 150 in all)", () => {
    // the India list (floor 30) so that the numbers of the probe, 40 vs 15 and 40 vs 20, can be used as they are
    const a = [row("up", "genuinely up", 40), row("flat", "barely up", 40)];
    const b = [row("up", "genuinely up", 15), row("flat", "barely up", 20)];
    const { candidates, stats } = scoreSubfields([sf(AI, a, b, 1.11)], "in");
    expect(names(candidates)).toEqual(["genuinely up"]);
    expect(candidates[0]!.score).toBeCloseTo(1.34, 1);
    expect(stats.score).toBe(1);
  });

  it("scores the real probe: retrieval-augmented generation 452 vs 176 beats the subfield's growth by 1.9", () => {
    const { candidates } = scoreSubfields([sf(AI, [row("rag", "retrieval-augmented generation", 452)], [row("rag", "retrieval-augmented generation", 176)], 1.11)], "global");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ text: "retrieval-augmented generation", phrase: "retrieval augmented generation", a: 452, b: 176, bEstimated: false, subfield: AI, field: "Computer Science", fieldId: 17, domain: "Physical Sciences", policy: "allow" });
    expect(candidates[0]!.score).toBeCloseTo(1.94, 2);
    expect(candidates[0]!.ratio).toBeCloseTo(1.11, 2);
    expect(candidates[0]!.total).toBe(452);
  });

  it("sorts by score, then by size, then by name, the same every time", () => {
    const a = [row("x", "bbb phrase", 300), row("y", "aaa phrase", 300), row("z", "ccc phrase", 600), row("w", "ddd phrase", 200)];
    const b = [row("x", "bbb phrase", 100), row("y", "aaa phrase", 100), row("z", "ccc phrase", 300), row("w", "ddd phrase", 50)];
    const first = names(scoreSubfields([sf(AI, a, b)], "global").candidates);
    expect(first).toEqual(["ddd phrase", "aaa phrase", "bbb phrase", "ccc phrase"]);
    expect(names(scoreSubfields([sf(AI, [...a].reverse(), [...b].reverse())], "global").candidates)).toEqual(first);
  });

  describe("a keyword missing from last year's top 200", () => {
    const a = [row("new", "emerging phrase", 200)];
    const b = [row("big", "established phrase", 900), row("mid", "middling phrase", 60), row("low", "smallest listed phrase", 25)];

    it("is given the smallest count that list has (the truth is at most that), and flagged as an estimate", () => {
      const { candidates } = scoreSubfields([sf(AI, a, b)], "global");
      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({ a: 200, b: 25, bEstimated: true });
      expect(candidates[0]!.score).toBeCloseTo(trendScore(200, 25, 1)!, 6);
    });

    it("is not published as it stands: the page would show a count that nobody counted", () => {
      const [c] = scoreSubfields([sf(AI, a, b)], "global").candidates;
      expect(c!.bEstimated).toBe(true);
      const exact = withExactBaseline(c!, 7);
      expect(exact).toMatchObject({ b: 7, bEstimated: false });
      expect(exact.score).toBeGreaterThan(c!.score); // the estimate was the cautious one
      expect(exact.score).toBeCloseTo(trendScore(200, 7, c!.ratio)!, 6);
      expect(c!.b).toBe(25); // the original is not changed
    });

    it("skips the whole subfield when last year's list is empty: there is nothing to compare with", () => {
      const out = scoreSubfields([sf(AI, a, [])], "global");
      expect(out.candidates).toEqual([]);
      expect(out.stats.skipped_subfield).toBe(1);
    });

    it("skips the whole subfield when its own totals are missing or zero", () => {
      for (const [totalA, totalB] of [[0, 100], [100, 0], [NaN, 100], [100, NaN], [-5, 100]] as const) {
        const out = scoreSubfields([{ subfield: AI, totalA, totalB, rowsA: a, rowsB: b }], "global");
        expect(out.candidates, `${totalA}/${totalB}`).toEqual([]);
        expect(out.stats.skipped_subfield).toBe(1);
      }
    });
  });
});

describe("scoreSubfields: what is not a trend", () => {
  it("drops a keyword that is in the top 10 of two or more subfields (probe: 'risk stratification' in Endocrinology and Oncology)", () => {
    const a = [row("rs", "risk stratification", 300), row("pd", "plant defence", 150)];
    const b = [row("rs", "risk stratification", 100), row("pd", "plant defence", 50)];
    const out = scoreSubfields([sf(AI, a, b), sf(CV, [row("rs", "risk stratification", 250)], [row("rs", "risk stratification", 90)])], "global");
    expect(names(out.candidates)).toEqual(["plant defence"]);
    expect(out.stats.multi_subfield).toBe(2); // both rows of the phrase
  });

  it("keeps a keyword that is in the top 10 of one subfield and further down in another", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => row(`k${i}`, `crowded phrase ${i}`, 400 - i));
    const manyB = (n: number) => Array.from({ length: n }, (_, i) => row(`k${i}`, `crowded phrase ${i}`, 100));
    // in CV the shared phrase rises (160 vs 60) but scores below ten other phrases; in AI it is first
    const shared = row("sh", "shared phrase", 160);
    const out = scoreSubfields(
      [sf(AI, [shared], [row("sh", "shared phrase", 40)]), sf(CV, [...many(10), shared], [...manyB(10), row("sh", "shared phrase", 60)])],
      "global",
    );
    expect(names(out.candidates)).toContain("shared phrase");
    expect(out.candidates.filter((c) => c.text === "shared phrase")).toHaveLength(1); // one phrase once
    expect(out.candidates.find((c) => c.text === "shared phrase")!.subfield).toBe(AI); // where it scores best
  });

  it("drops a keyword that is in the top 10 of two subfields even when one of them is held (health)", () => {
    const rs = (n: number) => [row("rs", "risk stratification", n)];
    const out = scoreSubfields([sf(ENDO, rs(300), rs(100)), sf(ONCO, rs(280), rs(100)), sf(AI, rs(200), rs(80))], "global");
    expect(out.candidates).toEqual([]);
    expect(out.held).toEqual([]);
  });

  it("drops the generic words and the digits-only names, and counts them", () => {
    const a = [row("g1", "research", 500), row("g2", "India", 500), row("g3", "2024", 500), row("g4", "Machine Learning", 500), row("ok", "tool use by language models", 500)];
    const b = a.map((r) => row(r.id, r.name, 100));
    const out = scoreSubfields([sf(AI, a, b)], "global");
    expect(names(out.candidates)).toEqual(["tool use by language models"]);
    expect(out.stats["text:generic"]).toBe(3);
    expect(out.stats["text:no_letters"]).toBe(1);
  });

  it("drops a name that is too long, a URL, small talk, an invisible character", () => {
    const bads = ["a phrase that is much longer than thirty-six characters", "https://example.org", "hello there", `zero${String.fromCodePoint(0x200b)}width`];
    const a = [...bads.map((n, i) => row(`b${i}`, n, 500)), row("ok", "world model", 500)];
    const out = scoreSubfields([sf(AI, a, a.map((r) => row(r.id, r.name, 100)))], "global");
    expect(names(out.candidates)).toEqual(["world model"]);
  });

  it("drops what the owner put on the deny list, however it is written", () => {
    const a = [row("x", "Quantum Supremacy", 500), row("y", "world model", 500)];
    const b = a.map((r) => row(r.id, r.name, 100));
    expect(names(scoreSubfields([sf(AI, a, b)], "global", { deny: ["quantum-supremacy"] }).candidates)).toEqual(["world model"]);
    expect(names(scoreSubfields([sf(AI, a, b)], "global", { deny: new Set(["QUANTUM SUPREMACY"]) }).candidates)).toEqual(["world model"]);
    expect(scoreSubfields([sf(AI, a, b)], "global", { deny: ["quantum supremacy"] }).stats.denied).toBe(1);
    expect(names(scoreSubfields([sf(AI, a, b)], "global", { deny: [] }).candidates).sort()).toEqual(["Quantum Supremacy", "world model"]);
  });

  it("a deny list that is broken does not let anything through nor throw", () => {
    const a = [row("y", "world model", 500)];
    const b = [row("y", "world model", 100)];
    expect(() => scoreSubfields([sf(AI, a, b)], "global", { deny: [null, 5, undefined, {}] as unknown as string[] })).not.toThrow();
  });
});

describe("scoreSubfields: the policy table decides where a phrase may go", () => {
  const a = [row("x", "world model", 500)];
  const b = [row("x", "world model", 100)];

  it("puts a phrase from a held subfield (health, politics) in `held`, never in `candidates`", () => {
    const out = scoreSubfields([sf(ENDO, [row("t", "tirzepatide shortage", 500)], [row("t", "tirzepatide shortage", 100)]), sf(AI, a, b)], "global");
    expect(names(out.candidates)).toEqual(["world model"]);
    expect(names(out.held)).toEqual(["tirzepatide shortage"]);
    expect(out.held[0]!.policy).toBe("hold");
    expect(out.held[0]!.domain).toBe("Health Sciences");
  });

  it("does not look at a subfield marked never", () => {
    const out = scoreSubfields([sf(GENERAL, a, b)], "global");
    expect(out.candidates).toEqual([]);
    expect(out.held).toEqual([]);
    expect(out.stats.never_subfield).toBe(1);
    expect(out.stats.rows ?? 0).toBe(0);
  });

  it("holds a subfield it has never heard of: OpenAlex may add one", () => {
    const out = scoreSubfields([sf(UNKNOWN, a, b)], "global");
    expect(out.candidates).toEqual([]);
    expect(names(out.held)).toEqual(["world model"]);
  });

  it("every allowed subfield in the table can produce a candidate, every held one only a held phrase", () => {
    const inputs = SUBFIELDS.filter((s) => s.policy !== "never").map((s, i) => sf(s.id, [row(`k${i}`, `phrase number ${i} here`, 500)], [row(`k${i}`, `phrase number ${i} here`, 100)]));
    const out = scoreSubfields(inputs, "global");
    expect(out.candidates).toHaveLength(SUBFIELDS.filter((s) => s.policy === "allow").length);
    expect(out.held).toHaveLength(SUBFIELDS.filter((s) => s.policy === "hold").length);
    for (const c of out.candidates) expect(c.policy).toBe("allow");
    for (const c of out.held) expect(c.policy).toBe("hold");
    expect(out.candidates.some((c) => c.domain === "Health Sciences")).toBe(false);
  });
});

describe("scoreSubfields: bad input", () => {
  it("gives nothing for nothing, and never throws on rows that are not rows", () => {
    expect(scoreSubfields([], "global")).toMatchObject({ candidates: [], held: [] });
    const junk = [null, undefined, 5, "x", {}, { id: 5 }, { id: "a", name: 7, count: 10 }, { id: "a", name: "ok name", count: "10" }, row("", "no id", 500)] as unknown as KeywordRow[];
    expect(() => scoreSubfields([sf(AI, junk, junk)], "global")).not.toThrow();
    expect(() => scoreSubfields([null, undefined, {}, { subfield: AI }] as unknown as SubfieldInput[], "global")).not.toThrow();
    expect(scoreSubfields([sf(AI, junk, [row("q", "other", 5)])], "global").candidates).toEqual([]);
  });

  it("skips an input or a row that throws when it is read, and carries on with the rest", () => {
    const boom = new Proxy({}, { get() { throw new Error("unreadable"); } });
    const good = sf(AI, [row("x", "world model", 500)], [row("x", "world model", 100)]);
    const out = scoreSubfields([boom, good, { ...sf(CV, [boom as unknown as KeywordRow, row("y", "tool use", 500)], [row("y", "tool use", 100)]) }] as unknown as SubfieldInput[], "global");
    expect(names(out.candidates).sort()).toEqual(["tool use", "world model"]);
    expect(out.stats.bad_subfield).toBe(1);
  });

  it("refuses a group it does not know, rather than guess a floor", () => {
    expect(() => scoreSubfields([], "everywhere" as never)).toThrow(/unknown group/);
  });

  it("does not change what it was given", () => {
    const a = [row("x", "world model", 500)];
    const b = [row("x", "world model", 100)];
    const input = sf(AI, a, b);
    const before = JSON.stringify(input);
    scoreSubfields([input], "global");
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("journalProblem: a keyword that one journal or a few journals made", () => {
  const venues = (counts: number[]) => counts.map((count, i) => ({ id: `S${i}`, count }));

  it("wants at least 8 journals", () => {
    expect(TREND.journals.min).toBe(8);
    expect(journalProblem(venues([20, 20, 20, 20, 20, 20, 20]), 140)).toBe("few_journals");
    expect(journalProblem(venues([20, 20, 20, 20, 20, 20, 20, 20]), 160)).toBeNull();
  });

  it("wants the top journal at 25 percent or less (probe: 'Cardiac pacing' at 32% was rejected, a TCM topic at 14-16% passed)", () => {
    const rest = Array(9).fill(10); // 90 papers in nine other journals
    expect(journalProblem(venues([32, ...rest]), 122)).toBe("concentrated");
    expect(journalProblem(venues([30, ...rest]), 120)).toBeNull(); // exactly 25%
    expect(journalProblem(venues([31, ...rest]), 121)).toBe("concentrated");
    expect(journalProblem(venues([16, ...Array(9).fill(11)]), 115)).toBeNull();
  });

  it("measures the share against the keyword's papers, not only against the journals that were listed (a list cut at 200)", () => {
    expect(journalProblem(venues([60, ...Array(9).fill(5)]), 240)).toBeNull(); // 60 of 240 = 25%
    expect(journalProblem(venues([61, ...Array(9).fill(5)]), 240)).toBe("concentrated");
  });

  it("is concentrated also when the journals listed add up to more than the keyword's count", () => {
    expect(journalProblem(venues([50, ...Array(9).fill(5)]), 40)).toBe("concentrated"); // 50 of 95
  });

  it("ignores a row that throws when it is read", () => {
    const boom = new Proxy({}, { get() { throw new Error("unreadable"); } });
    expect(journalProblem([...venues([10, 10, 10, 10, 10, 10, 10, 10]), boom] as never, 80)).toBeNull();
  });

  it("counts one journal once, ignores empty and nonsense rows, and fails on nothing", () => {
    const dup = [{ id: "S1", count: 10 }, { id: "S1", count: 10 }, ...venues([10, 10, 10, 10, 10, 10]).slice(1)];
    expect(journalProblem(dup, 100)).toBe("few_journals"); // S1 three times is one journal: S1 to S5 are 5 journals
    expect(journalProblem([...venues([10, 10, 10, 10, 10, 10, 10]), { id: "S9", count: 0 }, { id: "", count: 5 }, null, { id: "S8", count: NaN }] as never, 70)).toBe("few_journals");
    expect(journalProblem([], 100)).toBe("few_journals");
    expect(journalProblem(null as never, 100)).toBe("few_journals");
    expect(journalProblem(venues([10, 10, 10, 10, 10, 10, 10, 10]), 0)).toBe("no_count"); // nothing to measure the share against
    expect(journalProblem(venues([10, 10, 10, 10, 10, 10, 10, 10]), NaN)).toBe("no_count");
  });
});

describe("countryProblem: a keyword that one country made (live, 3 Nov 2026: the journal check alone let these through)", () => {
  const tally = (counts: number[]) => counts.map((count, i) => ({ id: `C${i}`, count }));
  // live: the best candidates of Artificial Intelligence and Education had 141 to 200 journals and no journal over 11%, so the journals check passed them; but
  // IndoBERT had 89% Indonesia (10 countries), habituation 83% (10), teacher role modeling 79% (10), Indonesian language 90% (10), digital literacy 66% (64 countries),
  // against retrieval-augmented generation 15% China (61 countries), SHAP 15% (71), AI governance 11% (54), XGBoost 21% (65), artificial intelligence in education 40% (72)

  it("wants the top country at 60 percent or less of the keyword's papers (60 passes, 61 does not)", () => {
    expect(TREND.countries).toEqual({ min: 5, maxShare: 0.6 });
    expect(countryProblem(tally([60, 30, 20, 10, 10]), 100)).toBeNull();
    expect(countryProblem(tally([61, 30, 20, 10, 10]), 100)).toBe("one_country");
  });

  it("wants at least 5 countries", () => {
    expect(countryProblem(tally([30, 30, 30, 30]), 100)).toBe("few_countries");
    expect(countryProblem(tally([30, 30, 30, 30, 30]), 100)).toBeNull();
  });

  it("measures against the keyword's papers, not against the countries listed: a paper with authors in two countries is in both rows", () => {
    expect(countryProblem(tally([60, 50, 40, 30, 20]), 100)).toBeNull(); // the rows add up to 200, and 60 is 60%
    expect(countryProblem(tally([61, 50, 40, 30, 20]), 100)).toBe("one_country");
  });

  it("drops what the live data showed: IndoBERT and the Education phrases that one country wrote", () => {
    expect(countryProblem(tally([175, 4, 3, 2, 2, 2, 1, 1, 1, 1]), 197)).toBe("one_country"); // IndoBERT: Indonesia 89%, 10 countries
    expect(countryProblem(tally([621, 10, 8, 6, 5, 4, 3, 2, 1, 1]), 748)).toBe("one_country"); // habituation: 83%
    expect(countryProblem(tally([983, 30, 30, 20, 20, 10, 10, 10]), 1490)).toBe("one_country"); // digital literacy: 66% (and 64 countries in all)
  });

  it("keeps what is written all over the world", () => {
    expect(countryProblem(tally([65, 48, 39, ...Array(58).fill(8)]), 432)).toBeNull(); // retrieval-augmented generation: China 15%, 61 countries
    expect(countryProblem(tally([290, ...Array(71).fill(5)]), 724)).toBeNull(); // artificial intelligence in education: 40%
  });

  it("counts a country once, ignores rows with no country or no papers, and fails on nothing", () => {
    expect(countryProblem([{ id: "IN", count: 10 }, { id: "IN", count: 10 }, ...tally([10, 10, 10, 10]).slice(1)], 100)).toBe("few_countries"); // IN twice is one country: 4 in all
    expect(countryProblem([...tally([20, 20, 20, 20, 20]), { id: "", count: 5 }, { id: "XX", count: 0 }, null, { id: "YY", count: NaN }] as never, 100)).toBeNull();
    expect(countryProblem([], 100)).toBe("few_countries");
    expect(countryProblem(tally([20, 20, 20, 20, 20]), 0)).toBe("no_count");
    expect(countryProblem(tally([20, 20, 20, 20, 20]), NaN)).toBe("no_count");
    expect(countryProblem(undefined, 100)).toBe("no_country_data");
    expect(countryProblem(null as never, 100)).toBe("no_country_data");
    expect(countryProblem("IN" as never, 100)).toBe("no_country_data");
    const boom = new Proxy({}, { get() { throw new Error("unreadable"); } });
    expect(countryProblem([...tally([20, 20, 20, 20, 20]), boom] as never, 100)).toBeNull();
  });
});

describe("confirmation: a phrase is shown only if something besides OpenAlex's own count agrees", () => {
  const cs = (score: number): Pick<Candidate, "score" | "fieldId"> => ({ score, fieldId: 17 }); // Computer Science: arXiv is the second source
  const edu = (score: number): Pick<Candidate, "score" | "fieldId"> => ({ score, fieldId: 33 }); // Social Sciences: no second source

  it("uses arXiv for computing, mathematics and physics", () => {
    expect(usesSecondSource(17)).toBe(true);
    expect(usesSecondSource(26)).toBe(true);
    expect(usesSecondSource(31)).toBe(true);
    expect(usesSecondSource(33)).toBe(false);
    expect(usesSecondSource(27)).toBe(false);
    expect(usesSecondSource(NaN)).toBe(false);
    const fields = new Map(SUBFIELDS.map((s) => [s.fieldId, s.field]));
    expect(fields.get(17)).toBe("Computer Science");
    expect(fields.get(26)).toBe("Mathematics");
    expect(fields.get(31)).toBe("Physics and Astronomy");
  });

  it("confirms with arXiv volume at least 1.3 times a year ago and at least 40 submissions (probe: 'world model' 93 to 416 a month)", () => {
    expect(confirmation(cs(1.25), { recent: 416, yearAgo: 93 })).toMatchObject({ ok: true, by: "arxiv" });
    expect(confirmation(cs(1.25), { recent: 130, yearAgo: 100 })).toMatchObject({ ok: true, by: "arxiv" }); // exactly 1.3
    expect(confirmation(cs(1.25), { recent: 129, yearAgo: 100 })).toEqual({ ok: false, reason: "second_source_weak" });
    expect(confirmation(cs(1.25), { recent: 52, yearAgo: 40 })).toMatchObject({ ok: true });
    expect(confirmation(cs(1.25), { recent: 39, yearAgo: 1 })).toEqual({ ok: false, reason: "second_source_weak" }); // too few to say
    expect(confirmation(cs(1.25), { recent: 40, yearAgo: 0 })).toMatchObject({ ok: true }); // a phrase that did not exist
    const world = confirmation(cs(1.25), { recent: 416, yearAgo: 93 });
    expect(world).toMatchObject({ ok: true, by: "arxiv" });
    expect((world as { growth: number }).growth).toBeCloseTo(4.47, 2);
  });

  it("does not let a high OpenAlex score stand in for arXiv when arXiv says the phrase is not rising", () => {
    expect(confirmation(cs(3), { recent: 100, yearAgo: 100 })).toEqual({ ok: false, reason: "second_source_weak" });
  });

  it("does not confirm a computing phrase that has no arXiv numbers: it is not shown until they are there", () => {
    for (const none of [undefined, null]) expect(confirmation(cs(3), none)).toEqual({ ok: false, reason: "no_second_source_data" });
    for (const bad of [{ recent: NaN, yearAgo: 10 }, { recent: -5, yearAgo: 10 }, { recent: 100 }, "x", {}]) expect(confirmation(cs(3), bad as never)).toEqual({ ok: false, reason: "no_second_source_data" });
  });

  it("with no second source, wants a score of at least 1.5", () => {
    expect(TREND.confirm.minScoreAlone).toBe(1.5);
    expect(confirmation(edu(1.5), null)).toEqual({ ok: true, by: "score" });
    expect(confirmation(edu(1.49), null)).toEqual({ ok: false, reason: "score_too_low" });
    expect(confirmation(edu(2.4), undefined)).toEqual({ ok: true, by: "score" });
  });

  it("ignores arXiv numbers for a field that arXiv does not cover", () => {
    expect(confirmation(edu(1.3), { recent: 1000, yearAgo: 10 })).toEqual({ ok: false, reason: "score_too_low" });
  });

  it("never throws", () => {
    expect(() => confirmation(null as never, null)).not.toThrow();
    expect(confirmation(null as never, null).ok).toBe(false);
    expect(confirmation({ score: NaN, fieldId: 33 }, null).ok).toBe(false);
  });
});

describe("evaluate: the journal check, the country check and the confirmation together", () => {
  const good = Array.from({ length: 10 }, (_, i) => ({ id: `S${i}`, count: 10 }));
  const world = Array.from({ length: 12 }, (_, i) => ({ id: `C${i}`, count: i === 0 ? 20 : 8 })); // the top country has 20 of the 100 papers
  const base: Candidate = {
    id: "rag", text: "retrieval-augmented generation", phrase: "retrieval augmented generation", subfield: AI, subfieldName: "Artificial Intelligence", field: "Computer Science", fieldId: 17, domain: "Physical Sciences", domainId: 3, policy: "allow",
    a: 100, b: 40, bEstimated: false, ratio: 1.1, score: 1.4, total: 100,
  };

  it("passes a phrase with enough journals and a confirmation", () => {
    expect(evaluate(base, { venues: good, countries: world, second: { recent: 416, yearAgo: 93 } })).toEqual({ ok: true, by: "arxiv", growth: 416 / 93 });
  });

  it("checks the journals first: a phrase that a few journals made is out even when arXiv confirms it", () => {
    const few = [{ id: "S1", count: 90 }, { id: "S2", count: 5 }, { id: "S3", count: 5 }];
    expect(evaluate(base, { venues: few, countries: world, second: { recent: 416, yearAgo: 93 } })).toEqual({ ok: false, reason: "few_journals" });
    const one = [{ id: "S1", count: 40 }, ...Array.from({ length: 9 }, (_, i) => ({ id: `T${i}`, count: 6 }))];
    expect(evaluate({ ...base, a: 94 }, { venues: one, countries: world, second: { recent: 416, yearAgo: 93 } })).toEqual({ ok: false, reason: "concentrated" });
  });

  it("then the countries: IndoBERT passes the journals (141 of them, none over 3%) and is out because 89% of its papers have an author in Indonesia (live, 3 Nov 2026)", () => {
    const spread = Array.from({ length: 141 }, (_, i) => ({ id: `S${i}`, count: i < 55 ? 2 : 1 }));
    const indonesia = [{ id: "ID", count: 175 }, { id: "MY", count: 4 }, { id: "BE", count: 3 }, { id: "IN", count: 2 }, { id: "CN", count: 2 }, { id: "US", count: 2 }, { id: "AU", count: 1 }, { id: "JP", count: 1 }];
    const indobert = { ...base, text: "IndoBERT", a: 197 };
    expect(journalProblem(spread, 197)).toBeNull();
    expect(evaluate(indobert, { venues: spread, countries: indonesia, second: { recent: 416, yearAgo: 93 } })).toEqual({ ok: false, reason: "one_country" });
    // the same phrase with the world's spread would pass
    expect(evaluate(indobert, { venues: spread, countries: world.map((c) => ({ ...c, count: c.count * 2 })), second: { recent: 416, yearAgo: 93 } }).ok).toBe(true);
  });

  it("does not publish a global phrase that has no country numbers (the job must ask), and does not ask for them for the India list, where one country is the point", () => {
    expect(evaluate(base, { venues: good, second: { recent: 416, yearAgo: 93 } })).toEqual({ ok: false, reason: "no_country_data" });
    expect(evaluate(base, { venues: good, second: { recent: 416, yearAgo: 93 }, group: "in" })).toMatchObject({ ok: true, by: "arxiv" });
    expect(evaluate(base, { venues: good, countries: [{ id: "IN", count: 100 }], second: { recent: 416, yearAgo: 93 }, group: "in" })).toMatchObject({ ok: true });
  });

  it("then asks for the confirmation", () => {
    expect(evaluate(base, { venues: good, countries: world })).toEqual({ ok: false, reason: "no_second_source_data" });
    expect(evaluate({ ...base, fieldId: 33, score: 1.6 }, { venues: good, countries: world })).toEqual({ ok: true, by: "score" });
    expect(evaluate({ ...base, fieldId: 33, score: 1.3 }, { venues: good, countries: world })).toEqual({ ok: false, reason: "score_too_low" });
  });
});

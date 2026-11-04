import { describe, expect, it } from "vitest";
import { isFresh, parseTrending, pickChips } from "@scholar/shared";
import { buildPayload, evaluate, scoreSubfields, selectShown, summarizeSearch, verifySummary, type Candidate, type KeywordRow, type SecondSource, type SubfieldInput, type VerifyPaper, type Venue, type Country } from "@scholar/shared/src/trending";

/**
 * The steps in the order the job takes them, on a small fixture: eight subfields, in eight fields, with the counts of the live probe of 2 Nov 2026 where there is one (retrieval-augmented
 * generation 452 vs 176, AI governance 205 vs 78, IndoBERT 221 vs 65) and for the spread of journals and countries of 3 Nov 2026 (IndoBERT: 141 journals, 89% Indonesia), and made-up counts of the same shape for the rest. It shows that the pieces fit together, and the
 * one arithmetic fact the plan does not mention: 2 phrases per domain cannot give the 8 phrases the job must have.
 */

const row = (id: string, name: string, count: number): KeywordRow => ({ id, name, count });
const input = (subfield: number, a: [string, string, number][], b: [string, string, number][], ratio = 1.1): SubfieldInput => ({
  subfield, totalA: Math.round(100_000 * ratio), totalB: 100_000, rowsA: a.map(([id, n, c]) => row(id, n, c)), rowsB: b.map(([id, n, c]) => row(id, n, c)),
});
const INPUTS: SubfieldInput[] = [
  input(1702, [["rag", "retrieval-augmented generation", 452], ["gov", "AI governance", 205], ["indo", "IndoBERT", 221]], [["rag", "retrieval-augmented generation", 176], ["gov", "AI governance", 78], ["indo", "IndoBERT", 65], ["old", "random forest", 900]]),
  input(3304, [["lit", "AI literacy", 220]], [["lit", "AI literacy", 90], ["old", "curriculum design", 400]]),
  input(1110, [["mic", "plant microbiome engineering", 260]], [["mic", "plant microbiome engineering", 100], ["old", "drought tolerance", 700]]),
  input(2105, [["h2", "green hydrogen production", 330]], [["h2", "green hydrogen production", 120], ["old", "solar cells", 900]]),
  input(3104, [["alt", "altermagnetism", 150]], [["old", "graphene", 800], ["low", "spin waves", 20]]), // missing from last year's list: the count is an estimate
  input(2002, [["cbdc", "central bank digital currency", 210]], [["cbdc", "central bank digital currency", 90], ["old", "monetary policy", 500]]),
  input(2805, [["pc", "predictive coding", 190]], [["pc", "predictive coding", 70], ["old", "working memory", 600]]),
  input(2303, [["edna", "environmental DNA", 240]], [["edna", "environmental DNA", 95], ["old", "biodiversity", 800]]),
  input(2208, [["ris", "reconfigurable intelligent surfaces", 280]], [["ris", "reconfigurable intelligent surfaces", 110], ["old", "power converters", 900]]),
  // held: a drug in Endocrinology (never shown), tirzepatide with the probe's 116 papers (under the global floor of 150), and the generic phrase of the probe
  input(2712, [["tz", "tirzepatide", 116], ["sg", "semaglutide cardiovascular outcomes", 300], ["rs", "risk stratification", 300]], [["tz", "tirzepatide", 63], ["sg", "semaglutide cardiovascular outcomes", 120], ["rs", "risk stratification", 100]]),
  input(2730, [["rs", "risk stratification", 280]], [["rs", "risk stratification", 100]]),
];
const journals = (n: number): Venue[] => Array.from({ length: n }, (_, i) => ({ id: `S${i}`, count: 20 }));
// IndoBERT is in 141 journals and none has more than 3% (live, 3 Nov 2026): the journal check passes it. 89% of its papers have an author in Indonesia: the country check does not.
const VENUES: Record<string, Venue[]> = { IndoBERT: Array.from({ length: 141 }, (_, i) => ({ id: `S${i}`, count: i < 55 ? 2 : 1 })) };
const world = (): Country[] => Array.from({ length: 20 }, (_, i) => ({ id: `C${i}`, count: i === 0 ? 40 : 15 }));
const COUNTRIES: Record<string, Country[]> = { IndoBERT: [{ id: "ID", count: 175 }, { id: "MY", count: 4 }, { id: "BE", count: 3 }, { id: "IN", count: 2 }, { id: "CN", count: 2 }, { id: "US", count: 2 }, { id: "AU", count: 1 }, { id: "JP", count: 1 }] };
const ARXIV: Record<string, SecondSource> = {
  "retrieval-augmented generation": { recent: 3100, yearAgo: 700 },
  "AI governance": { recent: 60, yearAgo: 38 },
  altermagnetism: { recent: 120, yearAgo: 25 },
};
const searchFor = (text: string): VerifyPaper[] =>
  Array.from({ length: 25 }, (_, i) => ({ abstract: `${"word ".repeat(30)}.`, year: 2025 + (i % 2), retracted: text === "environmental DNA" && i === 4, venue: `Journal ${i}` }));

describe("the steps, in the job's order", () => {
  const scored = scoreSubfields(INPUTS, "global");

  it("1. scoring keeps the rises, holds the health phrases, drops the generic one, and flags the estimate", () => {
    const by = Object.fromEntries(scored.candidates.map((c) => [c.text, c]));
    expect(Object.keys(by).sort()).toEqual(["AI governance", "AI literacy", "IndoBERT", "altermagnetism", "central bank digital currency", "environmental DNA", "green hydrogen production", "plant microbiome engineering", "predictive coding", "reconfigurable intelligent surfaces", "retrieval-augmented generation"]);
    expect(by["retrieval-augmented generation"]!.score).toBeGreaterThan(by["AI governance"]!.score);
    expect(by.altermagnetism).toMatchObject({ a: 150, b: 20, bEstimated: true });
    expect(scored.held.map((c) => c.text)).toEqual(["semaglutide cardiovascular outcomes"]); // a drug: logged for the owner, never shown; tirzepatide (116 papers) is under the floor of 150 and not even that
    expect(scored.candidates.some((c) => c.text === "risk stratification")).toBe(false);
    expect(scored.held.some((c) => c.text === "risk stratification")).toBe(false);
    expect(scored.stats.multi_subfield).toBe(2); // risk stratification, in the top 10 of Endocrinology and of Oncology
  });

  const evaluated = scored.candidates.filter((c) => evaluate(c, { venues: VENUES[c.text] ?? journals(10), countries: COUNTRIES[c.text] ?? world(), second: ARXIV[c.text] }).ok);
  it("2. the countries take out IndoBERT (a regional batch the journal check lets through), and a second source or a score of 1.5 confirms the rest", () => {
    expect(evaluate(scored.candidates.find((c) => c.text === "IndoBERT")!, { venues: VENUES.IndoBERT, countries: COUNTRIES.IndoBERT, second: { recent: 400, yearAgo: 90 } })).toEqual({ ok: false, reason: "one_country" });
    expect(evaluated.map((c) => c.text)).not.toContain("IndoBERT");
    expect(evaluated.map((c) => c.text)).toContain("retrieval-augmented generation");
    expect(evaluated.map((c) => c.text)).toContain("altermagnetism");
    expect(evaluate(scored.candidates.find((c) => c.text === "predictive coding")!, { venues: journals(10), countries: world() })).toMatchObject({ ok: true, by: "score" }); // neuroscience: no arXiv, but a score over 1.5
  });

  // the job asks OpenAlex for the exact count of the one with an estimate
  const exact = evaluated.map((c) => (c.bEstimated ? { ...c, b: 22, bEstimated: false } : c));
  const verified = (c: Candidate) => verifySummary(summarizeSearch(searchFor(c.text), 2025)).ok;

  it("3. with the plan's caps (1 per field, 2 per domain) the list holds 6 phrases, and the job cannot publish", () => {
    const shown = selectShown(exact, { accept: verified });
    expect(shown).toHaveLength(6);
    expect(() => buildPayload({ now: new Date("2026-11-03T03:17:05Z"), poolAsOf: "2026-11-02", global: shown })).toThrow(/only 6 phrases/);
  });

  it("3. with 4 per domain it holds 8, skips the phrase whose search found a retracted paper, and the file is accepted by the page", () => {
    const shown = selectShown(exact, { perDomain: 4, accept: verified });
    expect(shown.map((c) => c.text)).not.toContain("environmental DNA");
    expect(shown).toHaveLength(8);
    expect(new Set(shown.map((c) => c.fieldId)).size).toBe(8);
    const now = new Date("2026-11-03T03:17:05Z");
    const payload = buildPayload({ now, poolAsOf: "2026-11-02", global: shown });
    expect(parseTrending(JSON.parse(JSON.stringify(payload)))).toEqual(payload);
    expect(isFresh(payload, now)).toBe(true);
    const today = pickChips(payload.groups.global.chips, payload.asOf, 4);
    expect(today).toHaveLength(4);
    for (const chip of today) {
      expect(chip.sinceYear).toBe(2025);
      expect(shown.map((c) => c.text)).toContain(chip.text);
    }
  });

  it("4. the next day's list keeps what was shown unless something is 1.25 times better", () => {
    const first = selectShown(exact, { perDomain: 4, accept: verified });
    const second = selectShown(exact.map((c) => ({ ...c, score: c.score * (c.text === "AI literacy" ? 1.1 : 1) })), { perDomain: 4, accept: verified, previous: first.map((c) => c.text) });
    expect(second.map((c) => c.text).sort()).toEqual(first.map((c) => c.text).sort());
  });
});

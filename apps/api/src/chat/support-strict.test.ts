import { describe, expect, it } from "vitest";
import type { ChatCitation, Paper } from "@scholar/shared";
import type { Picked } from "./answer";
import { JUDGE_SCHEMA, JUDGE_SYSTEM, RECHECK_SYSTEM, STRICT_SCHEMA, STRICT_SYSTEM, applyVerdicts, candidateRewrites, judgeAnswer, readVerdicts, splitClaims, type Judged, type JudgeReport } from "./support";

const SENTENCES = (i: number) => [
  `Paper ${i} reports that the first thing happened in forty patients.`,
  `The second finding of paper ${i} is that the effect was large.`,
  `A third sentence of paper ${i} says the effect did not last.`,
];
const paper = (i: number): Paper => ({
  id: `doi:10.1/${i}`, doi: `10.1/${i}`, pmid: null, title: `Paper ${i}`, authors: ["A. B"], year: 2020, venue: "J", abstract: SENTENCES(i).join(" "),
  citationCount: 1, oaUrl: null, retracted: false, retractionSources: [], sources: ["openalex"], score: 1,
});
const picked = (...ns: number[]): Picked[] => ns.map((n) => ({ n, paper: paper(n) }));
const cite = (n: number, s: number): ChatCitation => ({ n, paperId: `doi:10.1/${n}`, sentenceNo: s, sentence: SENTENCES(n)[s - 1]! });

/** The strict check (docs/design/claim-support.md, "Shortening a claim"): the quick judge never rewrites; the strict one may, under rules the server checks. */
describe("the quick judge never rewrites, the strict one may", () => {
  it("the quick prompt and schema have no `safe`; the strict ones do, and keep every rule of the quick one", () => {
    expect(JUDGE_SYSTEM).not.toMatch(/safe/);
    expect(JSON.stringify(JUDGE_SCHEMA)).not.toMatch(/safe/);
    expect(STRICT_SYSTEM.startsWith(JUDGE_SYSTEM)).toBe(true);
    expect(STRICT_SYSTEM).toMatch(/give safe/);
    expect(STRICT_SCHEMA.properties.claims.items.required).toContain("safe");
    expect(Object.keys(STRICT_SCHEMA.properties.claims.items.properties)).toEqual(expect.arrayContaining(Object.keys(JUDGE_SCHEMA.properties.claims.items.properties)));
    expect(RECHECK_SYSTEM).toMatch(/every word/);
    expect(RECHECK_SYSTEM).toMatch(/untrusted/);
  });

  const text = "The first thing happened in forty patients and also cured everyone [1]. It was large [2].";
  const answer = { text, citations: [cite(1, 1), cite(2, 2)] };
  const first = { claims: [{ c: 0, v: "partial", refs: [{ n: 1, s: [1] }], safe: "The first thing happened in forty patients." }, { c: 1, v: "yes", refs: [{ n: 2, s: [2] }], safe: "" }] };
  const again = { claims: [{ c: 0, v: "yes", refs: [{ n: 1, s: [1] }], safe: "" }] };

  it("the quick judge ignores a shorter claim even when the model sends one, and asks once", async () => {
    let calls = 0;
    const r = await judgeAnswer({ answer, picked: picked(1, 2), judge: async () => (calls++, { json: first, model: "m" }) });
    expect(calls).toBe(1);
    expect(r!.text).toBe(text);
    expect(r!.rewritten).toBe(0);
  });

  it("the strict check cuts the claim down when the shorter one passes the word check and the second reading says yes", async () => {
    const systems: string[] = [];
    const r = await judgeAnswer({
      answer, picked: picked(1, 2), strict: true,
      judge: async (q) => (systems.push(q.system), { json: first, model: "strict" }),
      recheck: async (q) => (systems.push(q.system), { json: again, model: "quick" }),
    });
    expect(systems).toEqual([STRICT_SYSTEM, RECHECK_SYSTEM]);
    expect(r!.text).toBe("The first thing happened in forty patients [1]. It was large [2].");
    expect(r!.rewritten).toBe(1);
    expect(r!.citations.map((c) => [c.n, c.sentenceNo])).toEqual([[1, 1], [2, 2]]);
  });

  it("the second reading sees only the shorter claims and the papers they keep", async () => {
    let prompt = "";
    await judgeAnswer({ answer, picked: picked(1, 2, 3), strict: true, judge: async () => ({ json: first, model: "s" }), recheck: async (q) => ((prompt = q.user), { json: again, model: "q" }) });
    expect(prompt).toContain("c0 cites [1]: The first thing happened in forty patients.");
    expect(prompt).not.toContain("It was large");
    expect(prompt).toContain("[1] Paper 1");
    expect(prompt).not.toContain("[2] Paper 2");
    expect(prompt).not.toContain("[3] Paper 3");
  });

  it("without a `recheck` model the same judge reads the shorter claim again", async () => {
    let calls = 0;
    const r = await judgeAnswer({ answer, picked: picked(1, 2), strict: true, judge: async () => (calls++, { json: calls === 1 ? first : again, model: "m" }) });
    expect(calls).toBe(2);
    expect(r!.rewritten).toBe(1);
  });

  it("a shorter claim that adds a word is refused before any second reading, and the claim stays as it was", async () => {
    let calls = 0;
    const bad = { claims: [{ ...first.claims[0], safe: "The first thing happened in forty patients in Delhi." }, first.claims[1]] };
    const reports: JudgeReport[] = [];
    const r = await judgeAnswer({ answer, picked: picked(1, 2), strict: true, judge: async () => (calls++, { json: bad, model: "m" }), onResult: (x) => reports.push(x) });
    expect(calls).toBe(1);
    expect(r!.text).toBe(text);
    expect(r!.rewritten).toBe(0);
    expect(reports[0]!.rewrites).toEqual([{ c: 0, text: "The first thing happened in forty patients in Delhi.", reason: "words" }]);
  });

  it("a second reading that says partial, no or nothing leaves the claim as it was; so does one that fails", async () => {
    const replies: unknown[] = [{ claims: [{ c: 0, v: "partial", refs: [{ n: 1, s: [1] }], safe: "" }] }, { claims: [{ c: 0, v: "no", refs: [], safe: "" }] }, { claims: [] }, null, "x"];
    for (const reply of replies) {
      const r = await judgeAnswer({ answer, picked: picked(1, 2), strict: true, judge: async () => ({ json: first, model: "s" }), recheck: async () => ({ json: reply, model: "q" }) });
      expect(r!.text).toBe(text);
      expect(r!.rewritten).toBe(0);
    }
    const reports: JudgeReport[] = [];
    const r = await judgeAnswer({ answer, picked: picked(1, 2), strict: true, judge: async () => ({ json: first, model: "s" }), recheck: async () => { throw new Error("down"); }, onResult: (x) => reports.push(x) });
    expect(r!.text).toBe(text);
    expect(reports[0]!.rewrites).toEqual([{ c: 0, text: "The first thing happened in forty patients.", accepted: false }]);
  });

  it("a shorter claim for a claim that is judged yes or no is not used", async () => {
    const odd = { claims: [{ c: 0, v: "yes", refs: [{ n: 1, s: [1] }], safe: "The first thing happened." }, { c: 1, v: "no", refs: [], safe: "It was." }] };
    let calls = 0;
    const r = await judgeAnswer({ answer, picked: picked(1, 2), strict: true, judge: async () => (calls++, { json: odd, model: "m" }) });
    expect(calls).toBe(1);
    expect(r!.rewritten).toBe(0);
    expect(r!.leftOut).toBe(1);
  });

  it("a shorter claim keeps the full stop of its claim; one with brackets is refused (the server writes the marks)", async () => {
    const q = { claims: [{ c: 0, v: "partial", refs: [{ n: 1, s: [1] }], safe: "The first thing happened in forty patients" }, first.claims[1]] };
    const r = await judgeAnswer({ answer, picked: picked(1, 2), strict: true, judge: async () => ({ json: q, model: "s" }), recheck: async () => ({ json: again, model: "q" }) });
    expect(r!.text).toBe("The first thing happened in forty patients [1]. It was large [2].");
    const withMark = { claims: [{ ...q.claims[0], safe: "The first thing happened in forty patients [1]." }, first.claims[1]] };
    const r2 = await judgeAnswer({ answer, picked: picked(1, 2), strict: true, judge: async () => ({ json: withMark, model: "s" }), recheck: async () => ({ json: again, model: "q" }) });
    expect(r2!.text).toBe(text);
  });

  it("candidateRewrites reports why each shorter claim was refused", () => {
    const claims = splitClaims("A thing happened in forty patients and cured all [1]. Another thing happened [2].");
    const v = new Map<number, Judged>([
      [0, { verdict: "partial", refs: [{ n: 1, s: [1] }], safe: "A thing happened in forty patients." }],
      [1, { verdict: "partial", refs: [{ n: 2, s: [1] }], safe: "Another thing happened in Paris." }],
    ]);
    const out = candidateRewrites(claims, v, picked(1, 2));
    expect(out.ok.map((x) => x.text)).toEqual(["A thing happened in forty patients."]);
    expect(out.refused).toEqual([{ c: 1, text: "Another thing happened in Paris.", reason: "words" }]);
  });

  it("applyVerdicts uses a checked shorter claim with the papers and sentences found for it", () => {
    const claims = splitClaims("A thing happened and cured all [1][2].");
    const v = new Map<number, Judged>([[0, { verdict: "partial", refs: [{ n: 1, s: [1] }, { n: 2, s: [1] }] }]]);
    const r = applyVerdicts({ claims, verdicts: v, citations: [cite(1, 3)], picked: picked(1, 2), rewrites: new Map([[0, { text: "A thing happened.", refs: [{ n: 1, s: [2] }] }]]) });
    expect(r.text).toBe("A thing happened [1].");
    expect(r.rewritten).toBe(1);
    expect(r.citations.map((c) => [c.n, c.sentenceNo])).toEqual([[1, 2]]);
  });

  it("a shorter claim from a claim that cited nothing gets the papers of the second reading as its marks", () => {
    const claims = splitClaims("A thing happened and cured all.");
    const v = new Map<number, Judged>([[0, { verdict: "partial", refs: [{ n: 2, s: [1] }] }]]);
    const r = applyVerdicts({ claims, verdicts: v, citations: [cite(2, 1)], picked: picked(2), rewrites: new Map([[0, { text: "A thing happened.", refs: [{ n: 2, s: [1] }] }]]) });
    expect(r.text).toBe("A thing happened [2].");
  });

  it("readVerdicts keeps a shorter claim only for partial, trims it and caps its length", () => {
    const claims = splitClaims("A [1]. B [1]. C [1].");
    const reply = { claims: [
      { c: 0, v: "partial", refs: [{ n: 1, s: [1] }], safe: "  a   b \n c " },
      { c: 1, v: "yes", refs: [{ n: 1, s: [1] }], safe: "x" },
      { c: 2, v: "partial", refs: [{ n: 1, s: [1] }], safe: "y".repeat(5000) },
    ] };
    const m = readVerdicts(reply, claims, picked(1), new Set([1]));
    expect(m.get(0)!.safe).toBe("a b c");
    expect(m.get(1)!.safe).toBeUndefined();
    expect(m.get(2)!.safe!.length).toBe(600);
  });
});

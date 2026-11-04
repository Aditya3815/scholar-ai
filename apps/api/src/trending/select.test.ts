import { describe, expect, it } from "vitest";
import { isFresh, parseTrending, TRENDING_MAX_CHIPS } from "@scholar/shared";
import { SUBFIELDS } from "@scholar/shared/src/subfield-policy";
import { TREND, buildPayload, emptyPayload, phraseKey, selectShown, toChip, type Candidate } from "@scholar/shared/src/trending";

/**
 * Choosing the shown list from the ranked candidates (T3, T5, T8): at most 1 phrase per OpenAlex field and 2 per domain, only phrases that passed the verifier, and hysteresis (a shown
 * phrase leaves only when a candidate scores 1.25 times higher or it drops out of the top 30), so that the list does not flicker from one day to the next. Then the file the page reads.
 */

// real fields (id, domain id): Computer Science 17 and Engineering 22 and Chemistry 16 are Physical Sciences (3); Business 14, Economics 20 and Psychology 32 are Social Sciences (2);
// Agricultural and Biological 11 and Neuroscience 28 are Life Sciences (1)
const FIELDS = [[17, "Computer Science", 3, "Physical Sciences"], [22, "Engineering", 3, "Physical Sciences"], [16, "Chemistry", 3, "Physical Sciences"], [14, "Business, Management and Accounting", 2, "Social Sciences"], [20, "Economics, Econometrics and Finance", 2, "Social Sciences"], [32, "Psychology", 2, "Social Sciences"], [11, "Agricultural and Biological Sciences", 1, "Life Sciences"], [28, "Neuroscience", 1, "Life Sciences"]] as const;
const cand = (text: string, score: number, over: Partial<Candidate> = {}): Candidate => ({
  id: text, text, phrase: phraseKey(text), subfield: 1702, subfieldName: "Artificial Intelligence", field: "Computer Science", fieldId: 17, domain: "Physical Sciences", domainId: 3, policy: "allow",
  a: 100, b: 40, bEstimated: false, ratio: 1.1, score, total: 100, ...over,
});
const inField = (i: number, text: string, score: number, over: Partial<Candidate> = {}) => {
  const [fieldId, field, domainId, domain] = FIELDS[i]!;
  return cand(text, score, { fieldId, field, domainId, domain, ...over });
};
const texts = (xs: readonly Candidate[]) => xs.map((c) => c.text);

describe("selectShown: the diversity caps (1 per field, 2 per domain)", () => {
  it("takes the best by score, up to the size", () => {
    const ranked = [cand("one", 3), cand("two", 2.9, { fieldId: 22, field: "Engineering" }), cand("three", 2.8, { fieldId: 16, field: "Chemistry" })];
    expect(texts(selectShown(ranked, { size: 2, perField: 5, perDomain: 5 }))).toEqual(["one", "two"]);
    expect(texts(selectShown(ranked, { size: 10, perField: 5, perDomain: 5 }))).toEqual(["one", "two", "three"]);
  });

  it("defaults to the plan: 12 chips, 1 per field, 2 per domain", () => {
    expect(TREND.size).toBe(12);
    expect(TREND.diversity).toEqual({ perField: 1, perDomain: 2 });
    expect(TRENDING_MAX_CHIPS).toBe(TREND.size);
  });

  it("allows one phrase per field: the second computing phrase waits, however good", () => {
    const out = selectShown([cand("ai one", 3), cand("ai two", 2.9), inField(3, "business one", 2)], {});
    expect(texts(out)).toEqual(["ai one", "business one"]);
  });

  it("allows two per domain: the third Physical Sciences phrase waits, whichever fields they are in", () => {
    const out = selectShown([inField(0, "cs", 3), inField(1, "eng", 2.9), inField(2, "chem", 2.8), inField(3, "business", 1.5)], {});
    expect(texts(out)).toEqual(["cs", "eng", "business"]);
  });

  it("takes the next best phrase that fits when the best does not (the list is filled from below)", () => {
    const ranked = [cand("a1", 5), cand("a2", 4.9), cand("a3", 4.8), cand("a4", 4.7), inField(6, "life", 1.3)];
    expect(texts(selectShown(ranked, { size: 3 }))).toEqual(["a1", "life"]);
  });

  it("gives each phrase once, from the subfield where it scores best", () => {
    const out = selectShown([inField(0, "world model", 2), inField(1, "World Model", 3, { subfield: 2208 }), inField(3, "other thing", 1.5)], {});
    expect(out.map((c) => [c.text, c.score])).toEqual([["World Model", 3], ["other thing", 1.5]]);
  });

  it("with the plan's caps the list can hold at most 6 phrases, because Health is held: three domains times two", () => {
    const allowed = SUBFIELDS.filter((s) => s.policy === "allow");
    expect(new Set(allowed.map((s) => s.domain))).toEqual(new Set(["Physical Sciences", "Life Sciences", "Social Sciences"]));
    const ranked = allowed.map((s, i) => cand(`phrase ${i} here`, 5 - i * 0.01, { subfield: s.id, field: s.field, fieldId: s.fieldId, domain: s.domain, domainId: s.domainId }));
    expect(selectShown(ranked, {})).toHaveLength(6);
    // so that the 12 of the plan (T3) and the 8 it must not publish under (T4) are not reachable with 2 per domain: 4 per domain reaches them
    expect(selectShown(ranked, { perDomain: 4 })).toHaveLength(12);
    expect(selectShown(ranked, { perDomain: 3 })).toHaveLength(9);
    expect(selectShown(ranked, { perDomain: 4, size: 8 })).toHaveLength(8);
  });

  it("never puts two phrases of one field in a list, whatever the caps (one field is a field)", () => {
    const allowed = SUBFIELDS.filter((s) => s.policy === "allow");
    const ranked = allowed.map((s, i) => cand(`phrase ${i} here`, 5 - i * 0.01, { subfield: s.id, field: s.field, fieldId: s.fieldId, domain: s.domain, domainId: s.domainId }));
    const out = selectShown(ranked, { perDomain: 99, size: 99 });
    expect(new Set(out.map((c) => c.fieldId)).size).toBe(out.length);
  });
});

describe("selectShown: only what the verifier accepted, and only what is counted", () => {
  it("skips a phrase the verifier does not accept and takes the next one (T8: a failing phrase is replaced by the next candidate)", () => {
    const ranked = [inField(0, "retracted hit", 3), inField(1, "good one", 2), inField(3, "second good", 1.5)];
    expect(texts(selectShown(ranked, { size: 2, accept: (c) => c.text !== "retracted hit" }))).toEqual(["good one", "second good"]);
  });

  it("asks only as many as it needs, best first (each is a search)", () => {
    const asked: string[] = [];
    const ranked = Array.from({ length: 30 }, (_, i) => inField(i % FIELDS.length, `phrase ${i} here`, 3 - i * 0.01, { fieldId: 100 + i, domainId: 100 + i }));
    selectShown(ranked, { size: 5, accept: (c) => (asked.push(c.text), true) });
    expect(asked).toEqual(ranked.slice(0, 5).map((c) => c.text));
  });

  it("does not ask about a phrase that the caps already refuse", () => {
    const asked: string[] = [];
    selectShown([cand("first", 3), cand("same field", 2.9), inField(3, "other", 2)], { accept: (c) => (asked.push(c.text), true) });
    expect(asked).toEqual(["first", "other"]);
  });

  it("treats a verifier that throws as a no", () => {
    const out = selectShown([cand("boom", 3), inField(3, "fine", 2)], { accept: (c) => { if (c.text === "boom") throw new Error("search failed"); return true; } });
    expect(texts(out)).toEqual(["fine"]);
  });

  it("does not show a phrase whose last year's count was only estimated: the page would show a count nobody counted", () => {
    const out = selectShown([cand("estimated", 3, { bEstimated: true }), inField(3, "counted", 2)], {});
    expect(texts(out)).toEqual(["counted"]);
  });

  it("returns nothing for nothing and for garbage", () => {
    expect(selectShown([], {})).toEqual([]);
    expect(selectShown([null, undefined, 5, {}] as unknown as Candidate[], {})).toEqual([]);
    expect(selectShown([cand("x", 3)], { size: 0 })).toEqual([]);
    expect(selectShown([cand("x", 3)], { size: -1 })).toEqual([]);
    expect(selectShown([cand("x", NaN)], {})).toEqual([]);
  });

  it("skips a candidate that throws when it is read", () => {
    const boom = new Proxy({}, { get() { throw new Error("unreadable"); } }) as unknown as Candidate;
    expect(texts(selectShown([boom, cand("fine", 2)], {}))).toEqual(["fine"]);
  });

  it("breaks ties by phrase, so the same input always gives the same list; and does not change its input", () => {
    const ranked = [inField(3, "bbb", 2), inField(0, "aaa", 2), inField(6, "ccc", 2)];
    const before = JSON.stringify(ranked);
    const first = texts(selectShown(ranked, {}));
    expect(first).toEqual(["aaa", "bbb", "ccc"]);
    expect(texts(selectShown([...ranked].reverse(), {}))).toEqual(first);
    expect(JSON.stringify(ranked)).toBe(before);
  });
});

describe("selectShown: hysteresis (a shown phrase leaves only for a candidate 1.25 times better, or when it drops out of the top 30)", () => {
  it("keeps a shown phrase against a challenger that is 1.24 times better", () => {
    const ranked = [cand("challenger", 2.48), cand("incumbent", 2)];
    expect(texts(selectShown(ranked, { size: 1, previous: ["incumbent"] }))).toEqual(["incumbent"]);
  });

  it("gives the slot up to a challenger that is 1.25 times better (exactly), and to any that is better still", () => {
    expect(texts(selectShown([cand("challenger", 2.5), cand("incumbent", 2)], { size: 1, previous: ["incumbent"] }))).toEqual(["challenger"]);
    expect(texts(selectShown([cand("challenger", 4), cand("incumbent", 2)], { size: 1, previous: ["incumbent"] }))).toEqual(["challenger"]);
  });

  it("without a previous list the best simply wins", () => {
    expect(texts(selectShown([cand("challenger", 2.2), cand("incumbent", 2)], { size: 1 }))).toEqual(["challenger"]);
    expect(texts(selectShown([cand("challenger", 2.2), cand("incumbent", 2)], { size: 1, previous: [] }))).toEqual(["challenger"]);
  });

  it("does not score the list again: a kept phrase keeps its own score, not the bonus", () => {
    const [kept] = selectShown([cand("incumbent", 2)], { previous: ["incumbent"] });
    expect(kept!.score).toBe(2);
  });

  it("a phrase that falls out of the top 30 leaves, however much room there is: its place is the 30th, not the 31st", () => {
    // 40 phrases within 4% of each other: a bonus of 25% beats all of them, so only the rule of the top 30 decides
    const ranked = Array.from({ length: 40 }, (_, i) => cand(`p${String(i).padStart(2, "0")} phrase`, 2 - i * 0.001, { fieldId: 100 + i, domainId: 100 + i }));
    const at29 = "p29 phrase";
    const at30 = "p30 phrase";
    const kept = texts(selectShown(ranked, { size: 12, previous: [at29, at30] }));
    expect(kept).toContain(at29); // 30th best: still inside
    expect(kept).not.toContain(at30); // 31st best: out
    expect(kept).toHaveLength(12);
    expect(texts(selectShown(ranked, { size: 12 }))).not.toContain(at29); // and without the bonus it would not have been there
  });

  it("a phrase that no longer is a candidate at all is gone (nothing is kept that was not found again)", () => {
    expect(texts(selectShown([cand("new one", 2)], { size: 2, previous: ["old one that was dropped"] }))).toEqual(["new one"]);
  });

  it("a shown phrase that no longer passes the verifier leaves, hysteresis or not (a retraction appeared)", () => {
    const ranked = [cand("incumbent", 2), inField(3, "next", 1.5)];
    expect(texts(selectShown(ranked, { size: 1, previous: ["incumbent"], accept: (c) => c.text !== "incumbent" }))).toEqual(["next"]);
  });

  it("matches a shown phrase however it was written last time (case, hyphens)", () => {
    expect(texts(selectShown([cand("Retrieval-Augmented Generation", 2), cand("challenger", 2.4, { fieldId: 22, field: "Engineering" })], { size: 1, previous: ["retrieval augmented generation"] }))).toEqual(["Retrieval-Augmented Generation"]);
  });

  it("ignores what is not a phrase in the previous list", () => {
    expect(() => selectShown([cand("x", 2)], { previous: [null, 5, undefined, {}, ""] as unknown as string[] })).not.toThrow();
    expect(texts(selectShown([cand("x", 2)], { previous: [null, 5, undefined, {}, ""] as unknown as string[] }))).toEqual(["x"]);
  });

  it("works together with the caps: a shown phrase and a challenger of the same field cannot both stay, and the 1.25 rule picks one", () => {
    expect(texts(selectShown([cand("challenger", 2.4), cand("incumbent", 2)], { previous: ["incumbent"] }))).toEqual(["incumbent"]);
    expect(texts(selectShown([cand("challenger", 2.6), cand("incumbent", 2)], { previous: ["incumbent"] }))).toEqual(["challenger"]);
  });

  it("holds a list steady over weeks of noisy scores (target: Jaccard of one week with the last at least 0.7; the live probe without it was 0.43 to 0.82)", () => {
    // 40 phrases in 12 weeks; each week's score is the phrase's own level times noise of up to 10 percent, from a fixed generator
    let seed = 20261103;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    const level = Array.from({ length: 40 }, (_, i) => 3 - i * 0.03);
    const week = () => level.map((l, i) => inField(i % 8, `topic ${i} words`, l * (0.9 + rnd() * 0.2), { fieldId: 200 + i, domainId: 300 + i, a: 100 + i }));
    const jaccard = (x: string[], y: string[]) => x.filter((t) => y.includes(t)).length / new Set([...x, ...y]).size;
    const weeks = Array.from({ length: 12 }, week);
    const run = (useHysteresis: boolean) => {
      let previous: string[] = [];
      const shown: string[][] = [];
      for (const w of weeks) {
        const s = texts(selectShown(w, { size: 12, perField: 1, perDomain: 99, previous: useHysteresis ? previous : [] }));
        shown.push(s);
        previous = s;
      }
      return shown.slice(1).map((s, i) => jaccard(s, shown[i]!));
    };
    const withH = run(true);
    const without = run(false);
    expect(Math.min(...withH)).toBeGreaterThanOrEqual(0.7);
    expect(withH.reduce((a, b) => a + b, 0)).toBeGreaterThan(without.reduce((a, b) => a + b, 0));
    expect(Math.min(...without)).toBeLessThan(0.9); // the noise is large enough to matter
  });
});

describe("toChip: a candidate as the page shows it", () => {
  it("is the keyword's own text, the search year (the year before today's), the two counts and the field", () => {
    expect(toChip(inField(0, "retrieval-augmented generation", 2, { a: 452, b: 176 }), "2026-11-03")).toEqual({ text: "retrieval-augmented generation", sinceYear: 2025, a: 452, b: 176, field: "Computer Science" });
    expect(toChip(cand("world model", 2), "2027-01-01")!.sinceYear).toBe(2026);
  });

  it("is null for a count that was estimated, for text the checks refuse, for no field, and for a bad day", () => {
    expect(toChip(cand("world model", 2, { bEstimated: true }), "2026-11-03")).toBeNull();
    expect(toChip(cand("https://example.org", 2), "2026-11-03")).toBeNull();
    expect(toChip(cand("research", 2), "2026-11-03")).toBeNull();
    expect(toChip(cand("world model", 2, { field: "" }), "2026-11-03")).toBeNull();
    for (const bad of ["", "soon", "2026-02-31", "2026-11-3"]) expect(toChip(cand("world model", 2), bad)).toBeNull();
    expect(toChip(null as never, "2026-11-03")).toBeNull();
  });
});

describe("buildPayload: the file the page reads", () => {
  const now = new Date("2026-11-03T03:17:05.123Z");
  const many = (n: number, prefix = "phrase") => Array.from({ length: n }, (_, i) => cand(`${prefix} number ${i}`, 3 - i * 0.01, { a: 200 + i, b: 50 + i }));

  it("is accepted by the page's own reader, and says what it is", () => {
    const p = buildPayload({ now, poolAsOf: "2026-11-02", global: many(10), india: many(3, "indian") });
    expect(parseTrending(p)).toEqual(p);
    expect(p).toMatchObject({ version: 1, asOf: "2026-11-03", generatedAt: "2026-11-03T03:17:05.123Z", validUntil: "2026-11-05T03:17:05.123Z", poolAsOf: "2026-11-02", disabled: false });
    expect(p.groups.global.chips).toHaveLength(10);
    expect(p.groups.in.chips).toHaveLength(3);
    expect(p.groups.global.chips[0]).toEqual({ text: "phrase number 0", sinceYear: 2025, a: 200, b: 50, field: "Computer Science" });
  });

  it("is valid for 48 hours and fresh by the page's rule", () => {
    const p = buildPayload({ now, poolAsOf: "2026-11-02", global: many(8) });
    expect(Date.parse(p.validUntil) - Date.parse(p.generatedAt)).toBe(TREND.validHours * 3_600_000);
    expect(TREND.validHours).toBe(48);
    expect(isFresh(p, now)).toBe(true);
    expect(isFresh(p, Date.parse(p.validUntil))).toBe(false);
  });

  it("refuses to publish fewer than 8 phrases (T4: the last good file stays)", () => {
    expect(TREND.minPublish).toBe(8);
    expect(() => buildPayload({ now, poolAsOf: "2026-11-02", global: many(7) })).toThrow(/8/);
    expect(() => buildPayload({ now, poolAsOf: "2026-11-02", global: [] })).toThrow();
    expect(() => buildPayload({ now, poolAsOf: "2026-11-02", global: many(8) })).not.toThrow();
  });

  it("counts only the phrases that can be shown: estimated counts and refused text do not make up the 8", () => {
    const six = many(6);
    const bad = [cand("https://example.org", 1), cand("hello", 1), cand("estimated phrase", 1, { bEstimated: true })];
    expect(() => buildPayload({ now, poolAsOf: "2026-11-02", global: [...six, ...bad] })).toThrow();
  });

  it("does not need an India list: a small one, or none, is fine", () => {
    expect(buildPayload({ now, poolAsOf: "2026-11-02", global: many(8) }).groups.in.chips).toEqual([]);
    expect(buildPayload({ now, poolAsOf: "2026-11-02", global: many(8), india: many(2) }).groups.in.chips).toHaveLength(2);
  });

  it("holds each group to the top 12, and drops a phrase that is there twice", () => {
    const p = buildPayload({ now, poolAsOf: "2026-11-02", global: [...many(15), cand("PHRASE NUMBER 0", 1)] });
    expect(p.groups.global.chips).toHaveLength(12);
    expect(p.groups.global.chips.filter((c) => c.text.toLowerCase() === "phrase number 0")).toHaveLength(1);
  });

  it("throws on a clock or a pool date that is not a date", () => {
    expect(() => buildPayload({ now: new Date("nope"), poolAsOf: "2026-11-02", global: many(8) })).toThrow();
    expect(() => buildPayload({ now, poolAsOf: "yesterday", global: many(8) })).toThrow();
  });

  it("throws when the page would refuse what was built, so that a file nobody can read is never published (a clock stuck in 1999 gives a search year the page does not take)", () => {
    expect(() => buildPayload({ now: new Date("1999-05-01T00:00:00Z"), poolAsOf: "1999-04-30", global: many(8) })).toThrow(/page would not accept/);
  });

  it("takes the day from UTC: just before and just after midnight", () => {
    expect(buildPayload({ now: new Date("2026-11-03T23:59:59.999Z"), poolAsOf: "2026-11-02", global: many(8) }).asOf).toBe("2026-11-03");
    expect(buildPayload({ now: new Date("2026-11-04T00:00:00.000Z"), poolAsOf: "2026-11-02", global: many(8) }).asOf).toBe("2026-11-04");
  });
});

describe("emptyPayload: what the server answers when it has nothing, or is switched off", () => {
  const now = new Date("2026-11-03T03:17:05.000Z");

  it("is a payload the page accepts, with no chips, that it never shows as trending", () => {
    for (const disabled of [false, true]) {
      const p = emptyPayload(now, disabled);
      expect(parseTrending(p)).toEqual(p);
      expect(p.disabled).toBe(disabled);
      expect(p.groups.global.chips).toEqual([]);
      expect(p.groups.in.chips).toEqual([]);
      expect(isFresh(p, now)).toBe(false);
    }
  });

  it("is not disabled unless it is asked to be", () => {
    expect(emptyPayload(now).disabled).toBe(false);
  });
});

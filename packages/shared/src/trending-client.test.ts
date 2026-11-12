import { describe, expect, it } from "vitest";
import { TRENDING_MAX_CHIPS, isFresh, parseTrending, pickChips, type TrendingChip, type TrendingPayload } from "@scholar/shared";

/**
 * The half of the Trending feed that the browser runs (packages/shared/src/trending-client.ts): the payload contract, the strict reader of what the server sent, the freshness
 * rule (a stale list is never shown as trending) and the pick of today's chips. docs/design/chatview-and-trending.md, T3, T4, T7, T12.
 */

const DAY = 86_400_000;
const chip = (text: string, over: Partial<TrendingChip> = {}): TrendingChip => ({ text, sinceYear: 2025, a: 452, b: 176, field: "Computer Science", ...over });
const NAMES = ["retrieval-augmented generation", "AI governance", "hallucination mitigation", "generative AI", "world model", "vision-language-action", "diffusion language model", "AI literacy", "explainable AI", "agentic AI", "small language models", "quantum error correction"];
const chips = (n = 12): TrendingChip[] => NAMES.slice(0, n).map((t) => chip(t));
const payload = (over: Partial<TrendingPayload> = {}): TrendingPayload => ({
  version: 1,
  asOf: "2026-11-03",
  generatedAt: "2026-11-03T03:17:05.000Z",
  validUntil: "2026-11-05T03:17:05.000Z",
  poolAsOf: "2026-11-02",
  disabled: false,
  groups: { global: { chips: chips() }, in: { chips: [chip("explainable machine learning", { a: 90, b: 20 })] } },
  ...over,
});
const at = (iso: string) => Date.parse(iso);

describe("parseTrending: the browser reads what the server sent, strictly", () => {
  it("accepts a good payload and hands back the same content", () => {
    const p = payload();
    expect(parseTrending(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it("accepts an empty feed and a disabled one (the server's answers when it has nothing)", () => {
    expect(parseTrending(payload({ groups: { global: { chips: [] }, in: { chips: [] } } }))).not.toBeNull();
    expect(parseTrending(payload({ disabled: true, groups: { global: { chips: [] }, in: { chips: [] } } }))?.disabled).toBe(true);
  });

  it("returns null, and never throws, for anything that is not a payload", () => {
    for (const bad of [undefined, null, 0, 1, "", "{}", true, [], [payload()], {}, () => payload(), Symbol("x"), 10n]) expect(parseTrending(bad as unknown)).toBeNull();
  });

  it("returns null for another version, or none", () => {
    expect(parseTrending({ ...payload(), version: 2 })).toBeNull();
    expect(parseTrending({ ...payload(), version: "1" })).toBeNull();
    const { version: _v, ...none } = payload();
    expect(parseTrending(none)).toBeNull();
  });

  it("returns null for a date that is not a real date, or not written the way the server writes it", () => {
    for (const asOf of ["2026-02-31", "2026-13-01", "03/11/2026", "2026-11-3", "2026-11-03T00:00:00Z", "", 20261103, null]) expect(parseTrending({ ...payload(), asOf })).toBeNull();
    for (const poolAsOf of ["2026-02-30", "yesterday", undefined]) expect(parseTrending({ ...payload(), poolAsOf })).toBeNull();
    for (const generatedAt of ["2026-11-03", "2026-11-03T03:17:05", "2026-11-03T25:00:00.000Z", "2026-02-31T00:00:00.000Z", "2026-11-03T24:00:00.000Z", 1762139825000]) expect(parseTrending({ ...payload(), generatedAt })).toBeNull();
    for (const validUntil of ["tomorrow", "2026-11-05", "", null]) expect(parseTrending({ ...payload(), validUntil })).toBeNull();
    expect(parseTrending({ ...payload(), generatedAt: "2026-11-03T03:17:05Z" })).not.toBeNull();
  });

  it("returns null when `disabled` is not a boolean", () => {
    for (const disabled of [0, 1, "false", "true", null, undefined]) expect(parseTrending({ ...payload(), disabled })).toBeNull();
  });

  it("returns null when the groups are missing or are not lists of chips", () => {
    expect(parseTrending({ ...payload(), groups: undefined })).toBeNull();
    expect(parseTrending({ ...payload(), groups: null })).toBeNull();
    expect(parseTrending({ ...payload(), groups: [] })).toBeNull();
    expect(parseTrending({ ...payload(), groups: { global: { chips: chips() } } })).toBeNull();
    expect(parseTrending({ ...payload(), groups: { global: { chips: chips() }, in: {} } })).toBeNull();
    expect(parseTrending({ ...payload(), groups: { global: { chips: chips() }, in: { chips: "none" } } })).toBeNull();
    expect(parseTrending({ ...payload(), groups: { global: chips(), in: chips() } })).toBeNull();
  });

  it("holds one chip bad against the whole payload: nothing half-trusted is shown", () => {
    const bad = [...chips(3), null as unknown as TrendingChip];
    expect(parseTrending({ ...payload(), groups: { global: { chips: bad }, in: { chips: [] } } })).toBeNull();
    expect(parseTrending({ ...payload(), groups: { global: { chips: [...chips(3), { text: "ok phrase" } as TrendingChip] }, in: { chips: [] } } })).toBeNull();
    const sparse = chips(3);
    sparse[5] = chip("far away chip");
    expect(parseTrending({ ...payload(), groups: { global: { chips: sparse }, in: { chips: [] } } })).toBeNull();
  });

  it("limits a group to the top 12", () => {
    const many = [...chips(12), chip("a thirteenth phrase")];
    expect(TRENDING_MAX_CHIPS).toBe(12);
    expect(parseTrending({ ...payload(), groups: { global: { chips: chips(12) }, in: { chips: [] } } })).not.toBeNull();
    expect(parseTrending({ ...payload(), groups: { global: { chips: many }, in: { chips: [] } } })).toBeNull();
  });

  describe("a chip's text is what goes into the box", () => {
    const withText = (text: unknown) => parseTrending({ ...payload(), groups: { global: { chips: [{ ...chip("x"), text }] }, in: { chips: [] } } });
    it("takes 3 to 36 characters", () => {
      expect(withText("a".repeat(36))).not.toBeNull();
      expect(withText("a".repeat(37))).toBeNull();
      expect(withText("abc")).not.toBeNull();
      expect(withText("ab")).toBeNull();
      expect(withText("")).toBeNull();
    });
    it("takes only text", () => {
      for (const bad of [undefined, null, 5, {}, ["abc"], true]) expect(withText(bad)).toBeNull();
    });
    it("refuses text that is not already tidy: the box would not show what was checked", () => {
      for (const bad of [" leading", "trailing ", "two  spaces", "tab\tinside", "new\nline", "nul\u0000byte", "del\u007fbyte", `no-break${String.fromCodePoint(0xa0)}space`]) expect(withText(bad)).toBeNull();
    });
    it("refuses invisible characters (zero-width and direction marks)", () => {
      for (const cp of [0x200b, 0x200c, 0x200d, 0x200e, 0x202e, 0x2060, 0xfeff, 0x061c, 0xe0041]) expect(withText(`ab${String.fromCodePoint(cp)}cd`)).toBeNull();
    });
    it("keeps ordinary punctuation and letters from other scripts", () => {
      for (const ok of ["COVID-19 vaccines", "C++ templates", "retrieval-augmented generation", "k-means clustering", "मशीन लर्निंग"]) expect(withText(ok)).not.toBeNull();
    });
    it("refuses the same phrase twice in a group, however it is written", () => {
      const dup = [chip("world model"), chip("World Model")];
      expect(parseTrending({ ...payload(), groups: { global: { chips: dup }, in: { chips: [] } } })).toBeNull();
      expect(parseTrending({ ...payload(), groups: { global: { chips: [chip("world model")] }, in: { chips: [chip("world model")] } } })).not.toBeNull();
    });
  });

  describe("a chip's numbers", () => {
    const withChip = (over: Record<string, unknown>) => parseTrending({ ...payload(), groups: { global: { chips: [{ ...chip("world model"), ...over }] }, in: { chips: [] } } });
    it("are whole numbers, never negative", () => {
      expect(withChip({ a: 0, b: 0 })).not.toBeNull();
      for (const bad of [-1, 1.5, NaN, Infinity, -Infinity, "5", null, undefined, 1e10]) {
        expect(withChip({ a: bad })).toBeNull();
        expect(withChip({ b: bad })).toBeNull();
      }
    });
    it("give a sinceYear that is a plausible year", () => {
      expect(withChip({ sinceYear: 2025 })).not.toBeNull();
      for (const bad of [1999, 2101, 2025.5, "2025", NaN, null, undefined]) expect(withChip({ sinceYear: bad })).toBeNull();
    });
    it("name a field of 1 to 60 tidy characters", () => {
      expect(withChip({ field: "Computer Science" })).not.toBeNull();
      for (const bad of ["", "x".repeat(61), 5, null, undefined, "bad\nfield"]) expect(withChip({ field: bad })).toBeNull();
    });
  });

  it("drops what it does not know: a field the contract does not name never reaches the page", () => {
    const out = parseTrending({ ...payload(), extra: "<script>", groups: { global: { chips: [{ ...chip("world model"), html: "<b>x</b>", __proto__: { evil: 1 } }] }, in: { chips: [], note: "x" } } });
    expect(out).not.toBeNull();
    expect(Object.keys(out as object).sort()).toEqual(["asOf", "disabled", "generatedAt", "groups", "poolAsOf", "validUntil", "version"]);
    expect(Object.keys(out!.groups.global.chips[0]!).sort()).toEqual(["a", "b", "field", "sinceYear", "text"]);
    expect(Object.keys(out!.groups.in)).toEqual(["chips"]);
  });

  it("does not hand back the object it was given", () => {
    const p = JSON.parse(JSON.stringify(payload()));
    const out = parseTrending(p)!;
    expect(out).not.toBe(p);
    expect(out.groups.global.chips).not.toBe(p.groups.global.chips);
    p.groups.global.chips[0].text = "changed afterwards";
    expect(out.groups.global.chips[0]!.text).toBe(NAMES[0]);
  });

  it("does not throw on hostile objects: a getter that throws, a Proxy, a null prototype, a cycle", () => {
    const getter = { ...payload() } as Record<string, unknown>;
    Object.defineProperty(getter, "groups", { get() { throw new Error("boom"); }, enumerable: true });
    expect(parseTrending(getter)).toBeNull();
    expect(parseTrending(new Proxy({}, { get() { throw new Error("proxy"); }, has() { throw new Error("proxy"); } }))).toBeNull();
    expect(parseTrending(Object.assign(Object.create(null), payload()))).not.toBeNull();
    const cyc: Record<string, unknown> = { ...payload() };
    cyc.self = cyc;
    expect(parseTrending(cyc)).not.toBeNull(); // an unknown field is dropped, not followed
    const arr = chips(3) as unknown[];
    arr.push(arr);
    expect(parseTrending({ ...payload(), groups: { global: { chips: arr }, in: { chips: [] } } })).toBeNull();
  });
});

describe("isFresh: a stale list is never shown as trending", () => {
  const p = payload();
  const until = at("2026-11-05T03:17:05.000Z");

  it("is fresh before validUntil with a pool of today or yesterday", () => {
    expect(isFresh(p, at("2026-11-03T04:00:00Z"))).toBe(true);
    expect(isFresh(p, until - 1)).toBe(true);
  });

  it("is stale at validUntil and after it", () => {
    expect(isFresh(p, until)).toBe(false);
    expect(isFresh(p, until + 1)).toBe(false);
    expect(isFresh(p, until + 30 * DAY)).toBe(false);
  });

  it("is stale when the weekly pool is more than 14 days old, even though the daily file is new", () => {
    const old = payload({ poolAsOf: "2026-10-20", validUntil: "2026-11-05T03:17:05.000Z" });
    const pool = at("2026-10-20T00:00:00Z");
    expect(isFresh(old, pool + 14 * DAY)).toBe(true); // exactly 14 days
    expect(isFresh({ ...old, validUntil: "2026-12-31T00:00:00.000Z" }, pool + 14 * DAY + 1)).toBe(false);
    expect(isFresh({ ...old, validUntil: "2026-12-31T00:00:00.000Z" }, pool + 15 * DAY)).toBe(false);
  });

  it("is stale when the feed is switched off", () => {
    expect(isFresh({ ...p, disabled: true }, at("2026-11-03T04:00:00Z"))).toBe(false);
  });

  it("is about time only: a fresh feed with no chips is fresh (the page shows no row because there is nothing to show)", () => {
    expect(isFresh(payload({ groups: { global: { chips: [] }, in: { chips: [] } } }), at("2026-11-03T04:00:00Z"))).toBe(true);
  });

  it("takes the time as a number or a Date", () => {
    expect(isFresh(p, new Date("2026-11-03T04:00:00Z"))).toBe(true);
    expect(isFresh(p, new Date(until))).toBe(false);
  });

  it("is false, and does not throw, for a clock or a payload that is broken", () => {
    expect(isFresh(p, NaN)).toBe(false);
    expect(isFresh(p, new Date("nope"))).toBe(false);
    expect(isFresh(p, Infinity)).toBe(false);
    expect(isFresh({ ...p, validUntil: "garbage" }, at("2026-11-03T04:00:00Z"))).toBe(false);
    expect(isFresh({ ...p, poolAsOf: "garbage" }, at("2026-11-03T04:00:00Z"))).toBe(false);
    expect(isFresh({ ...p, disabled: undefined } as unknown as TrendingPayload, at("2026-11-03T04:00:00Z"))).toBe(false);
    expect(isFresh(null as unknown as TrendingPayload, 0)).toBe(false);
    expect(isFresh(undefined as unknown as TrendingPayload, 0)).toBe(false);
  });
});

describe("pickChips: today's chips, from the top 12, the same for everyone all day", () => {
  const all = chips(12);
  const texts = (xs: readonly TrendingChip[]) => xs.map((c) => c.text);
  const dayAfter = (iso: string, k: number) => new Date(Date.parse(iso) + k * DAY).toISOString().slice(0, 10);

  it("gives the same chips for the same date, however many times it is asked (50 renders)", () => {
    const first = texts(pickChips(all, "2026-11-03", 4));
    for (let i = 0; i < 50; i++) expect(texts(pickChips(all, "2026-11-03", 4))).toEqual(first);
    expect(first).toHaveLength(4);
  });

  it("does not depend on a clock or on randomness: a copy of the list gives the same pick", () => {
    expect(texts(pickChips(all.map((c) => ({ ...c })), "2026-11-03", 4))).toEqual(texts(pickChips(all, "2026-11-03", 4)));
  });

  it("changes on the next day: no two neighbouring days of a whole year show the same chips", () => {
    for (let k = 0; k < 400; k++) {
      const today = new Set(texts(pickChips(all, dayAfter("2026-01-01", k), 4)));
      const tomorrow = new Set(texts(pickChips(all, dayAfter("2026-01-01", k + 1), 4)));
      expect([...today].some((t) => !tomorrow.has(t))).toBe(true);
    }
  });

  it("changes on the next day for other row sizes too", () => {
    for (const n of [1, 2, 3, 5, 6, 7, 11]) {
      for (let k = 0; k < 40; k++) {
        const today = texts(pickChips(all, dayAfter("2026-03-01", k), n)).slice().sort().join("|");
        const tomorrow = texts(pickChips(all, dayAfter("2026-03-01", k + 1), n)).slice().sort().join("|");
        expect(today).not.toBe(tomorrow);
      }
    }
  });

  it("shows each of the 12 equally often: three days of four chips cover the pool exactly once", () => {
    const seen = [0, 1, 2].flatMap((k) => texts(pickChips(all, dayAfter("2026-11-03", k), 4)));
    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
    const counts = new Map<string, number>();
    for (let k = 0; k < 120; k++) for (const t of texts(pickChips(all, dayAfter("2026-01-01", k), 5))) counts.set(t, (counts.get(t) ?? 0) + 1);
    expect(counts.size).toBe(12);
    expect(Math.max(...counts.values()) - Math.min(...counts.values())).toBeLessThanOrEqual(5);
  });

  it("never repeats a chip within one pick", () => {
    for (let k = 0; k < 60; k++) {
      const t = texts(pickChips(all, dayAfter("2026-01-01", k), 5));
      expect(new Set(t).size).toBe(5);
    }
  });

  it("picks only from the top 12: a chip after the twelfth is never shown", () => {
    const long = [...all, chip("a thirteenth phrase"), chip("a fourteenth phrase")];
    for (let k = 0; k < 60; k++) expect(texts(pickChips(long, dayAfter("2026-01-01", k), 4))).not.toContain("a thirteenth phrase");
  });

  it("does not change the list it was given", () => {
    const before = JSON.stringify(all);
    pickChips(all, "2026-11-03", 4);
    expect(JSON.stringify(all)).toBe(before);
  });

  it("returns every chip, in rank order, when there are no more than asked for", () => {
    expect(texts(pickChips(chips(3), "2026-11-03", 4))).toEqual(NAMES.slice(0, 3));
    expect(texts(pickChips(chips(4), "2026-11-03", 4))).toEqual(NAMES.slice(0, 4));
    expect(texts(pickChips(all, "2026-11-03", 12))).toEqual(NAMES);
    expect(texts(pickChips(all, "2026-11-03", 99))).toEqual(NAMES);
  });

  it("returns nothing for nothing, for 0, for a negative or a broken count", () => {
    expect(pickChips([], "2026-11-03", 4)).toEqual([]);
    for (const n of [0, -1, -Infinity, NaN]) expect(pickChips(all, "2026-11-03", n)).toEqual([]);
    expect(texts(pickChips(all, "2026-11-03", 4.9))).toHaveLength(4);
    expect(pickChips(all, "2026-11-03", Infinity)).toHaveLength(12);
  });

  it("does not throw on a date that is not a date: it shows the top chips by rank", () => {
    for (const bad of ["", "soon", "2026-99-99", undefined as unknown as string, null as unknown as string]) expect(texts(pickChips(all, bad, 4))).toEqual(NAMES.slice(0, 4));
  });

  it("copes with a date before 1970 and a date far ahead", () => {
    expect(pickChips(all, "1969-06-01", 4)).toHaveLength(4);
    expect(pickChips(all, "2999-12-31", 4)).toHaveLength(4);
    for (const c of pickChips(all, "1960-01-01", 4)) expect(c).toBeDefined();
  });

  it("returns the chips themselves, so the page keeps the counts and the field", () => {
    const one = pickChips(all, "2026-11-03", 4)[0]!;
    expect(all).toContain(one);
  });
});

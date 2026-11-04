import { describe, expect, it } from "vitest";
import { TRENDING_MAX_CHIPS, isFresh, parseTrending, type TrendingChip, type TrendingPayload } from "@scholar/shared";
import { trendWindows } from "@scholar/shared/src/trending";
import { DEVICE_COPY_MAX_AGE_MS, NO_DRAFT, TRENDING_ROW_MIN, TRENDING_ROW_SIZE, chipCounts, chipFacts, countWindows, dateWords, decideFetched, deviceCopyOf, fillChip, putBack, readDeviceCopy, reconcileDraft, rowFacts, rowWindows, trendingRow, windowWords, type Draft } from "@scholar/shared/src/trending-row";

/**
 * What the Home page does with the Trending file once it has it (docs/design/chatview-and-trending.md, T1, T4, T9, T10, T12): which chips are shown and in what order, the facts behind each chip, when a copy
 * kept on the device may be used, what to do with an answer from the server, and what filling the box does to a draft the person has typed. All of it is pure, so it is tested here and not only in a browser;
 * the page (apps/web/src/workspace/HomePage.tsx, TrendingRow.tsx) only draws it, and the browser suite (apps/web/e2e/trending.mjs) checks that it does.
 */

const NOW = Date.parse("2026-11-04T09:30:00Z");
const NAMES = ["retrieval-augmented generation", "AI governance", "hallucination mitigation", "generative AI", "world model", "vision-language-action", "diffusion language model", "AI literacy", "explainable AI", "agentic AI", "small language models", "quantum error correction"];
const INDIA = ["explainable machine learning", "crop yield prediction", "UPI digital payments", "heritage digitisation", "rural telemedicine"];
const chip = (text: string, over: Partial<TrendingChip> = {}): TrendingChip => ({ text, sinceYear: 2025, a: 452, b: 176, field: "Computer Science", ...over });
const payload = (over: Partial<TrendingPayload> = {}): TrendingPayload => ({
  version: 1,
  asOf: "2026-11-04",
  generatedAt: "2026-11-04T03:17:05.000Z",
  validUntil: "2026-11-06T03:17:05.000Z",
  poolAsOf: "2026-11-02",
  disabled: false,
  groups: { global: { chips: NAMES.map((t) => chip(t)) }, in: { chips: INDIA.map((t) => chip(t, { a: 90, b: 20, field: "Engineering" })) } },
  ...over,
});
const withGroups = (global: string[], inn: string[], over: Partial<TrendingPayload> = {}) => payload({ groups: { global: { chips: global.map((t) => chip(t)) }, in: { chips: inn.map((t) => chip(t)) } }, ...over });

describe("trendingRow: which chips the row shows", () => {
  it("is nothing when there is no list, or the list is not fresh: a stale or missing feed is never shown as trending", () => {
    expect(trendingRow(null, NOW, false)).toBeNull();
    expect(trendingRow(payload({ validUntil: "2026-11-04T09:29:59.000Z" }), NOW, false)).toBeNull();
    expect(trendingRow(payload({ validUntil: "2026-11-04T09:30:00.000Z" }), NOW, false)).toBeNull(); // valid until, exclusive
    expect(trendingRow(payload({ disabled: true }), NOW, false)).toBeNull();
    expect(trendingRow(payload({ poolAsOf: "2026-10-20" }), NOW, false)).toBeNull(); // a pool 15 days old
    expect(trendingRow(payload({ groups: { global: { chips: [] }, in: { chips: [] } } }), NOW, false)).toBeNull(); // fresh, and nothing in it
    expect(trendingRow(payload(), Number.NaN, false)).toBeNull();
    expect(trendingRow(payload(), NOW, false)).not.toBeNull();
  });

  it("shows four chips of the global list, and the same four all day for everyone", () => {
    const a = trendingRow(payload(), NOW, false)!;
    expect(a.chips).toHaveLength(TRENDING_ROW_SIZE);
    expect(TRENDING_ROW_SIZE).toBe(4);
    expect(a.chips.every((c) => c.group === "global" && NAMES.includes(c.text))).toBe(true);
    expect(trendingRow(payload(), NOW + 3 * 3_600_000, false)!.chips).toEqual(a.chips); // the pick is by the file's own date, not by the clock
    for (let i = 0; i < 50; i++) expect(trendingRow(payload(), NOW, false)!.chips).toEqual(a.chips); // not by chance
    const next = trendingRow(payload({ asOf: "2026-11-05" }), NOW, false)!;
    expect(next.chips.map((c) => c.text)).not.toEqual(a.chips.map((c) => c.text)); // another day, other chips
  });

  it("with the Indian sources on, the Indian list comes first and the global list fills the rest", () => {
    const r = trendingRow(payload(), NOW, true)!;
    expect(r.chips).toHaveLength(4);
    expect(r.chips.map((c) => c.group)).toEqual(["in", "in", "in", "in"]); // the Indian list has five: four of them are shown, and none of the global list
    expect(r.chips.every((c) => INDIA.includes(c.text))).toBe(true);
    const two = trendingRow(withGroups(NAMES, INDIA.slice(0, 2)), NOW, true)!;
    expect(two.chips.map((c) => c.group)).toEqual(["in", "in", "global", "global"]);
    expect(new Set(two.chips.map((c) => c.text)).size).toBe(4);
    const none = trendingRow(withGroups(NAMES, []), NOW, true)!;
    expect(none.chips.map((c) => c.group)).toEqual(["global", "global", "global", "global"]);
  });

  it("with the Indian sources off it never shows an Indian chip", () => {
    const r = trendingRow(payload(), NOW, false)!;
    expect(r.chips.some((c) => c.group === "in" || INDIA.includes(c.text))).toBe(false);
  });

  it("a phrase that is in both lists is shown once (the Indian list's place wins)", () => {
    const r = trendingRow(withGroups(["AI governance", ...NAMES.slice(2, 10)], ["AI governance", "crop yield prediction"], {}), NOW, true)!;
    const texts = r.chips.map((c) => c.text.toLowerCase());
    expect(new Set(texts).size).toBe(texts.length);
    expect(r.chips.find((c) => c.text === "AI governance")!.group).toBe("in");
  });

  it("drops a chip that the server would refuse (its year is after the year it is now), and a row that is left with fewer than two chips is nothing", () => {
    const future = payload({ groups: { global: { chips: NAMES.map((t, i) => chip(t, { sinceYear: i < 10 ? 2027 : 2025 })) }, in: { chips: [] } } });
    expect(trendingRow(future, NOW, false)!.chips.map((c) => c.text).sort()).toEqual(["quantum error correction", "small language models"]);
    expect(TRENDING_ROW_MIN).toBe(2);
    const one = payload({ groups: { global: { chips: NAMES.map((t, i) => chip(t, { sinceYear: i === 0 ? 2025 : 2027 })) }, in: { chips: [] } } });
    expect(trendingRow(one, NOW, false)).toBeNull();
    const old = payload({ groups: { global: { chips: NAMES.map((t) => chip(t, { sinceYear: 1989 })) }, in: { chips: [] } } });
    expect(trendingRow(old, NOW, false)).toBeNull(); // the server reads 1990 on
  });

  it("returns the chips it was given, exactly: the text is never changed, trimmed or cased", () => {
    const r = trendingRow(payload(), NOW, false)!;
    for (const c of r.chips) expect(payload().groups.global.chips.find((g) => g.text === c.text)).toMatchObject({ sinceYear: c.sinceYear, a: c.a, b: c.b, field: c.field });
  });

  it("does not change its input", () => {
    const p = payload();
    const copy = JSON.stringify(p);
    trendingRow(p, NOW, true);
    trendingRow(p, NOW, false);
    expect(JSON.stringify(p)).toBe(copy);
  });

  it("says the day the list was made, in words", () => {
    expect(trendingRow(payload(), NOW, false)!.updated).toBe("4 November 2026");
  });

  it("never throws on a payload that is not one", () => {
    for (const bad of [{}, { groups: null }, { ...payload(), groups: {} }, { ...payload(), validUntil: 5 }, "x", 3, []]) expect(() => trendingRow(bad as unknown as TrendingPayload, NOW, true)).not.toThrow();
    expect(trendingRow({} as TrendingPayload, NOW, false)).toBeNull();
  });
});

describe("dateWords", () => {
  it("writes a day as a person says it, and nothing for what is not a day", () => {
    expect(dateWords("2026-11-04")).toBe("4 November 2026");
    expect(dateWords("2026-01-01")).toBe("1 January 2026");
    expect(dateWords("2024-02-29")).toBe("29 February 2024");
    expect(dateWords("2026-12-31")).toBe("31 December 2026");
    for (const bad of ["2026-02-30", "2026-13-01", "26-11-04", "", "2026-11-04T00:00:00Z", null, undefined, 20261104]) expect(dateWords(bad as string), String(bad)).toBeNull();
  });
});

describe("the two windows of dates behind a chip's counts", () => {
  it("are the ones the job counts in (trendWindows), for any day, across leap years and the turn of a year", () => {
    for (const day of ["2026-11-04", "2026-01-03", "2025-03-01", "2024-02-29", "2027-12-31", "2026-03-31", "2028-01-01"]) expect(countWindows(day), day).toEqual(trendWindows(day));
  });

  it("are nothing for a day that is not a day, and never throw", () => {
    for (const bad of ["2026-02-30", "x", "", null, undefined, 5]) expect(countWindows(bad as string)).toBeNull();
  });

  it("are said exactly, with both ends of each, in the facts under a chip", () => {
    // 4 November 2026: window A ends 45 days before it (20 September) and is 91 days long (from 22 June); window B is the same dates 364 days earlier (23 June to 21 September 2025)
    expect(countWindows("2026-11-04")).toEqual({ a: { from: "2026-06-22", to: "2026-09-20" }, b: { from: "2025-06-23", to: "2025-09-21" } });
    expect(chipFacts(chip("retrieval-augmented generation"), "2026-11-04")).toBe("452 journal papers with an abstract, in one subfield of Computer Science, from 22 June to 20 September 2026, against 176 from 23 June to 21 September 2025.");
    expect(chipFacts(chip("x y", { a: 1234567, b: 1 }), "2026-11-04")).toBe("1,234,567 journal papers with an abstract, in one subfield of Computer Science, from 22 June to 20 September 2026, against 1 from 23 June to 21 September 2025.");
    expect(chipFacts(chip("x y"), "nonsense")).toBeNull();
  });

  it("say what the counts are counts OF: one subfield, with an abstract (the job's filter), and for the India list papers with an Indian author; never 'journal papers' alone", () => {
    // a and b are counted inside ONE OpenAlex subfield with has_abstract and authors_count<60 (apps/api/src/trending/openalex.ts, oaFilter): the same keyword over every subfield has more than twice as many
    // papers, so a sentence that says only "journal papers" understated the topic (reviewer, 4 Nov 2026)
    const said = chipFacts(chip("x y", { field: "Engineering" }), "2026-11-04")!;
    expect(said).toContain("with an abstract");
    expect(said).toContain("in one subfield of Engineering");
    expect(said).not.toContain("Indian");
    const india = chipFacts({ ...chip("x y", { field: "Engineering" }), group: "in" }, "2026-11-04")!;
    expect(india).toBe("452 journal papers with an abstract and an author at an Indian institution, in one subfield of Engineering, from 22 June to 20 September 2026, against 176 from 23 June to 21 September 2025.");
    expect(chipFacts({ ...chip("x y"), group: "global" }, "2026-11-04")).toBe(chipFacts(chip("x y"), "2026-11-04"));
  });

  it("are said once for the whole list (windowWords), and each chip then says only its two numbers and where they were counted (chipCounts)", () => {
    expect(windowWords("2026-11-04")).toBe("from 22 June to 20 September 2026, against 23 June to 21 September 2025");
    expect(windowWords("2024-02-29")).toBe("from 17 October 2023 to 15 January 2024, against 18 October 2022 to 16 January 2023"); // the years differ: both are written
    expect(windowWords("nonsense")).toBeNull();
    expect(chipCounts(chip("x y", { field: "Physics and Astronomy" }))).toBe("452 against 176, in one subfield of Physics and Astronomy");
    expect(chipCounts({ ...chip("x y", { a: 1234567, b: 1 }), group: "in" })).toBe("1,234,567 against 1, in one subfield of Computer Science, papers with an Indian author");
  });
});

describe("the dates behind a chip's counts are the day the COUNTS were made, not the day of the file", () => {
  // the counts come from the weekly pool (poolAsOf, 2 November here); the file is made every day from it (asOf, 4 November). The windows A and B are made from the pool's day.
  it("the row carries the pool's day, and the facts are said from it", () => {
    const row = trendingRow(payload(), NOW, false)!;
    expect(row.asOf).toBe("2026-11-04");
    expect(row.poolAsOf).toBe("2026-11-02");
    const c = row.chips[0]!;
    expect(rowFacts(row, c)).toBe(`${c.a} journal papers with an abstract, in one subfield of ${c.field}, from 20 June to 18 September 2026, against ${c.b} from 21 June to 19 September 2025.`);
    expect(rowFacts(row, c)).toBe(chipFacts(c, "2026-11-02"));
    expect(rowWindows(row)).toBe(windowWords("2026-11-02")); // the one line of dates above the list is the pool's too
    expect(rowWindows(row)).not.toBe(windowWords("2026-11-04"));
    expect(rowFacts(row, c)).not.toBe(chipFacts(c, "2026-11-04")); // what the page said before: two days off (up to 13)
  });

  it("on the pool's own day the two days are the same, and the facts do not change", () => {
    const row = trendingRow(payload({ asOf: "2026-11-02", poolAsOf: "2026-11-02" }), NOW, false)!;
    expect(rowFacts(row, row.chips[0]!)).toBe(chipFacts(row.chips[0]!, "2026-11-02"));
  });

  it("says nothing for a pool's day that is not a day", () => {
    const row = trendingRow(payload(), NOW, false)!;
    expect(rowFacts({ ...row, poolAsOf: "nonsense" }, row.chips[0]!)).toBeNull();
    expect(rowWindows({ ...row, poolAsOf: "nonsense" })).toBeNull();
  });

  it("an India chip of the row says so in its facts, a global one does not (the group travels with the shown chip)", () => {
    const row = trendingRow(payload(), NOW, true)!;
    const inn = row.chips.find((c) => c.group === "in")!;
    const glob = row.chips.find((c) => c.group === "global");
    expect(rowFacts(row, inn)).toContain("an author at an Indian institution");
    expect(rowFacts(row, inn)).toContain(`in one subfield of ${inn.field}`);
    if (glob) expect(rowFacts(row, glob)).not.toContain("Indian");
    expect(chipCounts(inn)).toBe(`${inn.a} against ${inn.b}, in one subfield of ${inn.field}, papers with an Indian author`);
  });
});

describe("the copy kept on the device", () => {
  const p = payload();
  it("is read back as the page's own reader reads it, while it is under 24 hours old and still fresh", () => {
    const raw = deviceCopyOf(p, NOW);
    expect(readDeviceCopy(raw, NOW)).toEqual(p);
    expect(readDeviceCopy(raw, NOW + DEVICE_COPY_MAX_AGE_MS)).toEqual(p); // exactly 24 hours is still inside
    expect(readDeviceCopy(raw, NOW + DEVICE_COPY_MAX_AGE_MS + 1)).toBeNull(); // older than 24 hours is ignored
    expect(DEVICE_COPY_MAX_AGE_MS).toBe(24 * 3_600_000);
  });

  it("is ignored once the list itself is no longer fresh, whatever the copy's age", () => {
    const soon = payload({ validUntil: "2026-11-04T12:00:00.000Z" });
    const raw = deviceCopyOf(soon, NOW);
    expect(readDeviceCopy(raw, Date.parse("2026-11-04T11:59:00Z"))).toEqual(soon);
    expect(readDeviceCopy(raw, Date.parse("2026-11-04T12:00:00Z"))).toBeNull();
    expect(readDeviceCopy(deviceCopyOf(payload({ disabled: true }), NOW), NOW)).toBeNull();
  });

  it("is ignored when it is not what was written: nothing, broken, from the future (a clock that was wrong), or a payload the reader refuses", () => {
    for (const raw of [null, undefined, "", "not json", "[]", "null", "{}", '{"savedAt":1}', '{"payload":{}}', JSON.stringify({ savedAt: "now", payload: p }), JSON.stringify({ savedAt: NOW + 60_000, payload: p }), JSON.stringify({ savedAt: NOW, payload: { ...p, version: 2 } }), JSON.stringify({ savedAt: NOW, payload: { ...p, groups: { global: { chips: [{ text: "x", sinceYear: 2025, a: 1, b: 1, field: "f" }] }, in: { chips: [] } } } })]) {
      expect(readDeviceCopy(raw as string, NOW), String(raw).slice(0, 40)).toBeNull();
    }
  });

  it("holds the contract's fields and nothing else (nothing a person did is in it)", () => {
    const raw = deviceCopyOf(p, NOW);
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(["payload", "savedAt"]);
    expect(Object.keys(JSON.parse(raw).payload).sort()).toEqual(["asOf", "disabled", "generatedAt", "groups", "poolAsOf", "validUntil", "version"]);
    expect(JSON.parse(raw).savedAt).toBe(NOW);
  });
});

describe("decideFetched: what to do with the server's answer", () => {
  it("keeps a fresh list for the next time the page is opened", () => {
    expect(decideFetched(payload(), NOW)).toBe("save");
  });
  it("clears the copy on the device when the server says the list is switched off, or has none, or has one that has run out: a copy must never outlive the kill switch", () => {
    expect(decideFetched(payload({ disabled: true }), NOW)).toBe("clear");
    expect(decideFetched(payload({ validUntil: "2026-11-04T09:00:00.000Z" }), NOW)).toBe("clear");
    expect(decideFetched(payload({ groups: { global: { chips: [] }, in: { chips: [] } }, validUntil: "2026-11-04T03:17:05.000Z", disabled: false }), NOW)).toBe("clear"); // the server's empty answer
  });
  it("leaves the copy alone when the answer is not a list at all (a failure, a page that is not ours)", () => {
    expect(decideFetched(null, NOW)).toBe("ignore");
  });
  it("agrees with isFresh and with the page's reader on the server's own empty and disabled answers", () => {
    const empty = parseTrending({ version: 1, asOf: "2026-11-04", generatedAt: "2026-11-04T09:30:00.000Z", validUntil: "2026-11-04T09:30:00.000Z", poolAsOf: "2026-11-04", disabled: false, groups: { global: { chips: [] }, in: { chips: [] } } })!;
    expect(isFresh(empty, NOW)).toBe(false);
    expect(decideFetched(empty, NOW)).toBe("clear");
  });
});

describe("filling the box from a chip, and what happens to a draft the person had typed", () => {
  const rag = { text: "retrieval-augmented generation", sinceYear: 2025 };
  const shap = { text: "AI governance", sinceYear: 2025 };

  it("an empty box is filled with the chip's exact text and the year filter is set; nothing is kept, there is nothing to keep", () => {
    const r = fillChip("", NO_DRAFT, rag);
    expect(r.text).toBe("retrieval-augmented generation");
    expect(r.draft).toEqual({ since: 2025, filled: "retrieval-augmented generation", undo: null });
    expect(fillChip("   \n ", NO_DRAFT, rag).draft.undo).toBeNull(); // only blanks
  });

  it("text the person typed is replaced, and is kept so that it can be put back (it is never destroyed silently)", () => {
    const r = fillChip("my own question about glaucoma screening", NO_DRAFT, rag);
    expect(r.text).toBe("retrieval-augmented generation");
    expect(r.draft.undo).toEqual({ text: "my own question about glaucoma screening", since: null });
    const back = putBack(r.draft)!;
    expect(back.text).toBe("my own question about glaucoma screening");
    expect(back.draft).toEqual(NO_DRAFT);
  });

  it("the text is kept exactly as typed (spaces and line breaks are the person's)", () => {
    const typed = "  two lines\nof my own  ";
    expect(putBack(fillChip(typed, NO_DRAFT, rag).draft)!.text).toBe(typed);
  });

  it("putting back also puts back the year filter the draft had, if it had one", () => {
    const d: Draft = { since: 2024, filled: null, undo: null };
    const r = fillChip("a draft with its own year", d, rag);
    expect(r.draft.since).toBe(2025);
    const back = putBack(r.draft)!;
    expect(back.text).toBe("a draft with its own year");
    expect(back.draft.since).toBe(2024);
  });

  it("a second chip over an unedited fill replaces it without keeping it (it was never the person's), and the person's first draft stays recoverable", () => {
    const first = fillChip("my own question", NO_DRAFT, rag);
    const second = fillChip(first.text, first.draft, shap);
    expect(second.text).toBe("AI governance");
    expect(second.draft.undo).toEqual({ text: "my own question", since: null });
    expect(putBack(second.draft)!.text).toBe("my own question");
    // with no draft of the person's, two chips in a row keep nothing
    const a = fillChip("", NO_DRAFT, rag);
    expect(fillChip(a.text, a.draft, shap).draft.undo).toBeNull();
  });

  it("a fill that the person then edited is theirs: a new chip keeps it", () => {
    const first = fillChip("", NO_DRAFT, rag);
    const edited = first.text + " in healthcare";
    const second = fillChip(edited, first.draft, shap);
    expect(second.draft.undo).toEqual({ text: "retrieval-augmented generation in healthcare", since: 2025 });
    expect(putBack(second.draft)!.draft.since).toBe(2025);
  });

  it("the same chip pressed again over its own unedited text changes nothing that was the person's", () => {
    const first = fillChip("my own question", NO_DRAFT, rag);
    const again = fillChip(first.text, first.draft, rag);
    expect(again.text).toBe(first.text);
    expect(again.draft).toEqual(first.draft);
  });

  it("there is nothing to put back when nothing was kept", () => {
    expect(putBack(NO_DRAFT)).toBeNull();
    expect(putBack(fillChip("", NO_DRAFT, rag).draft)).toBeNull();
  });

  it("does not change what it was given", () => {
    const d: Draft = Object.freeze({ since: 2024, filled: "x y", undo: Object.freeze({ text: "kept", since: null }) });
    expect(() => fillChip("typed", d, rag)).not.toThrow();
    expect(() => putBack(d)).not.toThrow();
    expect(d.undo).toEqual({ text: "kept", since: null });
  });
});

describe("reconcileDraft: the filter and what was kept belong to a box that has text in it", () => {
  const filled: Draft = { since: 2025, filled: "retrieval-augmented generation", undo: { text: "my own question", since: null } };

  it("an emptied box takes the year filter and what was kept away with it (a new question starts clean)", () => {
    expect(reconcileDraft("", filled)).toEqual(NO_DRAFT);
    expect(reconcileDraft("  \n", filled)).toEqual(NO_DRAFT);
  });

  it("a box that still has text is left alone, whatever it says (an edited chip keeps its filter, which stays visible and removable)", () => {
    expect(reconcileDraft("retrieval-augmented generation in healthcare", filled)).toBe(filled);
    expect(reconcileDraft("x", filled)).toBe(filled);
  });

  it("an empty box with no draft is the same object, so that the page does not draw again for it", () => {
    expect(reconcileDraft("", NO_DRAFT)).toBe(NO_DRAFT);
    expect(reconcileDraft("hello there", NO_DRAFT)).toBe(NO_DRAFT);
  });
});

describe("limits", () => {
  it("the pool a day's chips are picked from is the top twelve, so a row of four moves along it", () => {
    expect(TRENDING_MAX_CHIPS).toBe(12);
    const seen = new Set<string>();
    for (let d = 1; d <= 3; d++) for (const c of trendingRow(payload({ asOf: `2026-11-${String(d).padStart(2, "0")}` }), NOW, false)!.chips) seen.add(c.text);
    expect(seen.size).toBe(12); // three days of four chips cover all twelve
  });
});

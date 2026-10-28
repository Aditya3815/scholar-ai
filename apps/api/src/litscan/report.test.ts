import { describe, expect, it } from "vitest";
import {
  LITSCAN_MAX_TOPIC,
  assembleReport,
  cleanLitscanTopic,
  emptyView,
  estimateScanTokens,
  reduceView,
  streamShapeProblems,
  viewFromEvents,
  type LitscanEvent,
  type LitscanItem,
  type LitscanPart,
} from "@scholar/shared";

const items: LitscanItem[] = [
  { question: "How strong is the link?", searchQuery: "air pollution asthma" },
  { question: "How is exposure measured?", searchQuery: "traffic pollution exposure" },
  { question: "What helps?", searchQuery: "intervention asthma children" },
];
const src = (n: number, paperId: string, title = `Paper ${paperId}`) => ({ n, paperId, title, year: 2020, doi: `10.1/${paperId}`, authors: ["A. Rao"], venue: "J", url: `https://doi.org/10.1/${paperId}` });
const answered = (idx: number, text: string, sources: ReturnType<typeof src>[], sentences: Record<number, string> = {}): LitscanPart => ({
  idx,
  status: "answered",
  found: 12,
  text,
  sources,
  citations: sources.map((s) => ({ n: s.n, paperId: s.paperId, sentenceNo: 2, sentence: sentences[s.n] ?? `Sentence of ${s.paperId}.` })),
});

describe("the topic", () => {
  it("is tidied and must be 8 to 400 characters with a letter or number", () => {
    expect(cleanLitscanTopic("  air   pollution \n and asthma  ")).toBe("air pollution and asthma");
    expect(cleanLitscanTopic("short")).toBeNull();
    expect(cleanLitscanTopic("x".repeat(LITSCAN_MAX_TOPIC + 1))).toBeNull();
    expect(cleanLitscanTopic("!!!!!!!!!!!!")).toBeNull();
    expect(cleanLitscanTopic(42)).toBeNull();
  });
  it("costs a known amount a sub-question, so the approval screen can say it before anything runs", () => {
    expect(estimateScanTokens(5)).toBe(27_500);
    expect(estimateScanTokens(0)).toBe(0);
  });
});

describe("putting the parts together", () => {
  it("numbers the sources of the whole report once, by paper, and renumbers each section's marks to match", () => {
    const report = assembleReport(items, {
      0: answered(0, "Pollution is linked to asthma [3]. Traffic matters most [7][3].", [src(3, "a"), src(7, "b")]),
      1: answered(1, "Exposure is modelled [2].", [src(2, "b")]), // the same paper as [7] above
    });
    expect(report.sources.map((s) => [s.g, s.paperId])).toEqual([[1, "a"], [2, "b"]]);
    const [s0, s1, s2] = report.sections;
    expect(s0).toMatchObject({ status: "answered", text: "Pollution is linked to asthma [1]. Traffic matters most [2][1]." });
    expect(s1).toMatchObject({ status: "answered", text: "Exposure is modelled [2]." });
    expect(s2).toMatchObject({ status: "pending" });
    expect(report).toMatchObject({ answered: 2, gaps: 0, pending: 1 });
  });

  it("keeps each section's evidence sentences, word for word, under the combined number", () => {
    const report = assembleReport(items, { 0: answered(0, "Claim [4].", [src(4, "z")], { 4: "The exact sentence." }) });
    expect(report.sections[0]).toMatchObject({ status: "answered", evidence: [{ g: 1, sentence: "The exact sentence." }] });
  });

  it("does not repeat a mark when two papers of one section become the same source", () => {
    const report = assembleReport(items, { 0: answered(0, "Both say so [1][2].", [src(1, "p"), src(2, "p")]) });
    expect(report.sections[0]).toMatchObject({ text: "Both say so [1]." });
    expect(report.sources).toHaveLength(1);
  });

  it("carries each sub-question's search words, so a gap can point at them", () => {
    const report = assembleReport(items, { 1: { idx: 1, status: "gap", found: 0, reason: "nothing_found" } });
    expect(report.sections.map((s) => s.searchQuery)).toEqual(["air pollution asthma", "traffic pollution exposure", "intervention asthma children"]);
  });

  it("shows a sub-question that could not be answered as a gap with its reason, in its place", () => {
    const report = assembleReport(items, {
      0: { idx: 0, status: "gap", found: 0, reason: "nothing_found" },
      1: answered(1, "Fine [1].", [src(1, "q")]),
      2: { idx: 2, status: "gap", found: 9, reason: "not_grounded" },
    });
    expect(report.sections.map((s) => s.status)).toEqual(["gap", "answered", "gap"]);
    expect(report).toMatchObject({ answered: 1, gaps: 2, pending: 0 });
    expect(report.sections[2]).toMatchObject({ reason: "not_grounded" });
  });

  it("names each section by its theme, and an older scan without theme names by its question", () => {
    const titled = assembleReport([{ ...items[0]!, title: "Strength of the link" }, items[1]!], {});
    expect(titled.sections.map((s) => s.title)).toEqual(["Strength of the link", "How is exposure measured?"]);
  });

  it("adds nothing of its own: a section's words are its checked answer, only renumbered", () => {
    const text = "Plain claim with no marks at all.";
    const report = assembleReport(items, { 0: answered(0, text, [src(1, "a")]) });
    expect(report.sections[0]).toMatchObject({ text });
  });
});

describe("the page's view is the events folded together", () => {
  const events: LitscanEvent[] = [
    { type: "started", seq: 1, total: 3 },
    { type: "worker", seq: 2, idx: 0, stage: "searching" },
    { type: "worker", seq: 3, idx: 1, stage: "searching" },
    { type: "worker", seq: 4, idx: 0, stage: "reading" },
    { type: "part", seq: 5, part: { idx: 0, status: "gap", found: 0, reason: "nothing_found" } },
    { type: "part", seq: 6, part: answered(1, "x [1]", [src(1, "a")]) },
  ];

  it("counts finished sub-questions and keeps where the others are", () => {
    const v = viewFromEvents(events);
    expect(v).toMatchObject({ state: "running", total: 3, done: 2, seq: 6 });
    expect(v.stages).toEqual({});
    expect(viewFromEvents(events.slice(0, 4))).toMatchObject({ done: 0, stages: { 0: "reading", 1: "searching" } });
  });

  it("is the same when an event arrives twice (a stream that was cut and asked again repeats the last one)", () => {
    const once = viewFromEvents(events);
    const twice = events.reduce(reduceView, once);
    expect(twice).toEqual(once);
  });

  it("ends with the state of the done event, and a worker event after its part changes nothing", () => {
    const v = viewFromEvents([...events, { type: "worker", seq: 7, idx: 1, stage: "reading" }, { type: "done", seq: 8, state: "completed", answered: 1, gaps: 1 }]);
    expect(v.state).toBe("completed");
    expect(v.stages).toEqual({});
    expect(emptyView(4)).toMatchObject({ total: 4, done: 0, state: "running" });
  });

  it("never lets progress go down", () => {
    const v = reduceView(viewFromEvents(events), { type: "progress", done: 1, total: 3 });
    expect(v.done).toBe(2);
  });
});

describe("the stream follows the event rule", () => {
  const good: LitscanEvent[] = [
    { type: "progress", done: 0, total: 2 },
    { type: "started", seq: 1, total: 2 },
    { type: "worker", seq: 2, idx: 0, stage: "searching" },
    { type: "part", seq: 3, part: { idx: 0, status: "gap", found: 0, reason: "nothing_found" } },
    { type: "progress", done: 1, total: 2 },
    { type: "part", seq: 4, part: answered(1, "x [1]", [src(1, "a")]) },
    { type: "progress", done: 2, total: 2 },
    { type: "done", seq: 5, state: "completed", answered: 1, gaps: 1 },
  ];
  it("accepts a whole scan", () => {
    expect(streamShapeProblems("litscan", good)).toEqual([]);
  });
  it("refuses words on a progress event, a progress that goes back, and a stream that does not end", () => {
    expect(streamShapeProblems("litscan", [...good.slice(0, 2), { type: "worker", idx: 0, stage: "reading", text: "Reading the papers" } as never, good[7]!]).join(" ")).toMatch(/may carry only/);
    expect(streamShapeProblems("litscan", [{ type: "progress", done: 2, total: 3 }, { type: "progress", done: 1, total: 3 }, good[7]!]).join(" ")).toMatch(/went back/);
    expect(streamShapeProblems("litscan", good.slice(0, 5)).join(" ")).toMatch(/no end event/);
    expect(streamShapeProblems("litscan", [{ type: "progress", done: 4, total: 3 }, good[7]!]).join(" ")).toMatch(/not above total/);
  });
});

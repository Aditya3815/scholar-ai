// R8 (docs/design/intent-and-state.md, 4.8 and 8.5): the request-frame cleaner measured on the data of the repository. Pure and offline (no network, no model), so `npm run eval` runs it on every push.
//
// WHAT IS MEASURED, AND ON WHAT
//   E0 (apps/api/eval/data/intent-controls.json, intent-cases.json): the 325 English controls (14 router cases, 30 G5 titles, 20 G6 queries, 45 trap tokens, 216 clean topics) and the 179 English DEV cases:
//     "changed on controls" (a hard zero), idempotence and never-grows over every text, the traps, the do-not-touch classes of the DEV set. E0 holds NO frame labels (`gold.removed` is empty everywhere), no
//     constraint cases for the notes and fewer than 400 research messages, so the rest is measured on
//   frame-r8.json: 234 frame-labelled cases, 304 note cases (16 or 18 positives and 11 or 12 near-miss negatives for each kind) and 402 plain research messages, written for R8 by a separate session that was
//     given only the plan's text (its provenance is in the file). They are development data from the moment a miss of theirs is read.
//   The 203-message router list (scripts/router-cases.mjs), English one-line searches: reported, not gated (it holds framed messages by design: "find me papers on ...").
// WHAT CANNOT BE MEASURED HERE: oracle overlap at 20, the paired precision at 10 on the messy class, the one-provider share (they need recorded provider lists and human labels), and the sealed hold-out.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { withoutLeft, type NoteKind } from "@scholar/shared";
import { cleanRequest, readRequest, type RouteLike } from "../src/understand/frame";
import { checkReading } from "../src/understand/reading-check";
import { lowerBound, upperBound } from "./lib/metrics";
// @ts-expect-error plain .mjs: the labelled messages of the router eval
import { CASES as ROUTER_CASES } from "../scripts/router-cases.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const readJson = <T>(name: string) => JSON.parse(readFileSync(HERE + "data/" + name, "utf8")) as T;
type E0 = { id: string; set: string; language: string; class: string; text: string; tags?: string[] };
const dev = readJson<E0[]>("intent-cases.json");
const controls = readJson<E0[]>("intent-controls.json");
const mine = readJson<{
  frame: { id: string; text: string; removed: string[]; anchors: string[] }[];
  notes: { id: string; text: string; kind: NoteKind | "none"; phrase?: string; against?: string }[];
  clean: { id: string; text: string }[];
}>("frame-r8.json");

const SEARCH: RouteLike = { mode: "search", language: "en", how: "rules" };
const read = (text: string, person = false) => readRequest(text, SEARCH, { person });
const norm = (t: string) => t.replace(/\s+/g, " ").trim();
/** The words searched: the topic of a Reading that changes them, else the message. */
const searched = (text: string): string => read(text)?.reading.topic ?? norm(text);
const changed = (text: string): boolean => {
  const r = read(text);
  return r !== null && (r.reading.topic !== norm(text) || r.reading.left.length > 0);
};
const hasWord = (haystack: string, needle: string): boolean => {
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u");
  return re.test(h);
};

const englishControls = controls.filter((c) => c.language === "en");
const englishDev = dev.filter((c) => c.language === "en");
const routerEnglish = (ROUTER_CASES as [string, string, string, string][]).filter((c) => c[1] === "search" && c[2] === "en" && !c[0].includes("\n")).map((c) => c[0]);
const pct = (k: number, n: number) => `${k}/${n} = ${((100 * k) / Math.max(n, 1)).toFixed(1)}%`;

const report: Record<string, unknown> = {};

describe("R8, the request-frame cleaner, on E0", () => {
  it("changed on controls: 0 of at least 300 English controls (router, G5 titles, G6 queries, trap tokens, clean topics)", () => {
    const moved = englishControls.filter((c) => changed(c.text));
    report.controlsChanged = `${moved.length} of ${englishControls.length}`;
    report.controlsChangedUpperBound95 = upperBound(moved.length, englishControls.length).toFixed(4);
    expect(englishControls.length).toBeGreaterThanOrEqual(300);
    expect(moved.map((c) => `${c.id}: ${c.text}`)).toEqual([]);
  });

  it("no control carries a note either (a note on a clean control is a wrong line shown)", () => {
    const noted = englishControls.filter((c) => (read(c.text)?.reading.notes.length ?? 0) > 0);
    report.controlsWithANote = `${noted.length} of ${englishControls.length}`;
    expect(noted.map((c) => `${c.id}: ${c.text}`)).toEqual([]);
  });

  it("Hindi and Hinglish controls are never touched (O-7: they are searched as written)", () => {
    const other = controls.filter((c) => c.language !== "en");
    expect(other.length).toBeGreaterThanOrEqual(30);
    expect(other.filter((c) => read(c.text) !== null).map((c) => c.text)).toEqual([]);
  });

  it("the trap tokens (45 of E0) are unchanged", () => {
    const traps = controls.filter((c) => c.class === "trap_token");
    report.trapsChanged = `${traps.filter((c) => changed(c.text)).length} of ${traps.length}`;
    expect(traps.filter((c) => changed(c.text)).map((c) => c.text)).toEqual([]);
  });

  it("the do-not-touch classes of the DEV set (comparison, method or dataset, narrow technical, thin literature, exact title) are unchanged", () => {
    const keep = new Set(["comparison", "topic_by_method_or_dataset", "very_narrow_technical", "little_open_literature", "known_paper_by_title", "known_paper_by_authors_and_year", "numbers_and_units"]);
    const cases = englishDev.filter((c) => keep.has(c.class));
    const moved = cases.filter((c) => changed(c.text));
    report.doNotTouchChanged = `${moved.length} of ${cases.length}`;
    report.doNotTouchChangedList = moved.map((c) => `${c.class}: ${c.text}`);
    expect(cases.length).toBeGreaterThanOrEqual(15);
  });

  it("every English DEV case, for the record: how many are changed, by class", () => {
    const by: Record<string, [number, number]> = {};
    for (const c of englishDev) {
      const e = (by[c.class] ??= [0, 0]);
      e[1]++;
      if (changed(c.text)) e[0]++;
    }
    report.devChangedByClass = Object.fromEntries(Object.entries(by).filter(([, v]) => v[0] > 0).map(([k, v]) => [k, `${v[0]}/${v[1]}`]));
    report.devChanged = `${Object.values(by).reduce((s, v) => s + v[0], 0)} of ${englishDev.length}`;
  });

  it("the English router cases (one-line searches): how many are changed (they hold framed messages by design)", () => {
    const moved = routerEnglish.filter(changed);
    report.routerChanged = `${moved.length} of ${routerEnglish.length}`;
    report.routerChangedList = moved;
    expect(routerEnglish.length).toBeGreaterThanOrEqual(30);
  });

  it("idempotent and never grows, over every text of E0 (dev and controls), of frame-r8.json and of the router list", () => {
    const texts = [...dev, ...controls].map((c) => c.text).concat(mine.frame.map((c) => c.text), mine.notes.map((c) => c.text), mine.clean.map((c) => c.text), (ROUTER_CASES as string[][]).map((c) => c[0]!));
    let reread = 0;
    let n = 0;
    const bad: string[] = [];
    for (const text of texts) {
      for (const person of [false, true]) {
        const a = read(text, person);
        const b = read(text, person);
        if (JSON.stringify(a) !== JSON.stringify(b)) bad.push(`not deterministic: ${text}`);
        const topic = a?.reading.topic ?? norm(text);
        if (topic.length > norm(text).length) bad.push(`grows: ${text}`);
        if (a) {
          n++;
          if (!checkReading(a.reading, text)) bad.push(`checkReading fails: ${text}`);
          const again = read(a.reading.topic, person);
          if (again && (again.reading.topic !== a.reading.topic || again.reading.left.length > 0)) bad.push(`not idempotent: ${text} -> ${a.reading.topic} -> ${again.reading.topic}`);
          if (a.reading.left.length > 0 && withoutLeft(text, a.reading.left) !== a.reading.topic) bad.push(`topic is not the message less its pieces: ${text}`);
          reread++;
          if (cleanRequest(a.reading.topic, { person }) !== a.reading.topic) bad.push(`cleanRequest not idempotent: ${text}`);
        }
      }
    }
    report.idempotenceChecked = `${texts.length} texts, ${n} with a Reading`;
    expect(reread).toBeGreaterThan(100);
    expect(bad).toEqual([]);
  });
});

describe("R8, the request-frame cleaner, on frame-r8.json (separate session, development data)", () => {
  it("frame words removed in at least 80% of the labelled frame cases, and the anchors kept in at least 98%", () => {
    let removed = 0;
    let anchorsKept = 0;
    const missedRemoval: string[] = [];
    const lostAnchor: string[] = [];
    for (const c of mine.frame) {
      const topic = searched(c.text);
      const goneAll = c.removed.every((p) => !hasWord(topic, p));
      if (goneAll) removed++;
      else missedRemoval.push(`${c.id}: ${c.text}  =>  ${topic}   (labelled removed: ${c.removed.join(" | ")})`);
      const kept = c.anchors.every((a) => hasWord(topic, a));
      if (kept) anchorsKept++;
      else lostAnchor.push(`${c.id}: ${c.text}  =>  ${topic}`);
    }
    report.frameRemoved = pct(removed, mine.frame.length);
    report.frameRemovedLower95 = lowerBound(removed, mine.frame.length).toFixed(3);
    report.anchorsKept = pct(anchorsKept, mine.frame.length);
    report.anchorsKeptLower95 = lowerBound(anchorsKept, mine.frame.length).toFixed(3);
    report.missedRemovalSample = missedRemoval.slice(0, 40);
    report.lostAnchor = lostAnchor;
    expect(mine.frame.length).toBeGreaterThanOrEqual(100);
  });

  it("changed on the plain research messages: 0 of 402, and no note shown", () => {
    const moved = mine.clean.filter((c) => changed(c.text));
    const noted = mine.clean.filter((c) => (read(c.text)?.reading.notes.length ?? 0) > 0);
    report.cleanChanged = `${moved.length} of ${mine.clean.length}`;
    report.cleanChangedList = moved.map((c) => `${c.id}: ${c.text}  =>  ${searched(c.text)}`);
    report.cleanNoted = `${noted.length} of ${mine.clean.length}`;
    report.cleanNotedList = noted.map((c) => `${c.id}: ${c.text}  =>  ${JSON.stringify(read(c.text)?.reading.notes)}`);
    expect(mine.clean.length).toBeGreaterThanOrEqual(260);
  });

  it("each note kind: recall on its positives, and how often it is shown wrongly on the research messages (controls and clean)", () => {
    const kinds: NoteKind[] = ["all", "recent", "count", "negation", "form", "order", "author", "venue", "threshold", "prove", "person"];
    const research = [...englishControls.map((c) => c.text), ...mine.clean.map((c) => c.text)];
    const table: Record<string, unknown> = {};
    for (const k of kinds) {
      const positives = mine.notes.filter((c) => c.kind === k);
      const hits = positives.filter((c) => read(c.text, k === "person")?.reading.notes.some((n) => n.kind === k));
      const misses = positives.filter((c) => !hits.includes(c));
      const negatives = mine.notes.filter((c) => c.kind === "none" && c.against === k);
      const falseNeg = negatives.filter((c) => read(c.text, false)?.reading.notes.some((n) => n.kind === k));
      // wrongly shown on the research messages (a first-person word is never in them, so the personal note cannot be asked there)
      const falseResearch = k === "person" ? [] : research.filter((t) => read(t)?.reading.notes.some((n) => n.kind === k));
      table[k] = {
        recall: pct(hits.length, positives.length),
        recallLower95: lowerBound(hits.length, positives.length).toFixed(2),
        falseOnResearch: `${falseResearch.length}/${research.length}`,
        falseOnNearMisses: `${falseNeg.length}/${negatives.length}`,
        missed: misses.map((c) => c.text),
        falseNearMissTexts: falseNeg.map((c) => c.text),
        falseResearchTexts: falseResearch,
      };
    }
    report.noteKinds = table;
    expect(Object.keys(table)).toHaveLength(11);
  });

  it("the personal-details strip: no first-person word is left in the words searched, and the condition stays", () => {
    const persons = mine.notes.filter((c) => c.kind === "person");
    const left: string[] = [];
    for (const c of persons) {
      const r = read(c.text, true);
      if (!r) {
        left.push(`no reading: ${c.text}`);
        continue;
      }
      if (/(?<![\p{L}\p{N}'’-])(?:I|my|me|mine|we|our|ours|myself)(?![\p{L}\p{N}'’-])/iu.test(r.reading.topic.replace(/\b(?:type|phase|stage) I\b/g, ""))) left.push(`${c.text}  =>  ${r.reading.topic}`);
    }
    report.personWordsLeft = left;
    report.personNotSearchable = persons.filter((c) => read(c.text, true)?.searchable === false).map((c) => c.text);
    expect(persons.length).toBeGreaterThanOrEqual(10);
  });

  it("prints the report", () => {
    // the numbers, for a person to read: FRAME_EVAL_REPORT names the file to write them to
    const out = process.env.FRAME_EVAL_REPORT;
    if (out) writeFileSync(out, JSON.stringify(report, null, 1));
  });
});

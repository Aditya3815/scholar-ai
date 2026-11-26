import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkReading, UNDERSTAND_SYSTEM } from "./understand";
import type { Understanding } from "./understanding";

/** The golden sets of docs/eval/golden: their shape, their counts, and the one thing that is measured offline, the guard around the intent "answer". */
const load = <T>(name: string): T[] => (JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../docs/eval/golden/${name}`, import.meta.url)), "utf8")) as { items: T[] }).items;

type Q = { id: string; text: string; group: string; expect: string; expected_doi?: string; terms?: string[]; india?: boolean };
type R = { id: string; raw: string; expect: string; kind: string; doi?: string };
type A = { id: string; text: string; language: string; expect: "answer" | "search" };

describe("queries.json", () => {
  const q = load<Q>("queries.json");
  it("has 200 unique queries in the planned groups", () => {
    expect(q).toHaveLength(200);
    expect(new Set(q.map((x) => x.id)).size).toBe(200);
    const n = (g: string) => q.filter((x) => x.group === g).length;
    expect([n("known_item"), n("topical_en"), n("hinglish"), n("hindi"), n("typos"), n("off_topic"), n("indian_topic")]).toEqual([40, 40, 30, 15, 25, 25, 25]);
  });
  it("each query has what its group is scored by", () => {
    for (const x of q) {
      if (x.group === "known_item") expect(x.expected_doi, x.id).toMatch(/^10\./);
      else if (x.group === "off_topic") expect(x.expect, x.id).toBe("none");
      else expect(x.terms?.length, x.id).toBeGreaterThan(0);
    }
  });
  it("no query is an example of the Understand prompt", () => {
    for (const x of q) expect(UNDERSTAND_SYSTEM.toLowerCase().includes(`"${x.text.toLowerCase()}"`), x.id).toBe(false);
  });
});

describe("references.json", () => {
  const r = load<R>("references.json");
  it("has 100 unique references in the planned kinds", () => {
    expect(r).toHaveLength(100);
    expect(new Set(r.map((x) => x.id)).size).toBe(100);
    const n = (k: string) => r.filter((x) => x.kind === k).length;
    expect([n("clean"), n("wrong_year"), n("fake"), n("doi_only"), n("book"), n("reprint")]).toEqual([30, 20, 20, 10, 10, 10]);
  });
  it("every real entry has a DOI of the right shape, every fake and book has none", () => {
    for (const x of r) {
      if (["fake", "book"].includes(x.kind)) expect(x.doi, x.id).toBeUndefined();
      else expect(x.doi, x.id).toMatch(/^10\.\d{4,9}\/\S+$/);
    }
  });
});

const reading = (over: Partial<Understanding> = {}): Understanding => ({
  intent: "answer", language: "en", status: "A general question", standalone: "x", search: null, refers_to: null, tool: null, clarify: null, confidence: 0.9, ...over,
});

describe("answer-intent.json: the guard around the model", () => {
  const a = load<A>("answer-intent.json");
  it("is balanced", () => expect([a.filter((x) => x.expect === "answer").length, a.filter((x) => x.expect === "search").length]).toEqual([30, 30]));
  it("turns every message that asks for evidence into a search, and leaves a plain concept question as an answer", () => {
    const wrong = a.filter((x) => checkReading(reading({ language: x.language as "en" }), { message: x.text, ledger: [], year: 2026 }).value.intent !== x.expect).map((x) => x.id + " " + x.text);
    // the guard is a floor, not the model: it may keep a few concept questions as searches (that is the safe side) but must never let a search through as an answer
    const leaked = wrong.filter((w) => a.find((x) => w.startsWith(x.id))?.expect === "search");
    expect(leaked).toEqual([]);
    expect(wrong.length).toBeLessThanOrEqual(3);
  });
});

import { describe, expect, it } from "vitest";
import { MAX_THINK_LINES, applyChatEvent, startAssistant, thinkIsHonest, thinkNumbers, thinkSummary, withThinkLine, type ChatEvent, type ThinkLine } from "@scholar/shared";
import { checked, found, notSure, reading, searchCounts, searched, understoodChat, understoodSearch, understoodTool, writing } from "./think";

/* The Thinking block's lines (M2 of the design PDF "Sodhsetu understanding, follow-ups and MCP"): the templates (chat/think.ts) and the page's reducer for them (packages/shared/src/think.ts). */

const LANGS = ["en", "hi", "hinglish", "other"] as const;
const provider = (ok: boolean, count: number) => ({ ok, count, ms: 1, cached: false });

describe("the honesty rule", () => {
  it("reads the numbers of a line outside its quotes, and a line is honest only when each is one of its counts", () => {
    expect(thinkNumbers("3 of 5 sources answered with 1,234 records")).toEqual([3, 5, 1234]);
    expect(thinkNumbers("Searched for “covid 2019 in 3 states”")).toEqual([]);
    expect(thinkIsHonest({ text: "3 of 5 sources", counts: { a: 3, b: 5 } })).toBe(true);
    expect(thinkIsHonest({ text: "3 of 5 sources", counts: { a: 3 } })).toBe(false);
    expect(thinkIsHonest({ text: "Writing the answer" })).toBe(true);
  });

  it("every template, in every language and over a spread of counts, is honest (a line that is not would be dropped, never sent)", () => {
    const made: (ThinkLine | null)[] = [];
    for (const l of LANGS) {
      made.push(understoodSearch(l, "LoRA for medical VQA after 2020", ["change", "exact_words"]), understoodChat(l), understoodTool(l, "verify"), understoodTool(l, "idea"), notSure(l), searched(l, "glaucoma 2021 screening"), writing(l), writing(l, true));
      for (const n of [0, 1, 2, 12, 1500]) {
        made.push(reading(l, n), checked(l, { claims: n, leftOut: Math.min(n, 1), rewritten: Math.min(n, 2) }));
        for (const final of [false, true]) made.push(found(l, searchCounts({ a: provider(true, n), b: provider(false, 0), c: provider(true, 3) }, n, Math.min(n, 1)), final));
      }
    }
    expect(made.every((x) => x !== null)).toBe(true);
    for (const x of made) expect(thinkIsHonest(x!), x!.text).toBe(true);
  });

  it("the search words and the person's words are quoted, so a year in them is never a number the line states", () => {
    expect(searched("en", "effects of 2020 lockdown")!.text).toBe("Searched for “effects of 2020 lockdown”");
    expect(understoodSearch("en", "papers after 2020", ["change"])!.text).toBe("you are looking for papers on “papers after 2020”");
    // a quote mark inside the words cannot end the quotes early
    expect(thinkNumbers(searched("en", "a ” 2019 b")!.text)).toEqual([]);
  });
});

describe("what each line says", () => {
  it("found: while the sources answer, then what was found, kept and marked", () => {
    const c = searchCounts({ openalex: provider(true, 30), s2: provider(true, 17), crossref: provider(false, 0), pubmed: provider(true, 0), doaj: provider(true, 0) }, 20, 1);
    expect(c).toEqual({ sources: 5, answered: 4, records: 47, kept: 20, retracted: 1 });
    expect(found("en", c, false)!.text).toBe("4 of 5 sources answered, 20 papers so far");
    expect(found("en", c, true)!.text).toBe("4 of 5 sources answered with 47 records; duplicates joined, 20 papers listed; 1 retracted, marked");
    expect(found("en", { ...c, retracted: 0 }, true)!.text).not.toMatch(/retracted/);
    expect(found("en", c, true)!.id).toBe(found("en", c, false)!.id);
  });

  it("checked: claims, kept, left out and shortened", () => {
    expect(checked("en", { claims: 6, leftOut: 1, rewritten: 0 })!.text).toBe("6 claims read against the sentences they cite: 5 kept, 1 left out");
    expect(checked("en", { claims: 1, leftOut: 0, rewritten: 0 })!.text).toBe("1 claim read against the sentences they cite: 1 kept");
  });

  it("speaks the person's language: Hinglish and Hindi templates, English for anything else", () => {
    expect(understoodChat("hinglish")!.text).toBe("baat-cheet, isliye search nahi kiya");
    expect(reading("hi", 12)!.text).toBe("12 सार पढ़ रहा हूँ");
    expect(reading("other", 1)!.text).toBe("Reading 1 abstract");
  });

  it("only the understood line has actions", () => {
    for (const x of [searched("en", "x y"), found("en", searchCounts({}, 0, 0), true), reading("en", 2), writing("en"), checked("en", { claims: 2, leftOut: 0, rewritten: 0 }), notSure("en")]) expect(x!.actions).toBeUndefined();
    expect(understoodChat("en")!.actions).toEqual(["change"]);
  });
});

describe("the page's side: a line by id, and the folded line", () => {
  const think = (over: Partial<ThinkLine>): ChatEvent => ({ type: "think", id: "found", kind: "found", text: "1 of 5 sources answered, 3 papers so far", counts: { answered: 1, sources: 5, kept: 3 }, ...over });
  it("the same id replaces its line in place, a new id is added, and at most twenty are kept", () => {
    let m = startAssistant("a", "q", 1, true);
    m = applyChatEvent(m, think({ id: "understood", kind: "understood", text: "you are looking for papers on “x”", counts: undefined, actions: ["change"] }));
    m = applyChatEvent(m, think({}));
    m = applyChatEvent(m, think({ text: "5 of 5 sources answered, 20 papers so far", counts: { answered: 5, sources: 5, kept: 20 } }));
    expect(m.think!.map((l) => l.id)).toEqual(["understood", "found"]);
    expect(m.think![1]!.text).toBe("5 of 5 sources answered, 20 papers so far");
    let lines: ThinkLine[] = [];
    for (let i = 0; i < 30; i++) lines = withThinkLine(lines, { id: `l${i}`, kind: "note", text: "x" });
    expect(lines).toHaveLength(MAX_THINK_LINES);
  });

  it("an event this build does not know keeps the reply as it was (a newer server never breaks a page)", () => {
    const m = startAssistant("a", "q", 1, true);
    expect(applyChatEvent(m, { type: "brand_new_event", x: 1 } as unknown as ChatEvent)).toBe(m);
  });

  it("a reply that has ended takes no more lines", () => {
    const m = { ...startAssistant("a", "q", 1, true), status: "done" as const };
    expect(applyChatEvent(m, think({}))).toBe(m);
  });

  it("the folded line: the time, the searches and the papers", () => {
    const lines: ThinkLine[] = [{ id: "searched", kind: "searched", text: "Searched for “x”", counts: { queries: 1 } }];
    expect(thinkSummary({ tookMs: 14_200, lines, papers: 20 })).toBe("Thought for 14 s · 1 search · 20 papers");
    expect(thinkSummary({ tookMs: 300, lines: [{ id: "understood", kind: "understood", text: "a conversation, so nothing was searched" }], papers: 0 })).toBe("Thought for 1 s");
    expect(thinkSummary({ lines, papers: 1 })).toBe("Thought · 1 search · 1 paper");
  });
});

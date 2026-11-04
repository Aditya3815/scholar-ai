import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LEFT_OUT_LABEL, NOTE_KINDS, NO_TOPIC_TEXT, findPhrase, noteText, quoted, readingIsQuiet, readingLines, restoreWords, tidyWords, withoutLeft, type MessageReading as Reading, type NoteKind } from "@scholar/shared";

/**
 * The part of the Reading that the page uses (packages/shared/src/reading.ts, docs/design/intent-and-state.md, 3.2, 5.3 and 12b.4): the fixed sentences, the lines built from a Reading, the rule that a Reading with nothing
 * to say draws nothing, and the way a piece that was left out is put back. The words the cleaner takes out are not in this file's subject: they are on the server only (frame.test.ts).
 */
const doc = readFileSync(fileURLToPath(new URL("../../../../docs/design/intent-and-state.md", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
const quiet = (over: Partial<Reading> = {}): Reading => ({ v: 1, source: "rules", topic: "effect of yoga on blood pressure", left: [], notes: [], ...over });

describe("the fixed sentences are the plan's, word for word (5.3)", () => {
  // the plan's English sentence of each note, with {phrase} where the person's own words go
  const PLAN: Record<NoteKind, string> = {
    all: "This box shows the 20 best matches, not every paper.",
    recent: "This search cannot sort by date yet, so “{word}” was left out.",
    count: "“{phrase}” was left out of the words searched.",
    negation: "This search cannot leave a topic out yet, so “{phrase}” was left out of the words. Some papers may still mention it.",
    form: "This box does not make tables or bullet lists yet, so “{phrase}” was left out.",
    order: "An instruction to this box was left out. It only searches for papers.",
    author: "This box cannot filter by author yet, so “{phrase}” was searched as words.",
    venue: "This box cannot filter by journal or institution yet, so “{phrase}” was searched as words.",
    threshold: "This box cannot apply a number such as a sample size yet, so “{phrase}” was left out of the words.",
    prove: "This box lists papers on the topic. It does not look for papers that prove one side, so “{phrase}” was left out.",
    person: "Your personal details (such as “I”, “my” and your age) were left out of the words searched; a condition or medicine you named is still searched.",
  };
  it.each(NOTE_KINDS.map((k) => [k]))("%s: the sentence is in the plan, and is what the page says", (kind) => {
    // (a boolean, so that a failure does not print the whole plan)
    expect(doc.includes(PLAN[kind]), `${kind}: not in the plan`).toBe(true);
    const said = noteText({ kind, phrase: "PHRASE" });
    // (the plan's sentence already holds the curly quotes: only the braces are filled)
    expect(said, kind).toBe(PLAN[kind].replace("{phrase}", "PHRASE").replace("{word}", "PHRASE"));
  });
  it("the label and the question are the plan's: 'Left out: {phrases}.' and S-NO-TOPIC", () => {
    expect(doc.includes("**S-LEFT-OUT:** Left out: {phrases}.")).toBe(true);
    expect(LEFT_OUT_LABEL).toBe("Left out:");
    expect(doc.includes("What would you like to look up? Write a topic, for example “screen time and sleep in children”.")).toBe(true);
    expect(NO_TOPIC_TEXT).toBe("What would you like to look up? Write a topic, for example “screen time and sleep in children”.");
  });
  it("a sentence that names a piece of the message is not given when it has none (nothing is guessed)", () => {
    for (const kind of ["recent", "count", "negation", "form", "author", "venue", "threshold", "prove"] as const) expect(noteText({ kind }), kind).toBeNull();
    expect(noteText({ kind: "all" })).toBeTypeOf("string");
    expect(noteText({ kind: "order" })).toBeTypeOf("string");
    expect(noteText({ kind: "person" })).toBeTypeOf("string");
  });
  it("only the closed list of kinds has a sentence", () => {
    expect([...NOTE_KINDS]).toEqual(["all", "recent", "count", "negation", "form", "order", "author", "venue", "threshold", "prove", "person"]);
    expect(noteText({ kind: "made-up" as never, phrase: "x" })).toBeUndefined();
  });
});

describe("a Reading with nothing to say draws nothing (12b.4)", () => {
  it("empty left and notes, no assumption, no suggestion, no years, no count, and the topic is the message: no chip and no sentence", () => {
    const r = quiet();
    expect(readingLines(r)).toEqual({ left: [], notes: [] });
    expect(readingIsQuiet(r, "effect of yoga on blood pressure")).toBe(true);
    expect(readingIsQuiet(r, "  effect of   yoga on blood pressure ")).toBe(true);
  });
  it("any one of the six fields, or a topic that is not the message, is something to say", () => {
    expect(readingIsQuiet(quiet({ left: ["Please"] }), "effect of yoga on blood pressure")).toBe(false);
    expect(readingIsQuiet(quiet({ notes: [{ kind: "all" }] }), "effect of yoga on blood pressure")).toBe(false);
    expect(readingIsQuiet(quiet({ assumed: [{ from: "a", to: "b", why: "spelling" }] }), "effect of yoga on blood pressure")).toBe(false);
    expect(readingIsQuiet(quiet({ suggested: [{ from: "a", to: "b" }] }), "effect of yoga on blood pressure")).toBe(false);
    expect(readingIsQuiet(quiet({ years: { from: 2020 } }), "effect of yoga on blood pressure")).toBe(false);
    expect(readingIsQuiet(quiet({ count: 5 }), "effect of yoga on blood pressure")).toBe(false);
    expect(readingIsQuiet(quiet(), "please effect of yoga on blood pressure")).toBe(false);
  });
  it("the lines are the pieces and the sentences, in order, and nothing else", () => {
    const r = quiet({ topic: "yoga", left: ["top 5 papers on", "in a table"], notes: [{ kind: "count", phrase: "top 5" }, { kind: "form", phrase: "in a table" }, { kind: "all" }] });
    const lines = readingLines(r);
    expect(lines.left).toEqual(["top 5 papers on", "in a table"]);
    expect(lines.notes).toEqual([noteText({ kind: "count", phrase: "top 5" }), noteText({ kind: "form", phrase: "in a table" }), noteText({ kind: "all" })]);
  });
});

describe("a line is true of its Reading: every word, number and year in it is a field of it or a fixed word (the reading-line-true property)", () => {
  // a small deterministic generator (a linear congruential one), so that the test is the same on every run
  let seed = 7;
  const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
  const WORDS = ["yoga", "blood", "pressure", "rice", "wheat", "children", "table", "5", "1000", "2019", "Hinton", "India", "sample", "size", "papers"];
  const phrase = () => Array.from({ length: 1 + rnd(4) }, () => WORDS[rnd(WORDS.length)]!).join(" ");
  it("over 300 random Readings", () => {
    for (let i = 0; i < 300; i++) {
      const notes = Array.from({ length: rnd(5) }, () => ({ kind: NOTE_KINDS[rnd(NOTE_KINDS.length)]!, phrase: phrase() }));
      const r = quiet({ left: Array.from({ length: rnd(4) }, phrase), notes });
      const lines = readingLines(r);
      // the chips are the pieces, exactly
      expect(lines.left).toEqual(r.left);
      // each sentence is one the plan wrote, with the note's own phrase in its braces: remove the phrase and what is left holds no word and no digit that is not a fixed word of the plan's sentences
      const sentences = r.notes.flatMap((n) => noteText(n) ?? []);
      expect(lines.notes).toEqual(sentences);
      for (const [j, s] of sentences.entries()) {
        const n = r.notes.filter((x) => noteText(x) !== null)[j]!;
        const rest = n.phrase === undefined ? s : s.replace(quoted(n.phrase), "");
        // the only digits in the fixed words are the "20" of "the 20 best matches"
        expect(rest.replace("20 best matches", "")).not.toMatch(/\d/);
      }
    }
  });
});

describe("a piece put back, and the tidy that makes a topic", () => {
  it("tidyWords: white space once, no mark at either end that only held a piece in place, a full stop kept for an abbreviation", () => {
    expect(tidyWords("  yoga ,  and blood pressure ?  ")).toBe("yoga , and blood pressure");
    expect(tidyWords(", yoga and blood pressure.")).toBe("yoga and blood pressure");
    expect(tidyWords("policy in the U.S.")).toBe("policy in the U.S.");
    expect(tidyWords("work by Smith et al.")).toBe("work by Smith et al.");
    expect(tidyWords(".NET security")).toBe(".NET security");
  });
  it("findPhrase finds a whole word, not a piece of one ('my' is not in 'myocardial'), and skips a Roman numeral I", () => {
    expect(findPhrase("myocardial infarction and my father", "my", 0)).toBe("myocardial infarction and my father".indexOf(" my ") + 1);
    expect(findPhrase("type I diabetes, can I eat rice", "I", 0)).toBe(21);
    expect(findPhrase("aspirin", "I", 0)).toBe(-1);
  });
  it("withoutLeft takes the pieces out in order (the same piece twice is two places), and a piece that is not there is null", () => {
    expect(withoutLeft("Please find papers on yoga please", ["Please", "find papers on", "please"])).toBe("yoga");
    expect(withoutLeft("I take X, can I take Y", ["I", "I"])).toBe("take X, can take Y");
    expect(withoutLeft("yoga", ["Please"])).toBeNull();
  });
  it("restoreWords puts back one piece and leaves the others out", () => {
    const text = "Please find papers on yoga and blood pressure, thanks";
    const left = ["Please find papers on", "thanks"];
    expect(withoutLeft(text, left)).toBe("yoga and blood pressure");
    expect(restoreWords(text, left, 0)).toBe("Please find papers on yoga and blood pressure");
    expect(restoreWords(text, left, 1)).toBe("yoga and blood pressure, thanks");
    expect(restoreWords(text, left, 5)).toBe("yoga and blood pressure");
  });
});

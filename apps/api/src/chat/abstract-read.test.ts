import { describe, expect, it } from "vitest";
import { ABSTRACT_READ_CHARS, MAX_TIGHTEN_ABSTRACT, abstractRead, splitSentences } from "@scholar/shared";
import { abstractOf, shownSentence } from "./evidence";

const sentence = (i: number, len = 120) => `Sentence number ${i} says something about the study and its ${"very ".repeat(Math.max(0, Math.floor((len - 50) / 5)))}results.`;
const longText = (n: number, len = 120) => Array.from({ length: n }, (_, i) => sentence(i + 1, len)).join(" ");

describe("abstractRead: how much of an abstract the model reads", () => {
  it("reads 3,000 characters, about what 95 in 100 real abstracts need (measured on 239 abstracts from 41 real searches, 31 Oct 2026)", () => {
    expect(ABSTRACT_READ_CHARS).toBe(3000);
  });

  it("gives a short abstract back exactly as it is, and nothing for no abstract", () => {
    const short = "Background: one.  Methods: two.\nResults: three.";
    expect(abstractRead(short)).toBe(short);
    expect(abstractRead("")).toBe("");
    expect(abstractRead(null)).toBe("");
    expect(abstractRead(undefined)).toBe("");
    const exact = "a".repeat(ABSTRACT_READ_CHARS);
    expect(abstractRead(exact)).toBe(exact);
  });

  it("cuts a long one after a whole sentence, never inside one, and never over the limit", () => {
    const text = longText(60);
    expect(text.length).toBeGreaterThan(ABSTRACT_READ_CHARS);
    const read = abstractRead(text);
    expect(read.length).toBeLessThanOrEqual(ABSTRACT_READ_CHARS);
    expect(read.length).toBeGreaterThan(ABSTRACT_READ_CHARS - 300);
    expect(read.endsWith("results.")).toBe(true);
    const all = splitSentences(text);
    expect(splitSentences(read)).toEqual(all.slice(0, splitSentences(read).length));
  });

  it("keeps the numbers of the sentences: sentence k of what is read is sentence k of the whole abstract", () => {
    const text = longText(60);
    const read = splitSentences(abstractRead(text));
    const all = splitSentences(text);
    read.forEach((s, i) => expect(s).toBe(all[i]));
  });

  it("is steady: reading what was read changes nothing", () => {
    const once = abstractRead(longText(80));
    expect(abstractRead(once)).toBe(once);
    expect(splitSentences(once)).toEqual(splitSentences(abstractRead(once)));
  });

  it("does not take an abbreviation for the end of a sentence", () => {
    // the cut falls right after "et al." in the whole abstract: that is not where a sentence ends
    const filler = longText(22, 130);
    const text = `${filler} The trial of Smith et al. reported a clear benefit for the patients who were treated.`;
    for (let pad = 0; pad < 40; pad++) {
      const t = `${"x".repeat(pad)} ${text} ${longText(10)}`;
      const read = abstractRead(t);
      expect(read.endsWith("et al.")).toBe(false);
      expect(read.length).toBeLessThanOrEqual(ABSTRACT_READ_CHARS);
    }
  });

  it("cuts a very long abstract with no sentence end at the limit, as it always did", () => {
    const run = "word ".repeat(2000);
    expect(abstractRead(run).length).toBeLessThanOrEqual(ABSTRACT_READ_CHARS);
    expect(abstractRead(run).length).toBeGreaterThan(ABSTRACT_READ_CHARS - 10);
  });

  it("keeps the first sentence even when it alone is longer than the limit", () => {
    const first = `${"clause ".repeat(700)}ends here.`;
    const read = abstractRead(`${first} Another sentence follows.`);
    expect(read.length).toBeLessThanOrEqual(ABSTRACT_READ_CHARS);
    expect(read.startsWith("clause clause")).toBe(true);
  });

  it("reads a Hindi abstract by its danda, and the structured abstracts with their headings", () => {
    const hindi = Array.from({ length: 120 }, (_, i) => `यह वाक्य संख्या ${i + 1} है और अध्ययन के बारे में कुछ बताता है।`).join(" ");
    const r = abstractRead(hindi);
    expect(r.length).toBeLessThanOrEqual(ABSTRACT_READ_CHARS);
    expect(r.endsWith("।")).toBe(true);
    const structured = `BACKGROUND: ${longText(8)} METHODS: ${longText(8)} RESULTS: ${longText(10)} CONCLUSIONS: The treatment worked.`;
    expect(abstractRead(structured).length).toBeLessThanOrEqual(ABSTRACT_READ_CHARS);
  });

  it("never throws, whatever it is given", () => {
    for (const v of ["", " ", "\n\n", "....", "a", "ऀ", "😀".repeat(5000), "x. ".repeat(5000)]) expect(() => abstractRead(v)).not.toThrow();
  });
});

describe("the writer, the judge and the strict check read the same text", () => {
  const paper = (abstract: string) => ({ id: "p", doi: null, pmid: null, title: "T", authors: [], year: 2020, venue: null, abstract, citationCount: null, oaUrl: null, retracted: false, sources: [] }) as never;

  it("abstractOf is abstractRead of the paper's abstract", () => {
    const text = longText(60);
    expect(abstractOf(paper(text))).toBe(abstractRead(text));
    expect(abstractOf(paper(null as never))).toBe("");
  });

  it("a sentence near the end of a long abstract (the conclusions) can be shown as evidence, and one beyond the limit cannot", () => {
    const text = `${longText(18, 125)} CONCLUSIONS: The programme reduced admissions by a third. ${longText(30)}`;
    const read = splitSentences(abstractRead(text));
    const k = read.findIndex((s) => s.includes("reduced admissions"));
    expect(k).toBeGreaterThan(15);
    expect(text.indexOf("reduced admissions")).toBeGreaterThan(1500); // beyond where the old limit stopped
    expect(shownSentence(paper(text), k + 1)).toContain("reduced admissions by a third");
    expect(shownSentence(paper(text), read.length + 1)).toBe("");
  });

  it("the strict check accepts what the browser sends: an abstract cut by the same function fits the server's limit", () => {
    expect(MAX_TIGHTEN_ABSTRACT).toBeGreaterThanOrEqual(ABSTRACT_READ_CHARS);
    for (const n of [5, 30, 60, 200]) expect(abstractRead(longText(n)).length).toBeLessThanOrEqual(MAX_TIGHTEN_ABSTRACT);
  });
});

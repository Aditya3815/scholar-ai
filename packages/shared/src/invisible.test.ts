import { describe, expect, it } from "vitest";
import { answerCopy } from "./chat-copy";
import { startAssistant, type AssistantMsg } from "./chat-state";
import type { Paper } from "./index";
import { oneLine, stripInvisible } from "./text";

/**
 * One list of the characters that show nothing (untangle F3, bug B19): the server reading the history, the page building what it sends and "Copy the answer" take out the same characters, the
 * Arabic letter mark U+061C among them (the copy's own list lacked it).
 */
const cp = (...n: number[]) => String.fromCodePoint(...n);
const paper = (title: string): Paper => ({ id: "doi:10.1/x", doi: "10.1/x", pmid: null, title, authors: ["A. Rao"], year: 2020, venue: "J", abstract: null, citationCount: null, oaUrl: null, retracted: false, retractionSources: [], sources: ["openalex"], score: 1 });
const done = (papers: Paper[]): AssistantMsg => ({ ...startAssistant("a1", "q", 1), status: "done", papers, papersFinal: true });

describe("one invisible-character list (B19)", () => {
  it("Copy the answer takes out U+061C as the server does", () => {
    const copied = answerCopy(done([paper(`Water${cp(0x061c)} in Delhi`)]))!.text;
    expect(copied).toContain("Water in Delhi");
    expect(copied).not.toContain(cp(0x061c));
  });

  it("takes out every character of the list, and keeps the two joiners Hindi is written with", () => {
    const invisible = [0x061c, 0x200b, 0x200e, 0x200f, 0x202a, 0x202c, 0x202e, 0x2060, 0x2061, 0x2064, 0x2066, 0x2069, 0xfeff, 0xe0001, 0xe007f];
    for (const c of invisible) expect(stripInvisible(`a${cp(c)}b`)).toBe("ab");
    expect(stripInvisible(`क${cp(0x094d, 0x200d)}ष`)).toBe(`क${cp(0x094d, 0x200d)}ष`);
    expect(stripInvisible(`a${cp(0x200c)}b`)).toBe(`a${cp(0x200c)}b`);
  });

  it("makes one line of a record's field, with the C1 controls too when asked", () => {
    expect(oneLine(` a\n\tb${cp(0x200b)}c `)).toBe("a bc");
    expect(oneLine(`a${cp(0x85)}b${cp(0x90)}c`)).toBe(`a${cp(0x85)}b${cp(0x90)}c`);
    expect(oneLine(`a${cp(0x85)}b${cp(0x90)}c${cp(0x2028)}d`, { c1: true })).toBe("a b c d");
  });
});

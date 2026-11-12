import { describe, expect, it } from "vitest";
import { cutWhole, flatLine, isCount, isInt, oneLine, plainLine, squash, stripInvisible } from "@scholar/shared";

/*
 * The copies that F3 replaced by the one toolkit of shared text.ts (docs/design/untangle.md, F3), frozen as they were at 5d2cb3c, against the toolkit, over every code point and over texts built to
 * hit the edges (joiners, marks, surrogate pairs, conjuncts, runs of space). Where the copies differed on purpose, the toolkit's named option is compared with the copy it replaces; the two places
 * where the change is a bug fix (B19: U+061C and, for the server, the invisible operators) are written out. A test of the change, not of the product: it goes in the tests pass (4.2).
 */

const cp = (...n: number[]) => String.fromCodePoint(...n);

// ---- frozen copies
const historyInvisible = /[؜​‎‏⁠‪-‮⁦-⁩﻿\u{E0000}-\u{E007F}]/gu; // apps/api/src/chat/history.ts
const historyFlat = (s: string) => s.replace(historyInvisible, "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
const pageInvisible = new RegExp(`[${[0x061c, 0x200b, 0x200e, 0x200f, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0xfeff].map((c) => cp(c)).join("")}${cp(0x202a)}-${cp(0x202e)}${cp(0x2066)}-${cp(0x2069)}${cp(0xe0000)}-${cp(0xe007f)}]`, "gu"); // shared/chat-state.ts
const pageOneLine = (s: string) => s.replace(pageInvisible, "").replace(new RegExp(`[${cp(0)}-${cp(0x1f)}${cp(0x7f)}]`, "g"), " ").replace(/\s+/g, " ").trim();
const copyInvisible = /[​‎‏‪-‮⁠-⁤⁦-⁩﻿\u{E0000}-\u{E007F}]/gu; // shared/chat-copy.ts
const copyPlain = (s: string) => s.replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, " ").replace(copyInvisible, "").replace(/\s+/g, " ").trim();
const controlsLine = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim(); // router.ts oneLine, chat.ts, documents.ts, litscan.ts, notes-md.ts
const understandLine = (s: string) => s.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g, " ").replace(/\s+/g, " ").trim(); // understanding.ts plainLine
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
function cutChars(s: string, max: number): string {
  // apps/api/src/chat/history.ts
  if (max <= 0) return "";
  if (s.length <= max) return s;
  let out = "";
  for (const part of (function* () { for (const x of graphemes.segment(s)) yield x.segment; })()) {
    if (out.length + part.length > max) break;
    out += part;
  }
  return out;
}
const oldIsInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const oldIsCount = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;

// ---- the texts
/** Every code point but the surrogates, 64 to a text, each followed by "x" (so that a character's own effect shows, and runs of white space and controls are met too). */
function* everyCodePoint(): Generator<string> {
  let chunk = "";
  for (let c = 0; c <= 0x10ffff; c++) {
    if (c >= 0xd800 && c <= 0xdfff) continue;
    chunk += cp(c) + (c % 3 === 0 ? "x" : "");
    if (c % 64 === 63) {
      yield chunk;
      chunk = "";
    }
  }
  if (chunk) yield chunk;
}
const edges = [
  "", " ", "  a  ", "a\n\tb\r\nc", `a${cp(0x200c)}b${cp(0x200d)}c`, `क${cp(0x94d, 0x200d)}ष`, `नमस्ते${cp(0x200b)} दुनिया`, `x${cp(0x85)}y${cp(0x2028)}z${cp(0x2029)}`,
  `a${cp(0x1f600)}b${cp(0x1f469, 0x200d, 0x1f4bb)}c`, `e${cp(0x301).repeat(40)}f`, `${cp(0x202e)}abc${cp(0x202c)}`, `tag${cp(0xe0041, 0xe0042)}s`, "a\u0000b\u001fc\u007fd\u0090e",
  `${cp(0x1f1ee, 0x1f1f3, 0x1f1ee, 0x1f1f3)} flags`, "ab".repeat(300), `${"क्षत्रिय ".repeat(80)}`, `${cp(0xd83d)}lone`, `${cp(0x61c)}arabic mark`, `${cp(0x2061)}${cp(0x2064)}ops`,
];

describe("the toolkit gives what each copy gave (F3)", { timeout: 120_000 }, () => {
  it("oneLine is the page's oneLine, and the server's flat apart from the invisible operators U+2061 to U+2064 (one list, B19)", () => {
    const ops = /[⁡-⁤]/u;
    for (const s of [...everyCodePoint(), ...edges]) {
      expect(oneLine(s)).toBe(pageOneLine(s));
      if (!ops.test(s)) expect(oneLine(s)).toBe(historyFlat(s));
    }
    expect(historyFlat(`a${cp(0x2061)}b`)).toBe(`a${cp(0x2061)}b`);
    expect(oneLine(`a${cp(0x2061)}b`)).toBe("ab");
  });

  it("oneLine with c1 is Copy the answer's field cleaner, apart from U+061C (B19)", () => {
    for (const s of [...everyCodePoint(), ...edges]) if (!s.includes(cp(0x61c))) expect(oneLine(s, { c1: true })).toBe(copyPlain(s));
    expect(copyPlain(`a${cp(0x61c)}b`)).toBe(`a${cp(0x61c)}b`);
    expect(oneLine(`a${cp(0x61c)}b`, { c1: true })).toBe("ab");
  });

  it("stripInvisible is the server's list and the page's list", () => {
    for (const s of everyCodePoint()) expect(stripInvisible(s)).toBe(s.replace(pageInvisible, ""));
  });

  it("flatLine, squash and plainLine are the copies they replace", () => {
    for (const s of [...everyCodePoint(), ...edges]) {
      expect(flatLine(s)).toBe(controlsLine(s));
      expect(squash(s)).toBe(s.replace(/\s+/g, " ").trim());
      expect(plainLine(s)).toBe(understandLine(s));
    }
  });

  it("cutWhole is the server's cutChars at every length", () => {
    for (const s of edges) for (let max = -1; max <= s.length + 2; max++) expect(cutWhole(s, max)).toBe(cutChars(s, max));
  });

  it("isInt and isCount are the copies", () => {
    for (const v of [0, 1, -1, 1.5, NaN, Infinity, -Infinity, 1e9, 1e9 + 1, "1", null, undefined, {}, -0]) {
      expect(isInt(v)).toBe(oldIsInt(v));
      expect(isCount(v)).toBe(oldIsCount(v));
      expect(isCount(v, 1e9)).toBe(oldIsCount(v) && (v as number) <= 1e9);
    }
  });
});

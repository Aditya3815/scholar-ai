import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MAX_NOTICE_WORDS, fewNotice, noneCloseNotice } from "./tiers-text";

/**
 * The two fixed sentences of the poor-results states (docs/design/intent-and-state.md, 5.4: S-FEW and S-NONE-CLOSE, with the owner's wording of 12b.5: no exact match, these are related). Code fills
 * only the number and the words; no model writes any of it. They are pinned to the plan's own text, which this test reads from the plan, so that a changed word is seen.
 */
const plan = readFileSync(fileURLToPath(new URL("../../../../docs/design/intent-and-state.md", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
const LQ = String.fromCodePoint(0x201c);
const RQ = String.fromCodePoint(0x201d);

describe("the sentences are the plan's", () => {
  it("S-NONE-CLOSE in English and in Hinglish is the plan's text with the words filled in", () => {
    const en = `No paper matches ${LQ}{words}${RQ} closely. These are the nearest records and may be off topic. Check the spelling, or try fewer or different words.`;
    const hi = `Koi paper ${LQ}{words}${RQ} se achhe se nahi milta. Ye sabse paas ke records hain aur topic se alag ho sakte hain. Spelling dekh lijiye, ya kam ya alag shabd likhiye.`;
    expect(plan).toContain(`**S-NONE-CLOSE** (\`weak\`): ${en} / ${hi}`);
    expect(noneCloseNotice("convoluton nueral netwrk", "en")).toBe(en.replace("{words}", "convoluton nueral netwrk"));
    expect(noneCloseNotice("diabetes me exercise", "hinglish")).toBe(hi.replace("{words}", "diabetes me exercise"));
  });

  it("S-FEW says the same in the plan's words; one paper takes the singular verb, which the plan's {n} sentence does not have", () => {
    const en = "Only {n} of these papers match your words closely. The others are weaker matches and are listed after them.";
    const hi = "In papers mein se sirf {n} aapke shabdon se achhe se milte hain. Baaki kamzor matches hain aur unke baad diye gaye hain.";
    expect(plan).toContain(`**S-FEW** (\`weak\`): ${en} / ${hi}`);
    expect(fewNotice(2, "en")).toBe(en.replace("{n}", "2"));
    expect(fewNotice(1, "en")).toBe("Only 1 of these papers matches your words closely. The others are weaker matches and are listed after them.");
    expect(fewNotice(2, "hinglish")).toBe(hi.replace("{n}", "2"));
    expect(fewNotice(1, "hinglish")).toBe(hi.replace("{n}", "1"));
  });

  it("Hindi has no sentence of its own (the plan leaves it to the native reader): it is given the Hinglish one, never the English one, as the safety lane does", () => {
    expect(noneCloseNotice("diabetes exercise", "hi")).toBe(noneCloseNotice("diabetes exercise", "hinglish"));
    expect(fewNotice(2, "hi")).toBe(fewNotice(2, "hinglish"));
  });

  it("an unknown language is English", () => {
    expect(noneCloseNotice("tuberculosis", "xx" as never)).toBe(noneCloseNotice("tuberculosis", "en"));
  });
});

describe("the words of the person are shown as they are, tidied, and never as anything but text", () => {
  it("white space and control characters become single spaces, and the words are cut at a word boundary, with an ellipsis, at the limit", () => {
    expect(noneCloseNotice("  convoluton \n\t nueral\u0000 netwrk  ", "en")).toContain(`${LQ}convoluton nueral netwrk${RQ}`);
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const out = noneCloseNotice(long, "en");
    const shown = out.slice(out.indexOf(LQ) + 1, out.indexOf(RQ));
    expect(shown.length).toBeLessThanOrEqual(MAX_NOTICE_WORDS + 1);
    expect(shown.endsWith("…")).toBe(true);
    expect(long.startsWith(shown.slice(0, -1).trimEnd())).toBe(true);
    // a cut never ends inside a word
    expect(long.split(" ")).toContain(shown.slice(0, -1).trimEnd().split(" ").at(-1));
  });
  it("words that fit are not cut, at exactly the limit too", () => {
    const exact = "a".repeat(MAX_NOTICE_WORDS);
    expect(noneCloseNotice(exact, "en")).toContain(`${LQ}${exact}${RQ}`);
    expect(noneCloseNotice(exact + "b", "en")).toContain("…");
  });
  it("one very long word is cut at the limit (there is no boundary to cut at)", () => {
    const out = noneCloseNotice("x".repeat(500), "en");
    expect(out.length).toBeLessThan(300);
  });
  it("the words are text: markup in them stays markup characters in a string, and quote marks of their own do not end the quotation early", () => {
    const out = noneCloseNotice(`<img src=x onerror=1> ${RQ} ${LQ}`, "en");
    expect(out).toContain("<img src=x onerror=1>");
    expect(typeof out).toBe("string");
  });
  it("the number in S-FEW is a whole number from 1 to 2 as it is called, and is the only digit the sentence holds", () => {
    for (const n of [1, 2]) expect(fewNotice(n, "en").replace(String(n), "")).not.toMatch(/\p{N}/u);
    expect(noneCloseNotice("tuberculosis", "en")).not.toMatch(/\p{N}/u);
  });
});

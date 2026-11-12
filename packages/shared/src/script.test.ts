import { describe, expect, it } from "vitest";
import { citeParts, devanagariShare, textAttrs, textLang } from "@scholar/shared";

/* docs/design/chatview-and-trending.md, C5 and C6: which language a message is written in (so that the page tells the browser and a screen reader: WCAG 3.1.2), and how the marks of an answer ("[1]")
   are held to the word before them and the stop after them (so a mark never stands alone at the start of a line, and never leaves its full stop behind). Both are pure and live in packages/shared. */

describe("textLang: Devanagari is marked hi only when its letters are most of the letters", () => {
  it("marks a Hindi question", () => {
    expect(textLang("ग्रामीण क्लिनिकों में ग्लूकोमा की जांच कैसे हो सकती है?")).toBe("hi");
  });

  it("leaves Hinglish in Latin letters alone: no voice reads it as Hindi, so it stays the page's own language", () => {
    expect(textLang("climate change ka farmers par asar kya hai")).toBeUndefined();
    expect(textLang("diabetes me exercise ka kya asar hota hai")).toBeUndefined();
  });

  it("leaves English alone", () => {
    expect(textLang("glaucoma screening in rural clinics")).toBeUndefined();
  });

  it("marks a mixed sentence when the Devanagari letters are the majority, not otherwise", () => {
    expect(textLang("AI के बारे में बताइए")).toBe("hi");
    expect(textLang("glaucoma screening ग्लूकोमा")).toBeUndefined();
  });

  it("counts a Devanagari vowel sign and the virama with their letter (they are marks, not letters): a Hindi sentence with English words in it is still Hindi", () => {
    // each of these has most of its WORDS in Devanagari; before the marks were counted a Devanagari letter cost 1.5 code points and counted once, so each was left as English (reviewer, 4 Nov 2026)
    expect(textLang("मुझे COVID-19 और mRNA vaccine के बारे में बताइए")).toBe("hi");
    expect(textLang("diabetes में exercise का क्या असर होता है")).toBe("hi");
    expect(textLang("Machine learning का इस्तेमाल कैसे करें")).toBe("hi");
  });

  it("...and a sentence with more Latin letters than Devanagari ones stays English, however Hindi its ending", () => {
    expect(textLang("CRISPR off-target effects के बारे में बताइए")).toBeUndefined();
    expect(textLang("glaucoma screening in rural clinics में")).toBeUndefined();
  });

  it("a Latin letter written as a letter and an accent (decomposed) is still Latin", () => {
    expect(textLang("café culture in rural India".normalize("NFD"))).toBeUndefined();
  });

  it("needs MORE than half: exactly half is not a majority", () => {
    expect(textLang("ab कख")).toBeUndefined();
    expect(textLang("ab कखग")).toBe("hi");
  });

  it("counts letters only: digits, Devanagari digits, signs and spaces are not letters", () => {
    expect(textLang("")).toBeUndefined();
    expect(textLang("   ")).toBeUndefined();
    expect(textLang("1234 ,.;")).toBeUndefined();
    expect(textLang("१२३ ।")).toBeUndefined();
    // 88 and 0.94 and AUC inside a Hindi sentence do not take the sentence away from Hindi
    expect(textLang("संवेदनशीलता 88 प्रतिशत रही, AUC 0.94")).toBe("hi");
  });

  it("looks at the start of a long text only (an abstract is a thousand characters): the first 600 characters decide", () => {
    expect(textLang(`${"क".repeat(700)}${"a".repeat(5000)}`)).toBe("hi");
    expect(textLang(`${"a".repeat(700)}${"क".repeat(5000)}`)).toBeUndefined();
  });

  it("is not fooled by other scripts", () => {
    expect(textLang("机器学习的研究")).toBeUndefined();
    expect(textLang("مرحبا بالعالم")).toBeUndefined();
  });

  it("handles text that is not a string, and a broken surrogate at the cut, without throwing", () => {
    expect(textLang(undefined as unknown as string)).toBeUndefined();
    expect(textLang(null as unknown as string)).toBeUndefined();
    expect(() => textLang(`${"a".repeat(599)}\ud83d`)).not.toThrow();
  });

  it("devanagariShare is the figure the choice is made from", () => {
    expect(devanagariShare("कख")).toBe(1);
    expect(devanagariShare("ab कख")).toBe(0.5);
    expect(devanagariShare("abc")).toBe(0);
    expect(devanagariShare("")).toBe(0);
  });
});

describe("textAttrs: what an element is given", () => {
  it("gives lang and dir auto for Hindi, nothing for the rest", () => {
    expect(textAttrs("ग्रामीण क्लिनिकों में")).toEqual({ lang: "hi", dir: "auto" });
    expect(textAttrs("rural clinics")).toEqual({});
    expect(textAttrs("")).toEqual({});
  });

  it("always gives dir auto when asked (what a person typed may be in a script that runs from the right), and lang only for Hindi", () => {
    expect(textAttrs("rural clinics", true)).toEqual({ dir: "auto" });
    expect(textAttrs("ग्रामीण क्लिनिकों में", true)).toEqual({ lang: "hi", dir: "auto" });
  });
});

describe("citeParts: the marks of an answer, each held to the word before it and the stop after it", () => {
  const plain = (parts: ReturnType<typeof citeParts>) => parts.map((p) => (p.n === undefined ? p.text : `<${p.before}|${p.n}|${p.after}>`)).join("");

  it("keeps the word and the full stop with the mark, and the rest of the text as it was", () => {
    const parts = citeParts("The first paper reports its main result [1]. A second paper describes the work [2].");
    expect(plain(parts)).toBe("The first paper reports its main <result|1|.> A second paper describes the <work|2|.>");
  });

  it("changes no character of the text: the parts read back the same, with each mark as [n]", () => {
    const text = "One [1]. Two [2], three [3]; four [1][2] five (see [3]) six [12]! Seven [4] ।";
    const back = citeParts(text).map((p) => (p.n === undefined ? p.text : `${p.before}${p.gap}[${p.n}]${p.after}`)).join("");
    expect(back).toBe(text);
  });

  it("holds the stops that follow, whatever they are: . , ; : ! ? ) and the Devanagari danda", () => {
    expect(plain(citeParts("a [1]. b"))).toBe("<a|1|.> b");
    expect(plain(citeParts("a [1], b"))).toBe("<a|1|,> b");
    expect(plain(citeParts("a [1]; b"))).toBe("<a|1|;> b");
    expect(plain(citeParts("a [1]: b"))).toBe("<a|1|:> b");
    expect(plain(citeParts("(a [1]) b"))).toBe("<(a|1|)> b");
    expect(plain(citeParts("रहा [1]। अगला"))).toBe("<रहा|1|।> अगला");
    // a word that follows is not a stop
    expect(plain(citeParts("a [1] b"))).toBe("<a|1|> b");
  });

  it("a mark with no word before it (the start of the text, or right after another mark) stands on its own", () => {
    expect(plain(citeParts("[1] is first"))).toBe("<|1|> is first");
    expect(citeParts("x [1][2]").filter((p) => p.n !== undefined).map((p) => p.before)).toEqual(["x", ""]);
  });

  it("only [n] of one or two digits is a mark; anything else is text", () => {
    expect(citeParts("a [123] b [x] c [] d")).toEqual([{ text: "a [123] b [x] c [] d" }]);
  });

  it("a text with no mark is one part, and an empty text is none", () => {
    expect(citeParts("no marks here")).toEqual([{ text: "no marks here" }]);
    expect(citeParts("")).toEqual([]);
  });

  it("an unbroken word of any length stays a word of its own: it is the part that may break, the mark only follows it", () => {
    const word = "dichlorodiphenyltrichloroethane";
    const parts = citeParts(`Residues of ${word} [1].`);
    const mark = parts.find((p) => p.n !== undefined);
    expect(mark?.before).toBe(word);
  });
});

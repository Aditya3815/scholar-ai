import { describe, expect, it } from "vitest";
import { chunkPage, clean } from "./chunk";

const sentence = (n: number) => `Sentence number ${n} describes one finding of the study in plain words.`;

describe("chunkPage", () => {
  it("ignores pages with almost no text (page numbers, blanks)", () => {
    expect(chunkPage(3, "  12  ")).toEqual([]);
    expect(chunkPage(3, "")).toEqual([]);
  });

  it("keeps a short page as one chunk with a reading-order index", () => {
    const [c, ...rest] = chunkPage(7, "The model improves recall.\n\nIt does so   cheaply.");
    expect(rest).toEqual([]);
    expect(c).toEqual({ idx: 7000, page: 7, text: "The model improves recall. It does so cheaply." });
  });

  it("splits a long page at sentence boundaries into chunks of about 1000 characters", () => {
    const text = Array.from({ length: 60 }, (_, i) => sentence(i)).join(" ");
    const chunks = chunkPage(2, text);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.text.length <= 1100)).toBe(true);
    expect(chunks.map((c) => c.idx)).toEqual(chunks.map((_, i) => 2000 + i));
    for (const c of chunks.slice(0, -1)) expect(/[.!?]$/.test(c.text)).toBe(true);
  });

  it("overlaps neighbouring chunks so a statement on a boundary is retrievable", () => {
    const chunks = chunkPage(1, Array.from({ length: 40 }, (_, i) => sentence(i)).join(" "));
    const tail = chunks[0]!.text.slice(-60);
    expect(chunks[1]!.text.includes(tail.slice(tail.indexOf(" ") + 1))).toBe(true);
  });

  it("splits a single enormous sentence without cutting words", () => {
    const words = Array.from({ length: 600 }, (_, i) => `word${i}`).join(" ");
    const chunks = chunkPage(1, words);
    expect(chunks.length).toBeGreaterThan(3);
    const joined = chunks.map((c) => c.text).join(" ");
    for (let i = 0; i < 600; i += 97) expect(joined).toContain(`word${i}`);
    for (const c of chunks) for (const w of c.text.split(" ")) expect(w).toMatch(/^word\d+$/);
  });

  it("never splits inside a number or abbreviation, and never loses text", () => {
    const text = "A convolutional network trained on 12,000 images reaches an AUC of 0.94. Sensitivity was higher (p < 0.05) than reported in Fig.2 of the earlier study. Next we describe the cohort in detail.";
    const chunks = chunkPage(1, text);
    const all = chunks.map((c) => c.text).join(" ");
    expect(all).toContain("AUC of 0.94.");
    expect(all).toContain("p < 0.05");
    expect(all).toContain("Fig.2");
    const longText = Array.from({ length: 80 }, (_, i) => `Value ${i}.5 was measured at 0.${i} units. Then e.g. item ${i} followed.`).join(" ");
    const words = new Set(longText.split(/\s+/));
    const got = new Set(chunkPage(1, longText).flatMap((c) => c.text.split(/\s+/)));
    for (const w of words) expect(got.has(w)).toBe(true);
  });

  it("clean removes soft hyphens and collapses whitespace", () => {
    expect(clean("co­operate \n\t now")).toBe("cooperate now");
  });
});

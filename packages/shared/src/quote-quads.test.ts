import { describe, expect, it } from "vitest";
import { quadsForQuote, type TextBox } from "@scholar/shared";

/** A line of text 10 units a character wide, 12 tall, left to right, its baseline box starting at (x, y). */
const line = (str: string, x: number, y: number): TextBox => ({ str, p: [x, y], along: [str.length * 10, 0], up: [0, 12] });
const PAGE = [line("Images were graded by two", 50, 100), line("ophthalmologists and disagreements were", 50, 120), line("resolved by a third.", 50, 140)];

describe("quadsForQuote", () => {
  it("covers a quote inside one piece of text from its first word to its last", () => {
    const q = quadsForQuote(PAGE, "graded by two")!;
    expect(q).toHaveLength(1);
    const [a, b, c, d] = q[0]!;
    expect(a).toEqual([50 + 12 * 10, 100]); // "Images were " is 12 characters: the shape starts at "graded"
    expect(b[0]).toBe(50 + 25 * 10);
    expect(c).toEqual([b[0], 112]);
    expect(d).toEqual([a[0], 112]);
  });
  it("a quote over several lines gives one shape for each: the rest of the first, the whole middle, the start of the last", () => {
    const q = quadsForQuote(PAGE, "graded by two ophthalmologists and disagreements were resolved by")!;
    expect(q).toHaveLength(3);
    expect(q[0]![1][0]).toBe(300); // to the end of "two"
    expect(q[1]![0][0]).toBe(50);
    expect(q[1]![1][0]).toBe(50 + 39 * 10);
    expect(q[2]![0][0]).toBe(50);
    expect(q[2]![1][0]).toBe(50 + "resolved by".length * 10);
  });
  it("finds it although the PDF text differs in case, punctuation and accents", () => {
    expect(quadsForQuote([line("Résumé: Graded—by TWO", 0, 0)], "resume graded by two")).not.toBeNull();
  });
  it("is null when the quote is not on the page, and for an empty page or quote", () => {
    expect(quadsForQuote(PAGE, "a sentence that is nowhere on this page at all")).toBeNull();
    expect(quadsForQuote([], "graded by two")).toBeNull();
    expect(quadsForQuote(PAGE, "")).toBeNull();
  });
  it("works for text turned a quarter round (the vectors carry the direction)", () => {
    const turned: TextBox = { str: "graded by two", p: [20, 10], along: [0, 130], up: [-12, 0] };
    const q = quadsForQuote([turned], "by two")!;
    expect(q[0]![0]).toEqual([20, 10 + 130 * (7 / 13)]);
    expect(q[0]![2][0]).toBe(20 - 12);
  });
  it("skips empty pieces of text", () => {
    expect(quadsForQuote([line("", 0, 0), ...PAGE], "graded by two")).toHaveLength(1);
  });
});

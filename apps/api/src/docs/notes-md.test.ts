import { describe, expect, it } from "vitest";
import { DEFAULT_LEGEND, MAX_LEGEND_CHARS, cleanLegend, isPlainLegend, notesMarkdown, type DocNote } from "@scholar/shared";

const n = (id: string, page: number, color: DocNote["color"], quote: string, note = ""): DocNote => ({ id, page, quote, note, color, createdAt: 1, updatedAt: 1 });
const NOTES = [n("a", 1, "yellow", "The model reached a sensitivity of 91 percent"), n("b", 2, "green", "Images were graded by two\nophthalmologists", "check the grading"), n("c", 3, "yellow", "Limitations include a single country")];

describe("cleanLegend", () => {
  it("keeps good names, cuts long ones, and falls back to the default for anything unusable", () => {
    const l = cleanLegend({ yellow: "  Key   result ", green: "x".repeat(60), blue: "", pink: 42 });
    expect(l.yellow).toBe("Key result");
    expect(l.green).toHaveLength(MAX_LEGEND_CHARS);
    expect(l.blue).toBe(DEFAULT_LEGEND.blue);
    expect(l.pink).toBe(DEFAULT_LEGEND.pink);
  });
  it("never throws on odd input", () => {
    for (const raw of [null, undefined, "x", 5, [], { yellow: { a: 1 } }, "\u0000"]) expect(cleanLegend(raw)).toEqual(expect.objectContaining({ yellow: expect.any(String), pink: expect.any(String) }));
  });
  it("control characters are not kept in a name", () => {
    expect(cleanLegend({ yellow: "a\u0000b\nc" }).yellow).toBe("a b c");
  });
});

describe("notesMarkdown", () => {
  it("lists the quote with its page and the reader's own note, in the order given", () => {
    const md = notesMarkdown("Glaucoma screening", NOTES);
    expect(md.startsWith("# Notes on Glaucoma screening\n\n> The model reached")).toBe(true);
    expect(md).toContain("> Images were graded by two ophthalmologists (p. 2)\n\ncheck the grading");
  });
  it("groups by colour with the reader's own names, in colour order, with counts", () => {
    const md = notesMarkdown("T", NOTES, { groupBy: "colour", legend: { ...DEFAULT_LEGEND, yellow: "Key result", green: "How they did it" } });
    expect(md.indexOf("## Key result (yellow, 2)")).toBeGreaterThan(-1);
    expect(md.indexOf("## How they did it (green, 1)")).toBeGreaterThan(md.indexOf("## Key result"));
    expect(md).not.toContain("## Question");
    expect(md.indexOf("Limitations include")).toBeLessThan(md.indexOf("## How they did it"));
  });
  it("filters by colour", () => {
    const md = notesMarkdown("T", NOTES, { colours: ["green"] });
    expect(md).toContain("two ophthalmologists");
    expect(md).not.toContain("sensitivity");
  });
  it("says so when nothing is left, and a title cannot break the heading", () => {
    expect(notesMarkdown("T", NOTES, { colours: ["pink"] })).toContain("No highlights.");
    expect(notesMarkdown("## Evil\nTitle", [])).toMatch(/^# Notes on Evil Title\n/);
    expect(notesMarkdown("", [])).toMatch(/^# Notes on this paper\n/);
  });
  it("a legend name cannot break a section heading either", () => {
    const md = notesMarkdown("T", NOTES, { groupBy: "colour", legend: { ...DEFAULT_LEGEND, yellow: "# x\n- y" } });
    expect(md).toContain("## x - y (yellow, 2)");
  });
});

describe("plain colour names", () => {
  it("are the default, and a section is headed with the colour and a count", () => {
    expect(DEFAULT_LEGEND).toEqual({ yellow: "Yellow", green: "Green", blue: "Blue", pink: "Pink" });
    const md = notesMarkdown("T", NOTES, { groupBy: "colour" });
    expect(md).toContain("## Yellow (2)");
    expect(md).toContain("## Green (1)");
  });
  it("isPlainLegend tells whether any colour has a name of its own", () => {
    expect(isPlainLegend(DEFAULT_LEGEND)).toBe(true);
    expect(isPlainLegend({ ...DEFAULT_LEGEND, green: "Method" })).toBe(false);
    expect(isPlainLegend(cleanLegend({ yellow: "YELLOW" }))).toBe(true);
  });
});

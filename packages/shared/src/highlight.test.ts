import { describe, expect, it } from "vitest";
import { locateInSpans, mergeLineRects, planNewHighlight, type MarkRect } from "@scholar/shared";

// The user's own example, as the lines of a PDF page: a long highlight with a shorter one inside it.
const SPANS = [
  "pt the yolov8-face model [14]. This open-source project fine-",
  "tunes the YOLOv8 framework [26] specifically for face detection",
  "tasks. The model provides real-time bounding boxes that serve as",
  "the visual anchors required to",
];
const LONG = "pt the yolov8-face model [14]. This open-source project fine-tunes the YOLOv8 framework [26] specifically for face detection tasks. The model provides real-time bounding boxes that serve as the visual anchors required to";
const SHORT = "YOLOv8 framework [26] specifically for face detection";

describe("locateInSpans", () => {
  it("finds a quote that fills several lines: from the first word of the first to the last word of the last", () => {
    const at = locateInSpans(SPANS, LONG)!;
    expect(at.first).toMatchObject({ span: 0, start: 0 });
    expect(at.last).toMatchObject({ span: 3, end: SPANS[3]!.length });
  });

  it("finds a short quote in the middle of a line, and gives the exact characters, not the whole line", () => {
    const at = locateInSpans(SPANS, SHORT)!;
    expect(at.first.span).toBe(1);
    expect(at.last.span).toBe(1);
    expect(SPANS[1]!.slice(at.first.start, at.last.end)).toBe("YOLOv8 framework [26] specifically for face detection");
  });

  it("a quote that starts in the middle of one line and ends in the middle of the next", () => {
    const at = locateInSpans(SPANS, "fine-tunes the YOLOv8 framework [26] specifically for face detection tasks. The model provides")!;
    expect(at.first.span).toBe(0);
    expect(SPANS[0]!.slice(at.first.start)).toBe("fine-");
    expect(at.last.span).toBe(2);
    expect(SPANS[2]!.slice(0, at.last.end)).toBe("tasks. The model provides");
  });

  it("two highlights in one paragraph are two different ranges, one inside the other", () => {
    const a = locateInSpans(SPANS, LONG)!;
    const b = locateInSpans(SPANS, SHORT)!;
    const startsAfter = b.first.span > a.first.span || b.first.start >= a.first.start;
    const endsBefore = b.last.span < a.last.span || b.last.end <= a.last.end;
    expect(startsAfter && endsBefore).toBe(true);
  });

  it("is not thrown by case, punctuation, or an accent", () => {
    expect(locateInSpans(["Résumé of the Étude on naïve methods"], "resume of the etude on naive methods")).not.toBeNull();
    expect(locateInSpans(["Hello, WORLD! this is   spaced"], "hello world this is spaced")).not.toBeNull();
  });

  it("finds the quote even when a word was broken differently by the page (most of the words still run together)", () => {
    expect(locateInSpans(["the quick brown fox jumps over", "the lazy dog near the river bank"], "the quick brown fox jumps over the lazy dog near the river")).not.toBeNull();
  });

  it("returns null when too little of the quote is on this page, when it is empty, or when the page has no text", () => {
    expect(locateInSpans(SPANS, "a completely different sentence about something else entirely")).toBeNull();
    expect(locateInSpans(SPANS, "   ")).toBeNull();
    expect(locateInSpans([], "anything")).toBeNull();
    expect(locateInSpans(["", "  "], "anything")).toBeNull();
  });

  it("a one-word quote is not enough (it would mark the first place that word appears)", () => {
    expect(locateInSpans(SPANS, "framework")).toBeNull();
  });

  it("when a word repeats, the longest run wins, not the first occurrence of one word", () => {
    const spans = ["the model is good", "we train the model on new data every night"];
    const at = locateInSpans(spans, "train the model on new data")!;
    expect(at.first.span).toBe(1);
  });

  it("a span whose words cannot be matched to its characters is marked whole, never skipped", () => {
    // 'x²' is one word either way, but a lone combining mark is dropped by the word reader and not by the character one
    const spans = ["alpha beta gamma", "delta épsilon zeta"];
    const at = locateInSpans(spans, "gamma delta epsilon zeta")!;
    expect(at.first.span).toBe(0);
    expect(at.last.span).toBe(1);
    expect(at.last.end).toBeGreaterThan(0);
  });
});

const R = (x: number, y: number, w: number, h = 10): MarkRect => ({ x, y, w, h });

describe("mergeLineRects", () => {
  it("joins boxes that touch on one line into one bar", () => {
    expect(mergeLineRects([R(10, 100, 50), R(60, 100, 40), R(102, 100, 20)])).toEqual([R(10, 100, 112)]);
  });
  it("keeps separate lines separate, in reading order", () => {
    expect(mergeLineRects([R(10, 120, 80), R(10, 100, 90)])).toEqual([R(10, 100, 90), R(10, 120, 80)]);
  });
  it("keeps two pieces of one line apart when there is a real gap between them", () => {
    expect(mergeLineRects([R(10, 100, 40), R(200, 100, 40)])).toHaveLength(2);
  });
  it("drops a box that lies inside another (the element's own box next to its text)", () => {
    expect(mergeLineRects([R(10, 100, 100, 12), R(20, 101, 50, 10)])).toEqual([R(10, 100, 100, 12)]);
  });
  it("keeps one of two identical boxes", () => {
    expect(mergeLineRects([R(10, 100, 50), R(10, 100, 50)])).toHaveLength(1);
  });
  it("drops boxes with no size and boxes that are not numbers", () => {
    expect(mergeLineRects([R(10, 100, 0), R(10, 100, 50, 0), { x: Number.NaN, y: 0, w: 5, h: 5 }, R(5, 5, 20)])).toEqual([R(5, 5, 20)]);
  });
  it("a slightly taller box on the same line is merged and the bar takes the larger height", () => {
    expect(mergeLineRects([R(10, 100, 50, 10), R(60, 99, 40, 12)])).toEqual([R(10, 99, 90, 12)]);
  });
  it("nothing in, nothing out", () => {
    expect(mergeLineRects([])).toEqual([]);
  });
  it("does not change the boxes it was given", () => {
    const a = R(10, 100, 50);
    const b = R(60, 100, 40);
    mergeLineRects([a, b]);
    expect(a).toEqual(R(10, 100, 50));
  });
});

describe("planNewHighlight: highlighting text that is already highlighted", () => {
  const ex = [{ id: "n1", page: 1, quote: LONG, color: "yellow" }];

  it("a different colour over a part of an existing highlight is added, and the long one stays", () => {
    expect(planNewHighlight(ex, { page: 1, quote: SHORT, color: "blue", withNote: false })).toEqual({ action: "add" });
  });
  it("the same colour over a part of an existing highlight changes nothing (it is already highlighted)", () => {
    expect(planNewHighlight(ex, { page: 1, quote: SHORT, color: "yellow", withNote: false })).toEqual({ action: "skip", id: "n1" });
  });
  it("a note on a part of a highlight is added: the note belongs to the part", () => {
    expect(planNewHighlight(ex, { page: 1, quote: SHORT, color: "yellow", withNote: true })).toEqual({ action: "add" });
  });
  it("a longer text around an existing highlight is added (it extends it)", () => {
    expect(planNewHighlight([{ id: "n1", page: 1, quote: SHORT, color: "yellow" }], { page: 1, quote: LONG, color: "yellow", withNote: false })).toEqual({ action: "add" });
  });
  it("the same words again in another colour recolour the existing highlight; they are not drawn twice", () => {
    expect(planNewHighlight(ex, { page: 1, quote: LONG.toUpperCase(), color: "green", withNote: false })).toEqual({ action: "recolor", id: "n1" });
  });
  it("the same words again in the same colour change nothing", () => {
    expect(planNewHighlight(ex, { page: 1, quote: `  ${LONG}  `, color: "yellow", withNote: false })).toEqual({ action: "skip", id: "n1" });
  });
  it("a note on text that is already highlighted opens that highlight's note", () => {
    expect(planNewHighlight(ex, { page: 1, quote: LONG, color: "yellow", withNote: true })).toEqual({ action: "open", id: "n1" });
  });
  it("text that overlaps only partly is added: both stay", () => {
    expect(planNewHighlight(ex, { page: 1, quote: "required to do something else entirely here", color: "yellow", withNote: false })).toEqual({ action: "add" });
  });
  it("the same words on another page are a different highlight", () => {
    expect(planNewHighlight(ex, { page: 2, quote: LONG, color: "yellow", withNote: false })).toEqual({ action: "add" });
  });
  it("a short quote is not 'inside' another merely because it is a part of a word (whole words only)", () => {
    expect(planNewHighlight([{ id: "n1", page: 1, quote: "the detection of faces in video", color: "yellow" }], { page: 1, quote: "detect", color: "yellow", withNote: false })).toEqual({ action: "add" });
  });
  it("with nothing there, a new highlight is added", () => {
    expect(planNewHighlight([], { page: 1, quote: SHORT, color: "pink", withNote: false })).toEqual({ action: "add" });
  });
});

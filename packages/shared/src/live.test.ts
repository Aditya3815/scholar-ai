import { describe, expect, it } from "vitest";
import { NOTEBOOK_LIMITS } from "./notebook";
import { LIVE_CARET_MAX, LIVE_COLOURS, LIVE_MAX_MESSAGE_BYTES, liveColour, liveDoing, liveInitial, liveMessageBytes, liveSlotOfId, readLiveHere, readLiveServer } from "./live";

describe("readLiveHere (what a page may send the room)", () => {
  it("reads a well-formed here, keeping only its known fields", () => {
    expect(readLiveHere(JSON.stringify({ t: "here", view: "notes", notesPage: "p1", editingBlock: "b1", active: true, idle: false, extra: "x" }))).toEqual({ t: "here", view: "notes", notesPage: "p1", editingBlock: "b1", active: true, idle: false });
    expect(readLiveHere({ t: "here", view: "paper", page: 3 })).toEqual({ t: "here", view: "paper", page: 3, active: false, idle: false });
    expect(readLiveHere({ t: "here", view: "comments", page: null })).toEqual({ t: "here", view: "comments", active: false, idle: false });
  });

  it("refuses anything else, whole", () => {
    for (const bad of [
      "not json",
      "null",
      "[]",
      { t: "hi", view: "paper" },
      { t: "here", view: "everything" },
      { t: "here", view: "paper", page: 0 },
      { t: "here", view: "paper", page: 2.5 },
      { t: "here", view: "paper", page: "3" },
      { t: "here", view: "notes", notesPage: "../x" },
      { t: "here", view: "notes", notesPage: "a".repeat(65) },
      { t: "here", view: "notes", editingBlock: "b1" },
      { t: "here", view: "notes", notesPage: "p1", editingBlock: 7 },
    ]) {
      expect(readLiveHere(typeof bad === "string" ? bad : JSON.stringify(bad))).toBeNull();
    }
  });

  it("reads a caret (and a selection) in the block typed in: whole numbers within a block's length", () => {
    const at = { t: "here", view: "notes", notesPage: "p1", editingBlock: "b1", active: true, idle: false };
    expect(readLiveHere({ ...at, caret: 12 })).toEqual({ ...at, caret: 12 });
    expect(readLiveHere({ ...at, caret: 3, caretEnd: 9 })).toEqual({ ...at, caret: 3, caretEnd: 9 });
    expect(readLiveHere({ ...at, caret: 0 })).toMatchObject({ caret: 0 });
    expect(readLiveHere({ ...at, caret: LIVE_CARET_MAX })).toMatchObject({ caret: LIVE_CARET_MAX });
    // an empty selection is a caret
    expect(readLiveHere({ ...at, caret: 4, caretEnd: 4 })).toEqual({ ...at, caret: 4 });
    for (const bad of [
      { ...at, caret: -1 },
      { ...at, caret: 2.5 },
      { ...at, caret: "4" },
      { ...at, caret: LIVE_CARET_MAX + 1 },
      { ...at, caret: 1e9 },
      { ...at, caret: 5, caretEnd: 2 },
      { ...at, caretEnd: 2 },
      { ...at, caret: 1, caretEnd: LIVE_CARET_MAX + 1 },
      // a caret only with the block it is in
      { t: "here", view: "notes", notesPage: "p1", caret: 3 },
      { t: "here", view: "paper", page: 2, caret: 3 },
    ]) {
      expect(readLiveHere(JSON.stringify(bad))).toBeNull();
    }
    // its cap is a text block's
    expect(LIVE_CARET_MAX).toBe(NOTEBOOK_LIMITS.text);
  });

  it("refuses a message over 2 KB before reading it", () => {
    const big = JSON.stringify({ t: "here", view: "paper", pad: "x".repeat(LIVE_MAX_MESSAGE_BYTES) });
    expect(readLiveHere(big)).toBeNull();
    // counted in UTF-8 bytes, not characters
    expect(liveMessageBytes("नमस्ते")).toBe(18);
    expect(liveMessageBytes("😀")).toBe(4);
  });

  it("is never active and idle at once", () => {
    expect(readLiveHere({ t: "here", view: "paper", active: true, idle: true })).toMatchObject({ active: false, idle: true });
  });
});

describe("readLiveServer (what the page reads)", () => {
  it("knows hello, presence and changed, and ignores anything else", () => {
    expect(readLiveServer(JSON.stringify({ t: "changed", kind: "notebook", id: "p1", rev: 4, by: "u1" }))).toMatchObject({ kind: "notebook", rev: 4 });
    expect(readLiveServer(JSON.stringify({ t: "presence", people: [] }))).toEqual({ t: "presence", people: [] });
    expect(readLiveServer(JSON.stringify({ t: "hello", you: "c1", colour: 2, role: "editor" }))).toMatchObject({ you: "c1" });
    expect(readLiveServer(JSON.stringify({ t: "changed", kind: "everything", by: "u1" }))).toBeNull();
    expect(readLiveServer(JSON.stringify({ t: "later-kind" }))).toBeNull();
    expect(readLiveServer("null")).toBeNull();
    expect(readLiveServer(42)).toBeNull();
  });
});

describe("colours", () => {
  it("gives the owner the first and the people named the next ones, in order, round the palette", () => {
    expect([0, 1, 2, 5, 6, 7, -1].map(liveColour)).toEqual([0, 1, 2, 5, 0, 1, 5]);
  });
  it("gives someone with no place a stable colour from their id", () => {
    expect(liveSlotOfId("abc")).toBe(liveSlotOfId("abc"));
    for (const id of ["a", "user-123", "zz", "x9"]) {
      expect(liveSlotOfId(id)).toBeGreaterThanOrEqual(0);
      expect(liveSlotOfId(id)).toBeLessThan(LIVE_COLOURS);
    }
  });
});

describe("words", () => {
  it("makes an initial from any script", () => {
    expect(liveInitial("ravi kumar")).toBe("R");
    expect(liveInitial("  (Asha)")).toBe("A");
    expect(liveInitial("अदिति")).toBe("अ");
    expect(liveInitial("")).toBe("?");
  });
  it("says what a person is doing", () => {
    const title = (id: string) => (id === "p1" ? "Methods" : id === "p2" ? "" : null);
    expect(liveDoing({ view: "notes", page: null, notesPage: "p1", editingBlock: "b1" }, title)).toBe("Editing Methods");
    expect(liveDoing({ view: "notes", page: null, notesPage: "p2", editingBlock: null }, title)).toBe("Reading Untitled page");
    expect(liveDoing({ view: "paper", page: 3, notesPage: null, editingBlock: null }, title)).toBe("Viewing p. 3");
    expect(liveDoing({ view: "notes", page: null, notesPage: "p9", editingBlock: "b1" }, title)).toBe("Editing the notes");
    expect(liveDoing({ view: "notes", page: null, notesPage: null, editingBlock: null }, title)).toBe("Reading the notes");
    expect(liveDoing({ view: "comments", page: 3, notesPage: null, editingBlock: null }, title)).toBe("In Comments");
    expect(liveDoing({ view: "paper", page: null, notesPage: null, editingBlock: null }, title)).toBe("Viewing the paper");
  });
});

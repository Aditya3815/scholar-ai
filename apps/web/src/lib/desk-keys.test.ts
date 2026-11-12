import { describe, expect, it } from "vitest";
import { deskToolKey, inTextField } from "./desk-keys";
import { TOOL_KEYS } from "../components/papers/InkToolbar";

const out = { drawOpen: false, typing: false };

describe("the reader's tool keys (docs/design/paper-reader.md, 3)", () => {
  it("outside Draw: V Select, H Highlight, D Draw, in either case", () => {
    expect(deskToolKey({ key: "v" }, out)).toBe("select");
    expect(deskToolKey({ key: "H" }, out)).toBe("highlight");
    expect(deskToolKey({ key: "d" }, out)).toBe("draw");
    expect(deskToolKey({ key: "c" }, out)).toBeNull(); // Capture comes in phase 3
    expect(deskToolKey({ key: "a" }, out)).toBeNull(); // no key for the Agents: A is the arrow in Draw
  });

  it("never with a modifier, while typing, or for a key held down", () => {
    expect(deskToolKey({ key: "v", ctrlKey: true }, out)).toBeNull();
    expect(deskToolKey({ key: "h", metaKey: true }, out)).toBeNull();
    expect(deskToolKey({ key: "d", altKey: true }, out)).toBeNull();
    expect(deskToolKey({ key: "H", shiftKey: true }, out)).toBeNull();
    expect(deskToolKey({ key: "h" }, { drawOpen: false, typing: true })).toBeNull();
    expect(deskToolKey({ key: "h", repeat: true }, out)).toBeNull();
  });

  it("inside the open Draw toolbar the letters stay the drawing tools exactly as today: the reader takes none of them", () => {
    for (const k of ["v", "h", "d", "p", "e"]) expect(deskToolKey({ key: k }, { drawOpen: true, typing: false }), k).toBeNull();
    expect(TOOL_KEYS.v).toBe("hand");
    expect(TOOL_KEYS.h).toBe("highlighter");
    expect(TOOL_KEYS.p).toBe("pen");
    expect(TOOL_KEYS.d).toBeUndefined();
  });

  it("a text field, a contenteditable and a dialog count as typing", () => {
    const at = (match: boolean) => ({ closest: () => (match ? {} : null) }) as unknown as EventTarget;
    expect(inTextField(at(true))).toBe(true);
    expect(inTextField(at(false))).toBe(false);
    expect(inTextField(null)).toBe(false);
  });
});

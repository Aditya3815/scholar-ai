import { describe, expect, it } from "vitest";
import { chatRequestBody, editInfo, startAssistant, type AssistantMsg, type ChatMsg, type HistoryEntry, type UserMsg } from "@scholar/shared";

/**
 * The browser's half of `sinceYear` (docs/design/chatview-and-trending.md, T9): a Trending chip fills the box and puts a visible "From 2025 on" chip beside it; sending carries that year as the optional body field
 * `sinceYear`, the reply keeps it (as it keeps the place a search looked in), and "Search again" and an edit send it again. Everything else about the body is what it was: the existing tests in
 * context-before.test.ts pin the bytes of a message without it, and these pin that adding the field changes nothing for a message that has none.
 */

const h: HistoryEntry[] = [{ role: "user", text: "glaucoma screening" }, { role: "assistant", searchQuery: "glaucoma screening" }];
const body = (o: Partial<Omit<Parameters<typeof chatRequestBody>[0], "sinceYear">> & { sinceYear?: unknown }) => JSON.stringify(chatRequestBody({ signedIn: true, mode: "search", message: "retrieval-augmented generation", ...(o as object) }));

describe("the body of POST /api/v1/chat with a year", () => {
  it("carries sinceYear after everything else, as a whole number", () => {
    expect(body({ sinceYear: 2025 })).toBe('{"mode":"search","message":"retrieval-augmented generation","sinceYear":2025}');
    expect(body({ mode: "auto", sinceYear: 2025 })).toBe('{"mode":"auto","message":"retrieval-augmented generation","sinceYear":2025}');
    expect(body({ scope: "india", sinceYear: 2024 })).toBe('{"mode":"search","message":"retrieval-augmented generation","scope":"india","sinceYear":2024}');
    expect(body({ mode: "auto", scope: "india", history: h, sinceYear: 2024 })).toBe(`{"mode":"auto","message":"retrieval-augmented generation","scope":"india","history":${JSON.stringify(h)},"sinceYear":2024}`);
    expect(body({ mode: "auto", earlier: [{ question: "diabetes in children" }], sinceYear: 2024 })).toBe('{"mode":"auto","message":"retrieval-augmented generation","earlier":[{"question":"diabetes in children"}],"sinceYear":2024}');
  });

  it("without a year, or with none that is usable, the body is byte for byte what it was", () => {
    const plain = '{"mode":"search","message":"retrieval-augmented generation"}';
    expect(body({})).toBe(plain);
    expect(body({ sinceYear: undefined })).toBe(plain);
    expect(body({ sinceYear: null })).toBe(plain);
    // the server answers 400 to anything that is not a whole year from 1990: the page does not send what it knows will be refused
    for (const bad of [1989, 2101, 2025.5, "2025", Number.NaN, Infinity, true, [2025], {}, -1, 0]) expect(body({ sinceYear: bad }), String(bad)).toBe(plain);
    expect(body({ mode: "auto", scope: "india", history: h })).toBe(`{"mode":"auto","message":"retrieval-augmented generation","scope":"india","history":${JSON.stringify(h)}}`);
  });

  it("is sent for a person who is not signed in too (the list is cut for everybody), and never with 'anyway' (that is the box's answer to small talk, not a chip's search)", () => {
    expect(body({ signedIn: false, sinceYear: 2025 })).toBe('{"mode":"search","message":"retrieval-augmented generation","sinceYear":2025}');
    expect(body({ anyway: true, sinceYear: 2025 })).toBe('{"mode":"search","message":"retrieval-augmented generation","anyway":true}');
  });
});

describe("the reply keeps the year it was asked with", () => {
  it("startAssistant stores it, and a reply without one has no such key at all (what is kept in the browser for an old chat does not change)", () => {
    expect(startAssistant("a", "q", 1, false, "all", 2025).sinceYear).toBe(2025);
    expect(startAssistant("a", "q", 1, true, "india", 2025)).toMatchObject({ scope: "india", sinceYear: 2025 });
    for (const none of [undefined, null, 1989, 2025.5, 2101]) expect("sinceYear" in startAssistant("a", "q", 1, false, "all", none as number | undefined), String(none)).toBe(false);
    expect(JSON.stringify(startAssistant("a", "q", 1, false))).toBe(JSON.stringify(startAssistant("a", "q", 1, false, undefined, undefined)));
    expect("sinceYear" in startAssistant("a", "q", 1, false)).toBe(false);
  });

  it("an edit of the message reads it from the reply under it, as it reads the place the search looked in", () => {
    const user: UserMsg = { id: "u1", role: "user", text: "retrieval-augmented generation", at: 1 };
    const msgs = (reply: AssistantMsg): ChatMsg[] => [user, reply];
    expect(editInfo(msgs(startAssistant("a1", "q", 1, false, "all", 2025)), "u1")!.sinceYear).toBe(2025);
    expect(editInfo(msgs(startAssistant("a1", "q", 1, true, "india", 2024)), "u1")).toMatchObject({ mode: "auto", scope: "india", sinceYear: 2024 });
    expect(editInfo(msgs(startAssistant("a1", "q", 1, false)), "u1")!.sinceYear).toBeUndefined();
    expect("sinceYear" in editInfo(msgs(startAssistant("a1", "q", 1, false)), "u1")!).toBe(false);
  });
});

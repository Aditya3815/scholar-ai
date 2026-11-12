import { describe, expect, it } from "vitest";
import {
  RAIL_CHATS, askedTurns, chatRequestBody, contextBefore, goneFromIndex, ownedBy, parseIndex, startAssistant, touchIndex, withHeld,
  type AssistantMsg, type ChatMsg, type HistoryEntry, type IdeaMsg, type MemoryEntry, type UserMsg,
} from "@scholar/shared";

/* The list of chats in this browser and whose they are (packages/shared/src/chat-memory.ts). Until 6 Nov 2026 this file also tested what the browser carried from one chat to ANOTHER ("Continue from an
   earlier chat", "Use my earlier chats"); that feature was removed (design PDF "Sodhsetu understanding, follow-ups and MCP", M1), and these tests now also say that nothing of it is left: the old
   fields of an entry are dropped when the list is read, and the body of a message has no place for another chat's questions. */

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const user = (id: string, text: string, at = 1): UserMsg => ({ id, role: "user", text, at });
/** A finished search in Auto, as the page keeps it. */
const reply = (id: string, over: Partial<AssistantMsg> = {}): AssistantMsg => ({ ...startAssistant(id, "q", 1, true), understood: true, how: "rules", status: "done", step: null, papersFinal: true, ...over });
const idea = (id: string, text = "an idea"): IdeaMsg => ({ id, role: "idea", text, at: 1 });
const turn = (i: number, text: string, over: Partial<AssistantMsg> = {}): ChatMsg[] => [user(`u${i}`, text, i), reply(`a${i}`, { query: text, ...over })];
const entry = (id: string, over: Partial<MemoryEntry> = {}): MemoryEntry => ({ id, title: id, updatedAt: NOW - DAY, owner: "me", ...over });
const json = (x: unknown) => JSON.stringify(x);

describe("the rail", () => {
  it("lists the six latest chats", () => expect(RAIL_CHATS).toBe(6));
});

describe("askedTurns: the finished searches of a chat as the person's own words", () => {
  it("is the questions and search words of the turns contextBefore would send, oldest first, and no more of them", () => {
    const msgs: ChatMsg[] = [
      ...turn(1, "first question about glaucoma", { searchQuery: "glaucoma" }),
      user("ux", "hello there"), reply("ax", { reason: "small_talk" }),
      ...turn(2, "second question about retinopathy"),
      user("uy", "IDEA text"), idea("iy", "IDEA text"),
      ...turn(3, "third question about cataract"),
    ];
    expect(askedTurns(msgs)).toEqual([{ question: "first question about glaucoma", searchQuery: "glaucoma" }, { question: "second question about retinopathy" }, { question: "third question about cataract" }]);
    const sent = (contextBefore(msgs, msgs.length) as HistoryEntry[]).flatMap((e) => (e.role === "user" ? [e.text] : []));
    expect(askedTurns(msgs).map((t) => t.question)).toEqual(sent);
  });

  it("never holds an answer's words, the papers or a language", () => {
    const answer = { text: "ANSWERCANARY [1].", grounded: true, checked: true, citations: [{ n: 1, paperId: "p1", sentenceNo: 1, sentence: "s." }] };
    const t = askedTurns(turn(1, "glaucoma screening", { answer, papers: [] }));
    expect(Object.keys(t[0]!)).toEqual(["question"]);
    expect(json(t)).not.toContain("ANSWERCANARY");
  });
});

describe("the list of chats as it is read back from storage", () => {
  const raw = (over: unknown = {}) => ({ id: "a", title: "A chat", updatedAt: 5, ...(over as object) });

  it("keeps an entry with its owner, and drops the words and the exclusion of the removed earlier-chats feature, so the next write of the list takes them out of storage", () => {
    expect(parseIndex([raw({ owner: "u1", kw: "glaucoma screen", nomem: true })], 30)).toEqual([{ id: "a", title: "A chat", updatedAt: 5, owner: "u1" }]);
    expect(json(parseIndex([raw({ kw: "WORDCANARY", nomem: true })], 30))).not.toMatch(/WORDCANARY|nomem/);
  });

  it("reads a list kept before any of this existed: three fields, and no owner", () => {
    expect(parseIndex([raw()], 30)).toEqual([{ id: "a", title: "A chat", updatedAt: 5 }]);
  });

  it("drops a field of the wrong type but keeps the chat (storage can hold anything: another build, a hand edit)", () => {
    const [e] = parseIndex([raw({ owner: 7, kw: ["x"], nomem: "yes" })], 30);
    expect(e).toEqual({ id: "a", title: "A chat", updatedAt: 5 });
  });

  it("keeps a field it does not know (a newer build's), so that touching the chat does not lose it", () => {
    expect(parseIndex([raw({ later: 3 })], 30)[0]).toHaveProperty("later", 3);
  });

  it("drops what is not an entry, and everything that is not a list", () => {
    expect(parseIndex([null, 3, "x", {}, { id: "a" }, raw()], 30)).toHaveLength(1);
    expect(parseIndex("nope", 30)).toEqual([]);
    expect(parseIndex(null, 30)).toEqual([]);
    expect(parseIndex({ id: "a" }, 30)).toEqual([]);
  });

  it("keeps at most `max` (the thirty latest), in the order stored", () => {
    const many = Array.from({ length: 40 }, (_, i) => raw({ id: `c${i}` }));
    const out = parseIndex(many, 30);
    expect(out).toHaveLength(30);
    expect(out[0]!.id).toBe("c0");
  });

  it("does not keep an owner that is absurdly long (no 'owner' of a megabyte)", () => {
    const [e] = parseIndex([raw({ owner: "x".repeat(500) })], 30);
    expect(e!.owner).toBeUndefined();
  });
});

describe("whose chats they are", () => {
  const index: MemoryEntry[] = [entry("mine", { owner: "u1" }), entry("theirs", { owner: "u2" }), entry("old", { owner: undefined })];

  it("while it is not known who is here (the page has not asked yet), nothing is taken away", () => {
    const { kept, dropped } = ownedBy(index, undefined);
    expect(kept).toHaveLength(3);
    expect(dropped).toEqual([]);
  });

  it("when the person is another one, the chats of the first go (and a chat that has no owner stays: it is adopted when opened)", () => {
    const { kept, dropped } = ownedBy(index, "u1");
    expect(kept.map((e) => e.id)).toEqual(["mine", "old"]);
    expect(dropped.map((e) => e.id)).toEqual(["theirs"]);
    expect(ownedBy(index, "u3").kept.map((e) => e.id)).toEqual(["old"]);
  });

  it("when nobody is signed in (a session that ended by running out, not by a sign-out), the chats of a person who was are held: not shown to whoever is there now, and NOT removed", () => {
    const { kept, dropped, held } = ownedBy(index, null);
    expect(kept.map((e) => e.id)).toEqual(["old"]);
    expect(held.map((e) => e.id)).toEqual(["mine", "theirs"]);
    expect(dropped).toEqual([]);
  });

  it("when a person is signed in nothing is held: a chat of another person goes, the rest is shown", () => {
    expect(ownedBy(index, "u1").held).toEqual([]);
    expect(ownedBy(index, undefined).held).toEqual([]);
  });

  it("the same person coming back finds their chats again (held is not lost), another person drops them", () => {
    const stored = [...ownedBy(index, null).kept, ...ownedBy(index, null).held];
    expect(ownedBy(stored, "u1").kept.map((e) => e.id).sort()).toEqual(["mine", "old"]);
    expect(ownedBy(stored, "u2").kept.map((e) => e.id).sort()).toEqual(["old", "theirs"]);
    expect(ownedBy(stored, "u2").dropped.map((e) => e.id)).toEqual(["mine"]);
  });

  it("is empty for no chats and does not change the list it is given", () => {
    expect(ownedBy([], "u1")).toEqual({ kept: [], dropped: [], held: [] });
    const copy = json(index);
    ownedBy(index, "u9");
    expect(json(index)).toBe(copy);
  });

  it("touching a chat stamps its owner (and a chat with an owner keeps it), and keeps what else the entry had", () => {
    const { kept } = touchIndex([entry("a", { owner: undefined })], "a", undefined, 9, 30, { owner: "u1" });
    expect(kept[0]).toEqual({ id: "a", title: "a", updatedAt: 9, owner: "u1" });
    expect(touchIndex(kept, "a", undefined, 10, 30).kept[0]).toMatchObject({ owner: "u1" });
  });

  it("the thirty-first chat pushes the oldest out: nothing of it is left in what is kept", () => {
    const index30 = Array.from({ length: 30 }, (_, i) => entry(`c${i}`, { title: `TITLE${i}`, updatedAt: 1000 - i }));
    const { kept, dropped } = touchIndex(index30, "new", "New", 2000, 30);
    expect(kept).toHaveLength(30);
    expect(dropped.map((e) => e.id)).toEqual(["c29"]);
    expect(json(kept)).not.toContain("TITLE29");
  });
});

describe("which chats an open page lets go of when another tab changed the list", () => {
  const index = [entry("a"), entry("b")];

  it("a chat that is in memory and no longer in the list is gone (another tab deleted it, cleared the chats or signed out)", () => {
    expect(goneFromIndex(["a", "b", "c"], index, new Set())).toEqual(["c"]);
    expect(goneFromIndex(["a", "b"], [], new Set())).toEqual(["a", "b"]);
  });

  it("a chat that is being answered here, or a private one (it was never in the list), is not let go", () => {
    expect(goneFromIndex(["a", "b", "c", "p"], [], new Set(["c", "p"]))).toEqual(["a", "b"]);
  });

  it("nothing is gone when nothing changed, and for an empty page", () => {
    expect(goneFromIndex(["a", "b"], index, new Set())).toEqual([]);
    expect(goneFromIndex([], [], new Set())).toEqual([]);
  });
});

describe("chatRequestBody: nothing of another chat (the earlier-chats feature was removed on 6 Nov 2026)", () => {
  const history: HistoryEntry[] = [{ role: "user", text: "glaucoma screening" }, { role: "assistant" }];

  it("is the mode, the message and, in Auto, the earlier turns of the same chat; there is no other key for context", () => {
    expect(json(chatRequestBody({ signedIn: true, mode: "auto", message: "hello", history }))).toBe(json({ mode: "auto", message: "hello", history }));
    expect(Object.keys(chatRequestBody({ signedIn: true, mode: "auto", message: "x", scope: "india", history })).join()).toBe("mode,message,scope,history");
    // a caller that still passes the old field (a stale import, a test double) cannot make the body carry it
    expect(json(chatRequestBody({ signedIn: true, mode: "auto", message: "x", ...({ earlier: [{ question: "EARLIERCANARY" }] } as object) }))).toBe('{"mode":"auto","message":"x"}');
  });
});

describe("withHeld: the list as it is written when this page sees only part of it", () => {
  const e = (id: string, updatedAt: number) => ({ id, title: id, updatedAt });

  it("is what the page shows, then what it holds back: nothing is lost from the stored list", () => {
    const { list, dropped } = withHeld([e("a", 9), e("b", 8)], [e("h1", 5), e("h2", 4)], 30);
    expect(list.map((x) => x.id)).toEqual(["a", "b", "h1", "h2"]);
    expect(dropped).toEqual([]);
  });

  it("holds the newest of the held first, whatever order they came in", () => {
    expect(withHeld([e("a", 9)], [e("old", 1), e("new", 7)], 30).list.map((x) => x.id)).toEqual(["a", "new", "old"]);
  });

  it("when there is no room for all of it the held chats go first, the oldest first, and are handed back so that their records can go with them", () => {
    const visible = Array.from({ length: 28 }, (_, i) => e(`v${i}`, 100 - i));
    const { list, dropped } = withHeld(visible, [e("h-old", 1), e("h-mid", 5), e("h-new", 9)], 30);
    expect(list).toHaveLength(30);
    expect(list.slice(28).map((x) => x.id)).toEqual(["h-new", "h-mid"]);
    expect(dropped.map((x) => x.id)).toEqual(["h-old"]);
  });

  it("never pushes out what the page shows, even when that already fills the list", () => {
    const visible = Array.from({ length: 30 }, (_, i) => e(`v${i}`, 100 - i));
    const { list, dropped } = withHeld(visible, [e("h", 99)], 30);
    expect(list.map((x) => x.id)).toEqual(visible.map((x) => x.id));
    expect(dropped.map((x) => x.id)).toEqual(["h"]);
  });

  it("does not change the lists it is given", () => {
    const visible = [e("a", 9)];
    const held = [e("h2", 1), e("h1", 5)];
    const copy = json([visible, held]);
    withHeld(visible, held, 30);
    expect(json([visible, held])).toBe(copy);
  });
});

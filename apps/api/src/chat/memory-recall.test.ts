import { describe, expect, it, vi } from "vitest";
import { earlierFor, startAssistant, type AssistantMsg, type ChatMsg, type EarlierQuestion, type IdeaMsg, type MemoryEntry, type UserMsg } from "@scholar/shared";
import { readEarlier } from "./history";

/* What the browser carries from other chats for ONE message (docs/design/chat-actions-context.md, section 6), decided in one pure function so that every state of the switch and of the chip is tested without a
   browser: whether anything is carried at all, which chats are even read (a chat that may not be drawn on is never opened), and what comes out. The questions come from the chats' own records, as the person
   typed them: an answer, an Idea Check or a pasted list in those records must never get through. */

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const user = (id: string, text: string): UserMsg => ({ id, role: "user", text, at: 1 });
const reply = (id: string, over: Partial<AssistantMsg> = {}): AssistantMsg => ({ ...startAssistant(id, "q", 1, true), understood: true, how: "rules", status: "done", step: null, papersFinal: true, ...over });
const idea = (id: string, text: string): IdeaMsg => ({ id, role: "idea", text, at: 1 });
const turn = (i: string, text: string, over: Partial<AssistantMsg> = {}): ChatMsg[] => [user(`u${i}`, text), reply(`a${i}`, { query: text, ...over })];
const entry = (id: string, kw: string, over: Partial<MemoryEntry> = {}): MemoryEntry => ({ id, title: id, updatedAt: NOW - DAY, owner: "me", kw, ...over });

const CHATS: Record<string, ChatMsg[]> = {
  kids: [...turn("1", "insulin pumps in children", { searchQuery: "insulin pump children" }), ...turn("2", "type 1 diabetes camps for children")],
  eyes: [...turn("1", "glaucoma screening in India", { searchQuery: "glaucoma screening india" })],
  rich: [
    ...turn("1", "metformin in pregnancy", { answer: { text: "ANSWERCANARY molecule [1].", grounded: true, checked: true, citations: [{ n: 1, paperId: "p", sentenceNo: 1, sentence: "s." }] } }),
    user("ux", "IDEACANARY metformin idea about children"), idea("ix", "IDEACANARY metformin idea about children"),
    ...turn("3", `PASTECANARY metformin ${"children ".repeat(40)}`),
    ...turn("4", "hello metformin children", { reason: "small_talk" }),
    ...turn("5", "metformin dose in children", { general: { kind: "background", text: "GENERALCANARY metformin" } }),
  ],
};
const INDEX: MemoryEntry[] = [entry("kids", "insulin pump children diabetes camps"), entry("eyes", "glaucoma screening india"), entry("rich", "metformin pregnancy")];

const setup = (over: Partial<Parameters<typeof earlierFor>[0]> = {}) => {
  const load = vi.fn(async (id: string) => CHATS[id] ?? null);
  const o: Parameters<typeof earlierFor>[0] = { message: "and in children?", mode: "auto", owner: "me", kept: true, on: true, isPrivate: false, from: null, index: INDEX, currentId: "now", now: NOW, load, ...over };
  return { o, load, run: () => earlierFor(o) };
};
const opened = (load: ReturnType<typeof vi.fn>) => load.mock.calls.map((c) => c[0] as string).sort();

describe("earlierFor: nothing leaves unless the person turned it on, and then only what is related", () => {
  it("with the switch off and no chat chosen, nothing is carried, and no other chat is even opened", async () => {
    const { run, load } = setup({ on: false });
    expect(await run()).toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });

  it("with the switch on and a related question, the related questions of the related chat are carried: only a question and its search words", async () => {
    const { run, load } = setup();
    const out = await run();
    expect(out.map((e) => e.question).sort()).toEqual(["insulin pumps in children", "type 1 diabetes camps for children"]);
    expect(out.find((e) => e.question === "insulin pumps in children")).toEqual({ question: "insulin pumps in children", searchQuery: "insulin pump children" });
    expect(opened(load)).toEqual(["kids"]);
    for (const e of out) expect(Object.keys(e).every((k) => k === "question" || k === "searchQuery")).toBe(true);
  });

  it("with the switch on and an unrelated question, nothing is carried and no chat is opened", async () => {
    const { run, load } = setup({ message: "how does CRISPR editing work" });
    expect(await run()).toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });

  it("a message that stands alone (five words or more and no word that leans on an earlier one) is never sent with other chats: no model would read them", async () => {
    const { run, load } = setup({ message: "does early detection of glaucoma reduce blindness in elderly people" });
    expect(await run()).toEqual([]);
    expect(load).not.toHaveBeenCalled();
    // while a short one that shares a topic word is
    expect((await setup({ message: "glaucoma costs" }).run()).length).toBeGreaterThan(0);
  });

  it("a search the reader chose, and a search 'anyway', carry nothing (the server refuses them): even with the switch on and a chat chosen", async () => {
    for (const over of [{ mode: "search" as const }, { anyway: true }]) {
      const { run, load } = setup({ ...over, from: { source: "kids" } });
      expect(await run()).toEqual([]);
      expect(load).not.toHaveBeenCalled();
    }
  });

  it("nothing is carried for a person who is not signed in, nor while it is not known who is here", async () => {
    for (const owner of [null, undefined]) {
      const { run, load } = setup({ owner, from: { source: "kids" } });
      expect(await run()).toEqual([]);
      expect(load).not.toHaveBeenCalled();
    }
  });

  it("nothing is carried when this browser would not keep the chats (there is nothing to use), nor from a private chat", async () => {
    for (const over of [{ kept: false }, { isPrivate: true }]) {
      const { run, load } = setup({ ...over, from: { source: "kids" } });
      expect(await run()).toEqual([]);
      expect(load).not.toHaveBeenCalled();
    }
  });
});

describe("earlierFor: which chats may be opened", () => {
  it("never the open chat, a chat left out of memory, another person's chat, a chat with no owner yet, or one the rail does not list", async () => {
    const index: MemoryEntry[] = [
      entry("now", "children", { updatedAt: NOW }),
      entry("kids", "children", { nomem: true }),
      entry("eyes", "children", { owner: "someone-else" }),
      entry("rich", "children", { owner: undefined }),
      ...["a", "b", "c", "d"].map((id, i) => entry(id, `other${id}x`, { updatedAt: NOW - (i + 2) * DAY })),
      entry("seventh", "children", { updatedAt: NOW - 50 * DAY }),
    ];
    const { run, load } = setup({ index, currentId: "now" });
    expect(await run()).toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });

  it("at most three chats are opened, however many are related", async () => {
    const index = ["a", "b", "c", "d", "e"].map((id, i) => entry(id, `topic${id}x`, { updatedAt: NOW - i * DAY }));
    const chats: Record<string, ChatMsg[]> = Object.fromEntries(index.map((e) => [e.id, turn(e.id, `a question about topic${e.id}x`)]));
    const load = vi.fn(async (id: string) => chats[id] ?? null);
    // four short words, each the topic of a different chat: four chats relate, three are opened
    const out = await earlierFor({ message: "topicax topicbx topiccx topicdx", mode: "auto", owner: "me", kept: true, on: true, isPrivate: false, from: null, index, currentId: null, now: NOW, load });
    expect(load).toHaveBeenCalledTimes(3);
    expect(opened(load)).toEqual(["a", "b", "c"]);
    expect(out).toHaveLength(3);
  });

  it("a chat that cannot be read (a failed read, a record that is gone, an error) is skipped: it never fails the message", async () => {
    const index = [entry("kids", "children", { updatedAt: NOW - DAY }), entry("eyes", "children", { updatedAt: NOW - 2 * DAY }), entry("rich", "children", { updatedAt: NOW - 3 * DAY })];
    const load = vi.fn(async (id: string): Promise<ChatMsg[] | null> => {
      if (id === "kids") throw new Error("storage failed");
      if (id === "eyes") return null;
      return turn("1", "children and metformin");
    });
    const out = await earlierFor({ message: "and in children?", mode: "auto", owner: "me", kept: true, on: true, isPrivate: false, from: null, index, currentId: null, now: NOW, load });
    expect(out).toEqual([{ question: "children and metformin" }]);
  });
});

describe("earlierFor: never an answer, an idea, a list, small talk or background", () => {
  it("takes only the person's questions from a record that has all of those", async () => {
    const { run } = setup({ message: "metformin children", index: [entry("rich", "metformin pregnancy")] });
    const out = await run();
    // two of its questions are the person's own and eligible (one of them had background written under it, which is not carried); the answer, the idea, the paste and the greeting are not
    expect(out.map((e) => e.question).sort()).toEqual(["metformin dose in children", "metformin in pregnancy"]);
    expect(JSON.stringify(out)).not.toMatch(/CANARY/);
  });

  it("the questions a chat offers are the ones of the version of a message that was kept, not the words that were replaced", async () => {
    const first = turn("1", "OLDTEXT insulin pumps in children");
    const edited: ChatMsg[] = [{ ...(first[0] as UserMsg), text: "NEWTEXT insulin pumps in children", versions: [{ text: "OLDTEXT insulin pumps in children", at: 1, tail: first.slice(1) }, { text: "NEWTEXT insulin pumps in children", at: 2, tail: [] }], ver: 1 }, reply("a1b", { query: "NEWTEXT insulin pumps in children" })];
    const { run } = setup({ index: [entry("kids", "children insulin")], load: vi.fn(async () => edited) });
    const out = await run();
    expect(JSON.stringify(out)).toContain("NEWTEXT");
    expect(JSON.stringify(out)).not.toContain("OLDTEXT");
  });
});

describe("earlierFor: a chat the person chose to continue from", () => {
  it("carries its last three questions, newest first, with every message, even one that stands alone and shares no word with them", async () => {
    const many: ChatMsg[] = [1, 2, 3, 4].flatMap((i) => turn(String(i), `question number ${i} about retinopathy`, { searchQuery: `retinopathy ${i}x` }));
    const load = vi.fn(async () => many);
    const out = await setup({ on: false, message: "does early detection of glaucoma reduce blindness in elderly people", from: { source: "kids" }, load }).run();
    expect(out.map((e) => e.question)).toEqual(["question number 4 about retinopathy", "question number 3 about retinopathy", "question number 2 about retinopathy"]);
    expect(out[0]).toEqual({ question: "question number 4 about retinopathy", searchQuery: "retinopathy 4x" });
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith("kids");
  });

  it("is that chat's questions and not the ones the switch would have found: the chosen chat wins", async () => {
    const { run, load } = setup({ message: "and in children?", from: { source: "eyes" } });
    const out = await run();
    expect(out).toEqual([{ question: "glaucoma screening in India", searchQuery: "glaucoma screening india" }]);
    expect(opened(load)).toEqual(["eyes"]);
  });

  it("holds nothing of an idea, an answer, a list, small talk or background", async () => {
    const out = await setup({ from: { source: "rich" }, on: false }).run();
    expect(out.map((e) => e.question)).toEqual(["metformin dose in children", "metformin in pregnancy"]);
    expect(JSON.stringify(out)).not.toMatch(/CANARY/);
  });

  it("is nothing when that chat is gone from the list, is the open chat itself, or belongs to someone else", async () => {
    expect(await setup({ from: { source: "gone" } }).run()).toEqual([]);
    // (the chat itself can be read, and still carries nothing: it cannot be continued from itself)
    expect(await setup({ from: { source: "now" }, currentId: "now", index: [...INDEX, entry("now", "x")], load: vi.fn(async () => CHATS.eyes!) }).run()).toEqual([]);
    expect(await setup({ index: [entry("kids", "x", { owner: "someone-else" })], from: { source: "kids" } }).run()).toEqual([]);
  });

  it("a chat that was left out of memory can still be chosen to continue from (the person asked for it by name), and so can one kept before chats had an owner", async () => {
    expect((await setup({ index: [entry("eyes", "x", { nomem: true })], from: { source: "eyes" } }).run()).length).toBe(1);
    expect((await setup({ index: [entry("eyes", "x", { owner: undefined })], from: { source: "eyes" } }).run()).length).toBe(1);
  });

  it("a chat with no finished search carries nothing, and a record that cannot be read carries nothing", async () => {
    expect(await setup({ from: { source: "kids" }, load: vi.fn(async () => [user("u", "hello"), reply("a", { reason: "small_talk" })]) }).run()).toEqual([]);
    expect(await setup({ from: { source: "kids" }, load: vi.fn(async () => null) }).run()).toEqual([]);
    expect(await setup({ from: { source: "kids" }, load: vi.fn(async () => { throw new Error("x"); }) }).run()).toEqual([]);
  });
});

describe("earlierFor: what comes out is what the server reads", () => {
  it("is accepted whole and unchanged by the server's own reader, for the switch and for a chosen chat", async () => {
    const long: ChatMsg[] = [1, 2, 3].flatMap((i) => turn(String(i), `${"retinopathy ".repeat(20)}${i}`, { searchQuery: `${"retinopathy words ".repeat(14)}${i}` }));
    for (const o of [setup().o, setup({ on: false, from: { source: "kids" }, load: vi.fn(async () => long) }).o]) {
      const out: EarlierQuestion[] = await earlierFor(o);
      expect(out.length).toBeGreaterThan(0);
      expect(readEarlier(out)).toEqual({ ok: true, earlier: out });
    }
  });
});

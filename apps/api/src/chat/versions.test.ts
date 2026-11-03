import { describe, expect, it } from "vitest";
import {
  MAX_AUTO_CHARS, MAX_CHAT_CHARS, MAX_VERSIONS, activePath, busyReason, chatTitle, editInfo, editUserMessage, interruptMessages, releaseRun, startAssistant, switchVersion, titleAfterEdit, touchIndex, trimMessagesForStorage,
  turnToShow, versionInfo,
  type AssistantMsg, type ChatMsg, type IdeaMsg, type UserMsg,
} from "@scholar/shared";
import { stubPapers } from "./stub";

/* Editing a message and keeping what it replaced (docs/design/chat-actions-context.md, section 4): the replaced text and everything after it is kept on the message as a version, the
   list of messages stays the flat list of the version being read, and nothing of a kept version can reach anything that walks the active list. All of it is pure. */

const user = (id: string, text: string, at = 1): UserMsg => ({ id, role: "user", text, at });
const reply = (id: string, over: Partial<AssistantMsg> = {}): AssistantMsg => ({ ...startAssistant(id, "q", 1), status: "done", step: null, papersFinal: true, ...over });
const idea = (id: string, text = "an idea"): IdeaMsg => ({ id, role: "idea", text, at: 1 });
/** Two questions, each answered. */
const chat = (): ChatMsg[] => [user("u1", "ORIGINAL-WORDS", 1), reply("a1", { query: "OLD-TAIL-ANSWER-1" }), user("u2", "second question", 2), reply("a2", { query: "OLD-TAIL-ANSWER-2" })];
const asUser = (m: ChatMsg | undefined): UserMsg => {
  if (m?.role !== "user") throw new Error("not a user message");
  return m;
};

describe("editUserMessage", () => {
  it("keeps the replaced text and every message after it as a version, and puts a new reply under the new words", () => {
    const msgs = chat();
    const out = editUserMessage(msgs, "u1", "NEW-WORDS", reply("a3", { status: "working", at: 50 }))!;
    expect(out.map((m) => m.id)).toEqual(["u1", "a3"]);
    const u = asUser(out[0]);
    expect(u).toMatchObject({ id: "u1", text: "NEW-WORDS", at: 50, ver: 1 });
    expect(u.versions).toEqual([
      { text: "ORIGINAL-WORDS", at: 1, tail: [msgs[1], msgs[2], msgs[3]] },
      { text: "NEW-WORDS", at: 50, tail: [] },
    ]);
  });

  it("is pure: the list it was given is not changed", () => {
    const msgs = chat();
    const copy = JSON.stringify(msgs);
    editUserMessage(msgs, "u1", "NEW-WORDS", reply("a3", { at: 5 }));
    expect(JSON.stringify(msgs)).toBe(copy);
  });

  it("a second edit keeps all three, in the order they were made, and the middle one has its own reply", () => {
    const first = editUserMessage(chat(), "u1", "SECOND-WORDS", reply("a3", { at: 5 }))!;
    const out = editUserMessage(first, "u1", "THIRD-WORDS", reply("a4", { at: 9 }))!;
    const u = asUser(out[0]);
    expect(u.versions!.map((v) => v.text)).toEqual(["ORIGINAL-WORDS", "SECOND-WORDS", "THIRD-WORDS"]);
    expect(u.ver).toBe(2);
    expect(u.versions![1]!.tail.map((m) => m.id)).toEqual(["a3"]);
    expect(u.versions![2]!.tail).toEqual([]);
    expect(out.map((m) => m.id)).toEqual(["u1", "a4"]);
  });

  it("an edit made inside a version that was kept earlier keeps that message's own versions in the tail it archives", () => {
    const inner = editUserMessage(chat(), "u2", "INNER-NEW", reply("a3", { at: 5 }))!; // u1 a1 u2(2 versions) a3
    const out = editUserMessage(inner, "u1", "OUTER-NEW", reply("a4", { at: 9 }))!;
    expect(out.map((m) => m.id)).toEqual(["u1", "a4"]);
    const archived = asUser(out[0]).versions![0]!.tail;
    expect(archived.map((m) => m.id)).toEqual(["a1", "u2", "a3"]);
    expect(asUser(archived[1]).versions).toHaveLength(2);
    // and going back brings the whole thing back, inner versions included
    const back = switchVersion(out, "u1", 0)!;
    expect(back.map((m) => m.id)).toEqual(["u1", "a1", "u2", "a3"]);
    expect(asUser(back[2])).toMatchObject({ text: "INNER-NEW", ver: 1 });
    expect(asUser(back[2]).versions!.map((v) => v.text)).toEqual(["second question", "INNER-NEW"]);
  });

  it(`keeps at most ${MAX_VERSIONS} versions: the oldest kept one goes first, the one being read never`, () => {
    let msgs = chat();
    for (let i = 1; i <= 7; i++) msgs = editUserMessage(msgs, "u1", `W${i}`, reply(`r${i}`, { at: 10 + i }))!;
    const u = asUser(msgs[0]);
    expect(u.versions!.map((v) => v.text)).toEqual(["W3", "W4", "W5", "W6", "W7"]);
    expect(u.ver).toBe(MAX_VERSIONS - 1);
    expect(u.text).toBe("W7");
    expect(JSON.stringify(msgs)).not.toContain("ORIGINAL-WORDS"); // the first one was dropped with its tail
  });

  it("when the reader went back to the oldest version and edits it, the version just left is not the one that is dropped", () => {
    let msgs = chat();
    for (let i = 1; i <= 4; i++) msgs = editUserMessage(msgs, "u1", `W${i}`, reply(`r${i}`, { at: 10 + i }))!; // ORIGINAL W1 W2 W3 W4: five
    expect(asUser(msgs[0]).versions).toHaveLength(MAX_VERSIONS);
    msgs = switchVersion(msgs, "u1", 0)!;
    const out = editUserMessage(msgs, "u1", "FROM-THE-OLDEST", reply("rX", { at: 99 }))!;
    const u = asUser(out[0]);
    expect(u.versions).toHaveLength(MAX_VERSIONS);
    expect(u.versions!.map((v) => v.text)).toEqual(["ORIGINAL-WORDS", "W2", "W3", "W4", "FROM-THE-OLDEST"]);
    expect(u.ver).toBe(MAX_VERSIONS - 1);
    expect(u.versions![0]!.tail.map((m) => m.id)).toEqual(["a1", "u2", "a2"]); // "you can go back to the earlier version" stays true for the one just replaced
  });

  it("refuses what is not a user message: an unknown id, a reply, an Idea Check", () => {
    const msgs = [...chat(), idea("i1")];
    expect(editUserMessage(msgs, "nope", "x", reply("r"))).toBeNull();
    expect(editUserMessage(msgs, "a1", "x", reply("r"))).toBeNull();
    expect(editUserMessage(msgs, "i1", "x", reply("r"))).toBeNull();
  });

  it("a reply that was still working when it was put away is kept as interrupted, and a strict check that was running is not kept as running", () => {
    const msgs: ChatMsg[] = [user("u1", "ORIGINAL-WORDS"), reply("a1", { status: "working" }), user("u2", "q2"), reply("a2", { strict: { status: "working" } })];
    const u = asUser(editUserMessage(msgs, "u1", "NEW", reply("r", { at: 5 }))![0]);
    const tail = u.versions![0]!.tail as AssistantMsg[];
    expect(tail[0]!.status).toBe("interrupted");
    expect(tail[2]!.strict).toBeUndefined();
  });

  it("a versions field that is not what it should be (damaged storage) is read as no versions, and the edit still works", () => {
    const broken = { ...user("u1", "ORIGINAL-WORDS"), versions: "nonsense", ver: 7 } as unknown as UserMsg;
    const out = editUserMessage([broken, reply("a1")], "u1", "NEW", reply("r", { at: 5 }))!;
    expect(asUser(out[0]).versions!.map((v) => v.text)).toEqual(["ORIGINAL-WORDS", "NEW"]);
  });
});

describe("switchVersion", () => {
  const edited = () => editUserMessage(chat(), "u1", "NEW-WORDS", reply("a3", { at: 50 }))!;

  it("brings an earlier version back with its text and its messages, and puts the one that was read away with its own", () => {
    const back = switchVersion(edited(), "u1", 0)!;
    expect(back.map((m) => m.id)).toEqual(["u1", "a1", "u2", "a2"]);
    expect(asUser(back[0])).toMatchObject({ text: "ORIGINAL-WORDS", at: 1, ver: 0 });
    expect(asUser(back[0]).versions![1]).toEqual({ text: "NEW-WORDS", at: 50, tail: [expect.objectContaining({ id: "a3" })] });
    expect(asUser(back[0]).versions![0]!.tail).toEqual([]); // the version being read has no kept tail: its messages are the live ones
  });

  it("going there and back gives exactly what it was", () => {
    const e = edited();
    expect(switchVersion(switchVersion(e, "u1", 0)!, "u1", 1)).toEqual(e);
  });

  it("is pure", () => {
    const e = edited();
    const copy = JSON.stringify(e);
    switchVersion(e, "u1", 0);
    expect(JSON.stringify(e)).toBe(copy);
  });

  it("refuses the version already read, one that is not there, a message with no versions, and what is not a user message", () => {
    const e = edited();
    expect(switchVersion(e, "u1", 1)).toBeNull();
    expect(switchVersion(e, "u1", 2)).toBeNull();
    expect(switchVersion(e, "u1", -1)).toBeNull();
    expect(switchVersion(e, "u1", 0.5)).toBeNull();
    expect(switchVersion(chat(), "u1", 0)).toBeNull();
    expect(switchVersion(e, "a3", 0)).toBeNull();
    expect(switchVersion(e, "nope", 0)).toBeNull();
  });
});

describe("versionInfo", () => {
  it("a message that was never edited has one version", () => {
    expect(versionInfo(user("u", "x"))).toEqual({ count: 1, number: 1, hasPrev: false, hasNext: false });
  });
  it("counts from 1, says whether there is one before and one after, and reads a damaged field as one version", () => {
    const e = editUserMessage(chat(), "u1", "N", reply("a3", { at: 5 }))!;
    expect(versionInfo(asUser(e[0]))).toEqual({ count: 2, number: 2, hasPrev: true, hasNext: false });
    expect(versionInfo(asUser(switchVersion(e, "u1", 0)![0]))).toEqual({ count: 2, number: 1, hasPrev: false, hasNext: true });
    expect(versionInfo({ ...user("u", "x"), versions: [], ver: 3 } as UserMsg)).toEqual({ count: 1, number: 1, hasPrev: false, hasNext: false });
  });
});

describe("activePath: what anything that reads the conversation (a context for the model) is allowed to see", () => {
  it("has the messages being read and nothing of the versions that were replaced", () => {
    const e = editUserMessage(chat(), "u1", "NEW-WORDS", reply("a3", { at: 50, query: "NEW-ANSWER" }))!;
    const path = activePath(e);
    expect(path.map((m) => m.id)).toEqual(["u1", "a3"]);
    const wire = JSON.stringify(path);
    expect(wire).toContain("NEW-WORDS");
    for (const gone of ["ORIGINAL-WORDS", "OLD-TAIL-ANSWER-1", "OLD-TAIL-ANSWER-2", "second question", "versions", '"ver"']) expect(wire).not.toContain(gone);
  });
  it("holds even when the older version is the one being read and the newer one is kept", () => {
    const e = switchVersion(editUserMessage(chat(), "u1", "NEW-WORDS", reply("a3", { at: 50, query: "NEW-ANSWER" }))!, "u1", 0)!;
    const wire = JSON.stringify(activePath(e));
    expect(wire).toContain("ORIGINAL-WORDS");
    for (const gone of ["NEW-WORDS", "NEW-ANSWER", "versions"]) expect(wire).not.toContain(gone);
  });
  it("leaves a conversation that was never edited as it is, and does not change what it was given", () => {
    const msgs = chat();
    const path = activePath(msgs);
    expect(path).toEqual(msgs);
    expect(path[0]).toBe(msgs[0]);
    const e = editUserMessage(msgs, "u1", "N", reply("a3", { at: 5 }))!;
    const copy = JSON.stringify(e);
    activePath(e);
    expect(JSON.stringify(e)).toBe(copy);
  });
});

describe("keeping and reopening a conversation that has versions", () => {
  const long = { ...stubPapers()[0]!, abstract: "word ".repeat(300) };
  const withLong = (id: string, over: Partial<AssistantMsg> = {}) => reply(id, { papers: [long], live: "half", ...over });

  it("the replaced replies are cut for keeping like the others: abstracts to 600 characters, nothing provisional, a strict check only when it was done", () => {
    const msgs: ChatMsg[] = [user("u1", "ORIGINAL-WORDS"), withLong("a1", { strict: { status: "working" } }), user("u2", "q2"), withLong("a2")];
    const e = editUserMessage(msgs, "u1", "NEW", reply("r", { at: 5 }))!;
    const kept = trimMessagesForStorage(e);
    const tail = asUser(kept[0]).versions![0]!.tail as ChatMsg[];
    const a1 = tail[0] as AssistantMsg;
    const a2 = tail[2] as AssistantMsg;
    expect(a1.papers[0]!.abstract!.length).toBeLessThanOrEqual(602);
    expect(a2.papers[0]!.abstract!.endsWith("…")).toBe(true);
    expect(a2.live).toBe("");
    expect(JSON.stringify(e)).toContain("word ".repeat(100)); // while the page has them, they are whole (Check strictly stays possible on a version that was just switched to)
  });

  it("goes down through versions inside versions", () => {
    const inner = editUserMessage([user("u1", "q1"), reply("a1"), user("u2", "ORIGINAL-INNER"), withLong("a2")], "u2", "INNER-NEW", reply("a3", { at: 5 }))!;
    const outer = editUserMessage(inner, "u1", "OUTER-NEW", reply("a4", { at: 9 }))!;
    const kept = trimMessagesForStorage(outer);
    const archivedInner = asUser(asUser(kept[0]).versions![0]!.tail[1]); // u2, inside the tail that was put away
    const deep = archivedInner.versions![0]!.tail[0] as AssistantMsg; // the reply of u2's own first version
    expect(deep.papers[0]!.abstract!.endsWith("…")).toBe(true);
    expect(deep.live).toBe("");
  });

  it("a reply that was still working in a version that was put away reads as interrupted when the conversation is opened again", () => {
    const e = editUserMessage([user("u1", "q"), reply("a1")], "u1", "NEW", reply("r", { at: 5 }))!;
    const working = switchVersion(e, "u1", 0)!;
    const stuck: ChatMsg[] = [asUser(working[0]), { ...(working[1] as AssistantMsg), status: "working" }];
    const reopened = interruptMessages(stuck);
    expect((reopened[1] as AssistantMsg).status).toBe("interrupted");
    // and the replaced version's own reply, were it working, the same
    const hidden = asUser(e[0]);
    const withWorking = { ...hidden, versions: hidden.versions!.map((v, i) => (i === 0 ? { ...v, tail: [{ ...(v.tail[0] as AssistantMsg), status: "working" as const }] } : v)) };
    const again = interruptMessages([withWorking, e[1]!]);
    expect((asUser(again[0]).versions![0]!.tail[0] as AssistantMsg).status).toBe("interrupted");
  });

  it("messages without versions come back as the very same objects, so a conversation kept before versions existed opens unchanged", () => {
    const msgs = chat();
    const reopened = interruptMessages(msgs);
    expect(reopened[0]).toBe(msgs[0]);
    expect(reopened[1]).toBe(msgs[1]);
    expect(trimMessagesForStorage(msgs)[0]).toBe(msgs[0]);
  });
});

describe("editInfo: what an edit of this message is, read from the reply it was paired with", () => {
  it("a message sent to Auto is edited as Auto (20,000 characters at most); one searched by hand as a search (300), in the place it looked", () => {
    const auto = editInfo([user("u1", "x"), reply("a1", { auto: true })], "u1")!;
    expect(auto).toMatchObject({ at: 0, mode: "auto", scope: "all", limit: MAX_AUTO_CHARS, later: 0 });
    const hand = editInfo([user("u1", "x"), reply("a1", { auto: false, scope: "india" })], "u1")!;
    expect(hand).toMatchObject({ mode: "search", scope: "india", limit: MAX_CHAT_CHARS });
  });
  it("says how many messages come after the reply, which an edit would put away", () => {
    expect(editInfo(chat(), "u1")!.later).toBe(2);
    expect(editInfo(chat(), "u2")!.later).toBe(0);
  });
  it("is nothing for a message with no reply (the text echoed with an Idea Check, a question whose reply is missing), or for what is not a user message", () => {
    expect(editInfo([user("u1", "an idea"), idea("i1", "an idea")], "u1")).toBeNull();
    expect(editInfo([user("u1", "x")], "u1")).toBeNull();
    expect(editInfo(chat(), "a1")).toBeNull();
    expect(editInfo(chat(), "missing")).toBeNull();
  });
  it("a reply kept before Auto existed has no 'auto' and is a search", () => {
    const old = reply("a1") as Partial<AssistantMsg>;
    delete old.auto;
    expect(editInfo([user("u1", "x"), old as AssistantMsg], "u1")!.mode).toBe("search");
  });
});

describe("busyReason: when an edit or a switch must wait", () => {
  it("is null for a conversation at rest", () => expect(busyReason(chat())).toBeNull());
  it("a reply that is being written", () => expect(busyReason([user("u", "x"), reply("a", { status: "working" })])).toBe("reply"));
  it("a strict check that is running on a finished reply", () => expect(busyReason([user("u", "x"), reply("a", { strict: { status: "working" } })])).toBe("strict"));
  it("a failed or finished strict check is not busy", () => expect(busyReason([user("u", "x"), reply("a", { strict: { status: "failed", note: "n" } })])).toBeNull());
  it("a reply being written comes first when both are there", () => expect(busyReason([user("u", "x"), reply("a", { strict: { status: "working" } }), user("v", "y"), reply("b", { status: "working" })])).toBe("reply"));
  it("is null for an empty conversation", () => expect(busyReason([])).toBeNull());
});

describe("titleAfterEdit", () => {
  it("the title follows the first message when that is what was edited", () => {
    const msgs = chat();
    expect(titleAfterEdit(msgs, "u1", "a different first question", chatTitle("ORIGINAL-WORDS"))).toBe("a different first question");
  });
  it("a later message does not change the title", () => {
    expect(titleAfterEdit(chat(), "u2", "something else", chatTitle("ORIGINAL-WORDS"))).toBe("ORIGINAL-WORDS");
  });
  it("a title that is not made of the first message's words is left alone", () => {
    expect(titleAfterEdit(chat(), "u1", "something else", "Chat")).toBe("Chat");
  });
  it("is cut like any title", () => {
    const long = "what is the best method to screen for glaucoma in rural primary health centres of India today";
    expect(titleAfterEdit(chat(), "u1", long, chatTitle("ORIGINAL-WORDS"))).toBe(chatTitle(long));
  });
  it("is not changed by an Idea Check that comes first", () => {
    expect(titleAfterEdit([idea("i1"), ...chat()], "u1", "x y", "an idea")).toBe("an idea");
  });
});

describe("the store's two fixes, as pure decisions", () => {
  it("a run that was stopped and ends after a new one began does not unregister the new one", () => {
    const first = { ctl: { name: "first" } };
    const second = { ctl: { name: "second" } };
    const runs = new Map<string, { ctl: unknown }>([["c", first]]);
    runs.set("c", second); // the new run is registered while the stopped one is still winding up
    expect(releaseRun(runs, "c", first.ctl)).toBe(false);
    expect(runs.get("c")).toBe(second);
    expect(releaseRun(runs, "c", second.ctl)).toBe(true);
    expect(runs.has("c")).toBe(false);
  });
  it("releasing a chat that has no run, or another chat's run, does nothing", () => {
    const a = { ctl: {} };
    const runs = new Map<string, { ctl: unknown }>([["a", a]]);
    expect(releaseRun(runs, "b", a.ctl)).toBe(false);
    expect(runs.size).toBe(1);
  });

  type Entry = { id: string; title: string; updatedAt: number; kw?: string };
  it("touching a chat moves it to the front and keeps every field the entry has, known or not", () => {
    const index: Entry[] = [{ id: "a", title: "A", updatedAt: 1 }, { id: "b", title: "B", updatedAt: 2, kw: "glaucoma screening" }];
    const { kept, dropped } = touchIndex(index, "b", undefined, 9, 30);
    expect(kept).toEqual([{ id: "b", title: "B", updatedAt: 9, kw: "glaucoma screening" }, { id: "a", title: "A", updatedAt: 1 }]);
    expect(dropped).toEqual([]);
  });
  it("takes a new title when given one, and falls back to the old title, then to 'Chat'", () => {
    const index: Entry[] = [{ id: "a", title: "Old", updatedAt: 1, kw: "k" }];
    expect(touchIndex(index, "a", "New", 5, 30).kept[0]).toEqual({ id: "a", title: "New", updatedAt: 5, kw: "k" });
    expect(touchIndex(index, "a", undefined, 5, 30).kept[0]!.title).toBe("Old");
    expect(touchIndex(index, "z", undefined, 5, 30).kept[0]).toEqual({ id: "z", title: "Chat", updatedAt: 5 });
  });
  it("a chat past the limit is dropped and handed back so its record can be deleted; exactly at the limit nothing goes", () => {
    const index: Entry[] = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, title: `T${i}`, updatedAt: i }));
    const same = touchIndex(index, "c29", undefined, 99, 30);
    expect(same.kept).toHaveLength(30);
    expect(same.dropped).toEqual([]);
    const over = touchIndex(index, "new", "New", 99, 30);
    expect(over.kept).toHaveLength(30);
    expect(over.kept[0]!.id).toBe("new");
    expect(over.dropped.map((e) => e.id)).toEqual(["c29"]);
  });
  it("is pure: the index it was given is not changed", () => {
    const index: Entry[] = [{ id: "a", title: "A", updatedAt: 1 }];
    const copy = JSON.stringify(index);
    touchIndex(index, "a", "B", 2, 30);
    expect(JSON.stringify(index)).toBe(copy);
  });
});

describe("turnToShow: when the page brings a question to the top of the window", () => {
  const ab = (): ChatMsg[] => [user("u1", "q1"), reply("a1")];
  it("when a conversation is opened (from nothing, or another conversation)", () => {
    expect(turnToShow(null, ab())).toBe("question");
    expect(turnToShow([], ab())).toBe("question");
    expect(turnToShow([user("x1", "another conversation"), reply("x2")], ab())).toBe("question");
  });
  it("when a question is added at the end, with its reply", () => {
    expect(turnToShow(ab(), [...ab(), user("u2", "q2"), reply("a2", { status: "working" })])).toBe("question");
  });
  it("when an Idea Check is added after a reply (Change to Idea Check), and when one comes with the text echoed before it", () => {
    expect(turnToShow(ab(), [...ab(), idea("i1")])).toBe("idea");
    expect(turnToShow(ab(), [...ab(), user("u2", "an idea"), idea("i1", "an idea")])).toBe("question");
  });
  it("not when nothing changed, or a reply was written again in place, or only a reply came", () => {
    const msgs = ab();
    expect(turnToShow(msgs, [...msgs])).toBeNull();
    expect(turnToShow(msgs, [msgs[0]!, reply("a1", { query: "again" })])).toBeNull();
    expect(turnToShow(msgs, [...msgs, reply("a9")])).toBeNull();
  });
  it("not when the messages of another version came in (the same first message, a different tail), however long that tail is", () => {
    const e = editUserMessage(chat(), "u1", "NEW", reply("a3", { at: 5 }))!;
    expect(turnToShow(e, switchVersion(e, "u1", 0)!)).toBeNull();
    expect(turnToShow(switchVersion(e, "u1", 0)!, e)).toBeNull();
  });
  it("not when an edit shortened the list", () => {
    const e = editUserMessage(chat(), "u1", "NEW", reply("a3", { at: 5 }))!;
    expect(turnToShow(chat(), e)).toBeNull();
  });
  it("not for an empty list", () => expect(turnToShow(chat(), [])).toBeNull());
});

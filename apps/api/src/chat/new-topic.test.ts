import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DID_NOT_FINISH_NOTICE, DID_NOT_FINISH_NOTICE_HINGLISH, NOTICE_KINDS, activePath, askedTurns, canStartNewTopic, contextBefore, didNotFinishText, editUserMessage, interruptMessages, lastReplyDidNotFinish, startAssistant, switchVersion,
  topicStart, trimMessagesForStorage, usesEarlierTurns,
  type AssistantMsg, type ChatMsg, type HistoryEntry, type IdeaMsg, type Paper, type UserMsg,
} from "@scholar/shared";
import { readHistory } from "./history";

/* "New topic" and the line "did not finish" (docs/design/intent-and-state.md, 4.19 R22, 7.2 and 7.3). The person presses "New topic"; the NEXT user message carries an optional `newTopic` (an optional field of
   UserMsg: no new store, no migration), the history the page sends from then on starts at that message, and the turns before it stay on the page and are simply not carried: it sends LESS, never more.
   A reply that did not finish is still not carried (context-before.test.ts pins that), but the next reply says so in one line when it followed the turns before it. */

const user = (id: string, text: string, at = 1): UserMsg => ({ id, role: "user", text, at });
const paper = (n: number): Paper => ({ id: `doi:10.1/${n}`, doi: `10.1/${n}`, pmid: null, title: `Paper title ${n}`, authors: ["A. B"], year: 2020 + n, venue: "J", abstract: "An abstract.", citationCount: 1, oaUrl: null, retracted: false, retractionSources: [], sources: ["openalex"], score: 1 });
const reply = (id: string, over: Partial<AssistantMsg> = {}): AssistantMsg => ({ ...startAssistant(id, "q", 1, true), understood: true, how: "rules", status: "done", step: null, papersFinal: true, papers: [paper(1)], answer: null, ...over });
const idea = (id: string): IdeaMsg => ({ id, role: "idea", text: "an idea", at: 1 });
const turn = (i: number, over: Partial<AssistantMsg> = {}, text = `question number ${i}`): ChatMsg[] => [user(`u${i}`, text, i), reply(`a${i}`, { query: text, ...over })];
const chat = (n: number): ChatMsg[] => Array.from({ length: n }, (_, i) => turn(i + 1)).flat();
/** The user message with this id carries the marker (the page sets it on the message sent after "New topic"). */
const mark = (msgs: ChatMsg[], id: string): ChatMsg[] => msgs.map((m) => (m.id === id && m.role === "user" ? { ...m, newTopic: true as const } : m));
const json = (x: unknown) => JSON.stringify(x);
const asks = (h: HistoryEntry[]) => h.flatMap((e) => (e.role === "user" ? [e.text] : []));
const failed = (i: number, status: "stopped" | "error" | "interrupted" = "stopped"): ChatMsg[] => [user(`f${i}`, `failed message ${i}`), reply(`fa${i}`, { status, papers: [] })];

describe("the marker is an optional field of the message, and old records have none", () => {
  it("it is kept when a chat is kept: written as text and read back, with the replies cut for keeping, and after a reload", () => {
    const msgs = mark(chat(3), "u2");
    const back = interruptMessages(JSON.parse(JSON.stringify(trimMessagesForStorage(msgs))) as ChatMsg[]);
    expect(back.find((m) => m.id === "u2")).toMatchObject({ newTopic: true });
    expect(back.filter((m) => m.role === "user" && m.newTopic)).toHaveLength(1);
    expect(asks(contextBefore(back, back.length))).toEqual(["question number 2", "question number 3"]);
  });

  it("a record kept before it existed has no such field and loads as it always did (nothing is carried less than before)", () => {
    const old = JSON.parse(JSON.stringify(chat(4))) as ChatMsg[];
    expect(old.some((m) => m.role === "user" && "newTopic" in m)).toBe(false);
    expect(asks(contextBefore(old, old.length))).toEqual(["question number 2", "question number 3", "question number 4"]);
    expect(topicStart(activePath(old))).toBe(0);
    expect(canStartNewTopic(old)).toBe(true);
  });

  it("only `true` is a marker: any other value (a damaged record, a number, a string) is none", () => {
    const msgs = chat(3).map((m) => (m.id === "u2" ? ({ ...m, newTopic: 1 } as unknown as ChatMsg) : m.id === "u3" ? ({ ...m, newTopic: "true" } as unknown as ChatMsg) : m));
    expect(topicStart(activePath(msgs))).toBe(0);
    expect(asks(contextBefore(msgs, msgs.length))).toEqual(["question number 1", "question number 2", "question number 3"]);
  });

  it("it stays on the message through an edit (the marker belongs to the message's place, as its id does) and through a version switch", () => {
    const msgs = mark(chat(3), "u2");
    const edited = editUserMessage(msgs, "u2", "second question, reworded", reply("a9", { status: "working" }))!;
    const at = edited.findIndex((m) => m.id === "u2");
    expect(edited[at]).toMatchObject({ newTopic: true, text: "second question, reworded" });
    const back = switchVersion(edited, "u2", 0)!;
    expect(back.find((m) => m.id === "u2")).toMatchObject({ newTopic: true, text: "question number 2" });
    expect(switchVersion(back, "u2", 1)!.find((m) => m.id === "u2")).toMatchObject({ newTopic: true });
  });
});

describe("the history the page sends starts at the marker", () => {
  it("carries only the turns from the marked message on: the earlier turns are not in it", () => {
    const msgs = mark(chat(5), "u3");
    const out = contextBefore(msgs, msgs.length);
    expect(asks(out)).toEqual(["question number 3", "question number 4", "question number 5"]);
    expect(json(out)).not.toMatch(/question number [12]\b/);
  });

  it("the marked message's own turn is carried to the messages after it (it is the first turn of the new topic)", () => {
    const msgs = mark(chat(3), "u3");
    expect(asks(contextBefore(msgs, msgs.length))).toEqual(["question number 3"]);
  });

  it("the marked message is sent with nothing: whether it is not in the list yet (just sent), or is, in the place `upTo` names (an edit, Search again)", () => {
    const base = chat(3);
    // just sent: the page asks with the new message at the end of the list it gives
    const sent: ChatMsg[] = [...base, { ...user("u4", "a new topic"), newTopic: true }];
    expect(contextBefore(sent, base.length)).toEqual([]);
    // an edit of it, and Search again on its reply: the position of the user message
    const msgs = mark(chat(4), "u3");
    expect(contextBefore(msgs, 4)).toEqual([]);
    // the message after it leans on it and on nothing before it
    expect(asks(contextBefore(msgs, 6))).toEqual(["question number 3"]);
  });

  it("with two markers only the last counts", () => {
    const msgs = mark(mark(chat(6), "u2"), "u5");
    expect(asks(contextBefore(msgs, msgs.length))).toEqual(["question number 5", "question number 6"]);
  });

  it("the last three turns of the new topic are carried as always: a marker far back leaves them whole", () => {
    const msgs = mark(chat(9), "u2");
    expect(asks(contextBefore(msgs, msgs.length))).toEqual(["question number 7", "question number 8", "question number 9"]);
  });

  it("no marker, no change: the history of a chat without one is exactly what it was", () => {
    const msgs = chat(4);
    expect(contextBefore(msgs, msgs.length)).toEqual(contextBefore(JSON.parse(json(msgs)) as ChatMsg[], msgs.length));
    expect(asks(contextBefore(msgs, msgs.length))).toEqual(["question number 2", "question number 3", "question number 4"]);
  });

  it("a marked message whose reply did not finish leaves the next message with nothing to lean on (it does NOT fall back to the topic before the marker)", () => {
    const msgs: ChatMsg[] = [...chat(2), { ...user("m", "a new topic that failed"), newTopic: true }, reply("ma", { status: "stopped", papers: [] })];
    expect(contextBefore(msgs, msgs.length)).toEqual([]);
    expect(lastReplyDidNotFinish(msgs, msgs.length)).toBe(true);
  });

  it("the history is still what the server accepts: it reads it in full, nothing dropped", () => {
    const msgs = mark(chat(5), "u2");
    const read = readHistory(contextBefore(msgs, msgs.length));
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.history.dropped).toBe(0);
  });

  it("an Idea Check and the text echoed with it do not move the marker or carry anything", () => {
    const msgs: ChatMsg[] = [...chat(2), { ...user("m", "idea words"), newTopic: true }, idea("i1"), ...turn(4)];
    expect(asks(contextBefore(msgs, msgs.length))).toEqual(["question number 4"]);
  });
});

describe("an edit, a version switch and Search again, with a marker in the chat", () => {
  /** Five turns, the marker on the third message. */
  const five = () => mark(chat(5), "u3");

  it("an edit of a message BEFORE the marker puts the marker away with the rest: the new chat has no marker, and the topic it starts is the edited one", () => {
    const edited = editUserMessage(five(), "u1", "first question, reworded", reply("a9", { status: "working" }))!;
    expect(edited).toHaveLength(2);
    expect(edited.some((m) => m.role === "user" && m.newTopic)).toBe(false);
    const next = [...edited.slice(0, 1), reply("a9", { query: "first question, reworded" }), ...turn(7)];
    expect(asks(contextBefore(next, next.length))).toEqual(["first question, reworded", "question number 7"]);
    // and the version put away still has it: going back brings the marker, and the cut with it
    const back = switchVersion(edited, "u1", 0)!;
    expect(asks(contextBefore(back, back.length))).toEqual(["question number 3", "question number 4", "question number 5"]);
  });

  it("an edit of a message AFTER the marker is sent with what is between the marker and it, and nothing before the marker", () => {
    const msgs = five();
    // editing question 4 (its user message is at index 6): the marked turn only
    expect(asks(contextBefore(msgs, 6))).toEqual(["question number 3"]);
    // editing question 5 (index 8): the two turns from the marker on
    expect(asks(contextBefore(msgs, 8))).toEqual(["question number 3", "question number 4"]);
    const edited = editUserMessage(msgs, "u4", "fourth, reworded", reply("a9", { status: "working" }))!;
    expect(edited.find((m) => m.id === "u3")).toMatchObject({ newTopic: true });
  });

  it("an edit of the marked message keeps the marker and is sent with nothing", () => {
    const msgs = five();
    expect(contextBefore(msgs, 4)).toEqual([]);
    const edited = editUserMessage(msgs, "u3", "third, reworded", reply("a9", { status: "working" }))!;
    expect(edited.find((m) => m.id === "u3")).toMatchObject({ newTopic: true });
    expect(contextBefore(edited, edited.findIndex((m) => m.id === "u3"))).toEqual([]);
  });

  it("switching to another version across the marker: the marker goes with the version that has it, and the chat is cut where it is now", () => {
    const base = mark(chat(4), "u3");
    // the first message is edited: the old tail (with the marker) is put away
    const edited = editUserMessage(base, "u1", "reworded first", reply("a9", { query: "reworded first", status: "done" }))!;
    expect(asks(contextBefore([...edited, ...turn(8)], edited.length))).toEqual(["reworded first"]);
    const old = switchVersion(edited, "u1", 0)!;
    expect(old.some((m) => m.role === "user" && m.newTopic)).toBe(true);
    expect(asks(contextBefore(old, old.length))).toEqual(["question number 3", "question number 4"]);
    const again = switchVersion(old, "u1", 1)!;
    expect(again.some((m) => m.role === "user" && m.newTopic)).toBe(false);
  });

  it("Search again on a reply is sent with the turns from the marker to ITS question: the reply to the marked message gets nothing", () => {
    const msgs = five();
    // the reply to question 3 is at index 5, its question at 4 (marked)
    expect(contextBefore(msgs, 4)).toEqual([]);
    // the reply to question 5 is at 9, its question at 8
    expect(asks(contextBefore(msgs, 8))).toEqual(["question number 3", "question number 4"]);
  });

  it("the replaced words of an edited message are in nothing the page sends or the state holds, with or without a marker", () => {
    const base = mark([...turn(1, {}, "ORIGINAL-WORDS"), ...turn(2, {}, "SECOND-WORDS"), ...turn(3, {}, "THIRD-WORDS")], "u2");
    const edited = editUserMessage(base, "u2", "NEW-WORDS", reply("a9", { query: "NEW-WORDS" }))!;
    const next = [...edited, ...turn(7, {}, "NEXT-WORDS")];
    expect(json(contextBefore(next, next.length))).not.toMatch(/ORIGINAL|SECOND|THIRD/);
  });
});

describe("when the person can press New topic", () => {
  it("not in an empty chat, not before one search has finished, not after small talk or a failed reply alone", () => {
    expect(canStartNewTopic([])).toBe(false);
    expect(canStartNewTopic([user("u1", "glaucoma screening")])).toBe(false);
    expect(canStartNewTopic([user("u1", "glaucoma screening"), reply("a1", { status: "working" })])).toBe(false);
    expect(canStartNewTopic(failed(1))).toBe(false);
    expect(canStartNewTopic([user("u1", "hello there"), reply("a1", { reason: "small_talk", papers: [] })])).toBe(false);
    expect(canStartNewTopic([idea("i1")])).toBe(false);
  });

  it("after one finished search, and still after more", () => {
    expect(canStartNewTopic(chat(1))).toBe(true);
    expect(canStartNewTopic(chat(7))).toBe(true);
    expect(canStartNewTopic([...chat(1), ...failed(1)])).toBe(true);
  });

  it("only about the version being read: a finished search that was put away by an edit does not count", () => {
    expect(canStartNewTopic(chat(1))).toBe(true);
    const edited = editUserMessage(chat(1), "u1", "reworded", reply("a9", { status: "working" }))!;
    expect(canStartNewTopic(edited)).toBe(false);
  });

  it("not again right after a marked message that has no finished search yet; yes once it has one", () => {
    const sent: ChatMsg[] = [...chat(2), { ...user("m", "a new topic"), newTopic: true }, reply("ma", { status: "working", papers: [] })];
    expect(canStartNewTopic(sent)).toBe(false);
    const done: ChatMsg[] = [...chat(2), { ...user("m", "a new topic"), newTopic: true }, reply("ma", { query: "a new topic" })];
    expect(canStartNewTopic(done)).toBe(true);
  });
});

describe("the line 'did not finish'", () => {
  it("the sentences are the plan's, word for word (5.4, S-DID-NOT-FINISH), and the kind is its own (no collision with the safety kinds or `weak`)", () => {
    const doc = readFileSync(fileURLToPath(new URL("../../../../docs/design/intent-and-state.md", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
    expect(doc.includes(`**S-DID-NOT-FINISH** (R22): ${DID_NOT_FINISH_NOTICE} / ${DID_NOT_FINISH_NOTICE_HINGLISH}`)).toBe(true);
    expect(DID_NOT_FINISH_NOTICE).toBe("Your last message did not finish, so this follows the one before it.");
    expect(NOTICE_KINDS).toContain("unfinished");
    expect(new Set(NOTICE_KINDS).size).toBe(NOTICE_KINDS.length);
    for (const k of ["partial", "nothing", "retracted", "years", "weak", "safety_crisis", "safety_urgent", "safety_decision", "safety_care"]) expect(NOTICE_KINDS).toContain(k);
  });

  it("Hinglish for a message that is Hinglish, English for every other language (the plan has no Hindi sentence yet)", () => {
    expect(didNotFinishText("hinglish")).toBe(DID_NOT_FINISH_NOTICE_HINGLISH);
    for (const l of ["en", "hi", "other"] as const) expect(didNotFinishText(l)).toBe(DID_NOT_FINISH_NOTICE);
  });

  it("true when the reply just before the message did not finish (stopped, failed or interrupted), and there is a finished search before it to follow", () => {
    for (const status of ["stopped", "error", "interrupted"] as const) {
      const msgs = [...chat(2), ...failed(1, status)];
      expect(lastReplyDidNotFinish(msgs, msgs.length)).toBe(true);
    }
  });

  it("not when the last reply finished, nor when something that finished came after the failed one (small talk: the person's last message was that)", () => {
    expect(lastReplyDidNotFinish(chat(3), 6)).toBe(false);
    const talk: ChatMsg[] = [user("t1", "thanks a lot"), reply("ta1", { reason: "small_talk", papers: [] })];
    const msgs = [...chat(2), ...failed(1), ...talk];
    expect(lastReplyDidNotFinish(msgs, msgs.length)).toBe(false);
    // a finished search after the failure starts it again
    expect(lastReplyDidNotFinish([...chat(1), ...failed(1), ...turn(9)], 6)).toBe(false);
  });

  it("not for a reply that is still being written, and not for a chat that has nothing before the failure to follow (the caller checks that the page sent a history)", () => {
    const working = [...chat(1), user("w", "writing"), reply("wa", { status: "working", papers: [] })];
    expect(lastReplyDidNotFinish(working, working.length)).toBe(false);
    expect(contextBefore(failed(1), 2)).toEqual([]);
  });

  it("Search again on an older reply and an edit read it as of that message: a failure that came AFTER it is not what it followed", () => {
    const msgs = [...chat(2), ...failed(1), ...turn(9)];
    expect(lastReplyDidNotFinish(msgs, 4)).toBe(false); // the message at index 4 (the failed one) followed finished turns
    expect(lastReplyDidNotFinish(msgs, 6)).toBe(true); // the message at index 6 (after the failure) followed it
  });

  it("not for a marked message, which follows nothing", () => {
    const msgs: ChatMsg[] = [...chat(2), ...failed(1), { ...user("m", "a new topic"), newTopic: true }];
    expect(lastReplyDidNotFinish(msgs, msgs.length - 1)).toBe(false);
  });

  it("only when the server read the earlier turns and kept them: a message read as a new topic, one whose reading could not be used, and one that stood alone say nothing", () => {
    expect(usesEarlierTurns({ turns: 2, intent: "refine", rewrote: true, question: "q?" })).toBe(true);
    expect(usesEarlierTurns({ turns: 1, intent: "same_papers", rewrote: false })).toBe(true);
    expect(usesEarlierTurns({ turns: 2, intent: "new", rewrote: false })).toBe(false);
    expect(usesEarlierTurns({ turns: 2, intent: "refine", rewrote: false, fellBack: true })).toBe(false);
    expect(usesEarlierTurns({ turns: 0, intent: "new", rewrote: false, yearFrom: 2020 })).toBe(false);
    expect(usesEarlierTurns(undefined)).toBe(false);
    expect(usesEarlierTurns(5 as never)).toBe(false);
  });
});

describe("it asks no more of the page's other readers than before", () => {
  it("what the other chats may be told (`askedTurns`, the words a chat is found by) is not cut by the marker: it is a different thing from the context of this chat", () => {
    const msgs = mark(chat(4), "u3");
    expect(askedTurns(msgs).map((t) => t.question)).toEqual(["question number 1", "question number 2", "question number 3", "question number 4"]);
  });
});

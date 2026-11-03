import { describe, expect, it } from "vitest";
import {
  MAX_EARLIER_CHARS, MAX_EARLIER_ENTRIES, MAX_EARLIER_QUESTION_CHARS, MAX_EARLIER_QUERY_CHARS, MEMORY_FLOOR, MEMORY_WORDS, RAIL_CHATS,
  askedTurns, chatRequestBody, contentWords, contextBefore, earlierUsed, editUserMessage, fitEarlier, goneFromIndex, keywordsFor, lastQuestions, leftOfEarlier, ownedBy, parseIndex, pickEarlier, recallChats, startAssistant, touchIndex, wordKey, withHeld,
  type AssistantMsg, type ChatMsg, type EarlierQuestion, type HistoryEntry, type IdeaMsg, type MemoryEntry, type UserMsg,
} from "@scholar/shared";
import { readEarlier } from "./history";

/* Chat to chat (docs/design/chat-actions-context.md, section 6): the pure core of what the browser may carry from one chat to another. These tests say what the index words are made of (the person's own
   questions and the search words, never an answer, an idea, a pasted list, background or small talk), which chats may be drawn on (the rail's six, this person's, not excluded, not the open one), what
   counts as related (an unrelated question carries nothing: the floor), what is built from them (at most three questions and their search words, in the limits the server reads), and who a chat belongs to. */

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const user = (id: string, text: string, at = 1): UserMsg => ({ id, role: "user", text, at });
/** A finished search in Auto, as the page keeps it. */
const reply = (id: string, over: Partial<AssistantMsg> = {}): AssistantMsg => ({ ...startAssistant(id, "q", 1, true), understood: true, how: "rules", status: "done", step: null, papersFinal: true, ...over });
const idea = (id: string, text = "an idea"): IdeaMsg => ({ id, role: "idea", text, at: 1 });
const turn = (i: number, text: string, over: Partial<AssistantMsg> = {}): ChatMsg[] => [user(`u${i}`, text, i), reply(`a${i}`, { query: text, ...over })];
const entry = (id: string, kw: string | undefined, over: Partial<MemoryEntry> = {}): MemoryEntry => ({ id, title: id, updatedAt: NOW - DAY, owner: "me", ...(kw === undefined ? {} : { kw }), ...over });
const recall = (message: string, index: MemoryEntry[], over: Partial<Parameters<typeof recallChats>[0]> = {}) => recallChats({ message, index, owner: "me", currentId: null, now: NOW, ...over });
const json = (x: unknown) => JSON.stringify(x);
const zw = (code: number) => String.fromCodePoint(code);

describe("contentWords: the words a chat is found by", () => {
  it("drops English, Hinglish and Hindi little words and keeps the topic", () => {
    expect(contentWords("What is the role of metformin in PCOS for adolescents?")).toEqual(["metformin", "pcos", "adolescents"]);
    expect(contentWords("diabetes me exercise ka kya asar hota hai")).toEqual(["diabetes", "exercise"]);
    expect(contentWords("मधुमेह में व्यायाम का असर क्या होता है")).toEqual(["मधुमेह", "व्यायाम"]);
  });

  it("is in lower case, in order of first appearance, with no word twice", () => {
    expect(contentWords("Glaucoma GLAUCOMA screening, glaucoma")).toEqual(["glaucoma", "screening"]);
    expect(contentWords("costs cost Cost")).toEqual(["costs"]);
  });

  it("gives a word and its plural or -ing form the same key, so that 'costs' finds 'cost' and 'screening' finds 'screen'", () => {
    expect(wordKey("costs")).toBe(wordKey("cost"));
    expect(wordKey("screening")).toBe(wordKey("screen"));
    expect(wordKey("diseases")).toBe(wordKey("disease"));
    expect(wordKey("Glaucoma")).toBe(wordKey("glaucoma"));
  });

  it("does not run words together that only look alike: a word that merely ends in s, and a short one, keep their own key", () => {
    for (const w of ["analysis", "virus", "class", "king", "bed"]) expect(wordKey(w)).toBe(w);
    expect(wordKey("glaucoma")).not.toBe(wordKey("glaucomatous"));
  });

  it("leaves out the general words of research (a study, an effect, a review), which every chat has", () => {
    expect(contentWords("analysis")).toEqual([]);
    expect(contentWords("a review of the effects in studies")).toEqual([]);
  });

  it("leaves out numbers (a year is not a topic) and words of fewer than three letters", () => {
    expect(contentWords("only after 2020 in TB and AI 5")).toEqual([]);
    expect(contentWords("HIV 2019 trial")).toEqual(["hiv"]);
  });

  it("keeps a word with a digit in it (covid19, b12), which is a topic", () => {
    expect(contentWords("covid19 and vitamin b12")).toEqual(["covid19", "vitamin", "b12"]);
  });

  it("is empty for nothing, for only little words, and for text that is not a string", () => {
    expect(contentWords("")).toEqual([]);
    expect(contentWords("and in the of it?")).toEqual([]);
    expect(contentWords(undefined as unknown as string)).toEqual([]);
  });

  it("does not take invisible characters for part of a word (a zero-width space inside 'glaucoma')", () => {
    expect(contentWords(`gla${zw(0x200b)}ucoma`)).toEqual(contentWords("glaucoma"));
  });
});

describe("keywordsFor: the few words kept with each chat", () => {
  it("is made of the person's own questions and the search words of their replies", () => {
    const msgs = [...turn(1, "glaucoma screening in India", { searchQuery: "glaucoma screening programmes india" }), ...turn(2, "diabetic retinopathy")];
    const kw = keywordsFor(msgs).split(" ");
    for (const w of ["glaucoma", "screening", "india", "programmes", "diabetic", "retinopathy"]) expect(kw).toContain(w);
  });

  it("is empty for no chat and for a chat with no finished search", () => {
    expect(keywordsFor([])).toBe("");
    expect(keywordsFor([user("u1", "glaucoma"), reply("a1", { status: "working" })])).toBe("");
  });

  it("NEVER takes a word from an answer, whatever it says", () => {
    const answer = { text: "ANSWERCANARY molecule [1].", grounded: true, checked: true, citations: [{ n: 1, paperId: "p1", sentenceNo: 1, sentence: "SENTENCECANARY holds." }] };
    const kw = keywordsFor(turn(1, "glaucoma screening", { answer, live: "LIVECANARY" }));
    expect(kw).toContain("glaucoma");
    expect(kw).not.toMatch(/answercanary|molecule|sentencecanary|livecanary/);
  });

  it("NEVER takes a word from an Idea Check, or from the text echoed with one", () => {
    const text = "IDEACANARY my idea is to use drones for glaucoma screening in remote villages, is it new?";
    const kw = keywordsFor([user("u1", text), idea("i1", text), ...turn(2, "diabetic retinopathy")]);
    expect(kw).toContain("retinopathy");
    expect(kw).not.toMatch(/ideacanary|drone|village/);
    expect(keywordsFor([user("u1", text), idea("i1", text)])).toBe("");
    expect(keywordsFor([idea("i1", text)])).toBe("");
  });

  it("NEVER takes a word from a pasted list or a long text (a question over 300 characters)", () => {
    const paste = `PASTECANARY ${"glaucoma screening cost review in rural clinics, ".repeat(10)}`;
    expect(paste.length).toBeGreaterThan(300);
    expect(keywordsFor(turn(1, paste))).toBe("");
    expect(keywordsFor([...turn(1, paste), ...turn(2, "diabetic retinopathy")])).not.toMatch(/pastecanary|glaucoma/);
  });

  it("NEVER takes a word from small talk, a reply that offered another tool, a text too long for a search, a message that was not research, or a reply that did not finish", () => {
    const base = (text: string, over: Partial<AssistantMsg>) => keywordsFor(turn(1, text, over));
    expect(base("hello THANKSCANARY", { reason: "small_talk" })).toBe("");
    expect(base("ROUTEDCANARY check my references", { reason: "routed", mode: "verify" })).toBe("");
    expect(base("TOOLONGCANARY text", { reason: "too_long" })).toBe("");
    expect(base("NOTRESEARCHCANARY pizza", { general: { kind: "not_research", text: "x" } })).toBe("");
    expect(base("STOPPEDCANARY query", { status: "stopped", reason: "stopped" })).toBe("");
    expect(base("ERRORCANARY query", { status: "error" })).toBe("");
    expect(base("INTERRUPTEDCANARY query", { status: "interrupted" })).toBe("");
    expect(base("WORKINGCANARY query", { status: "working" })).toBe("");
  });

  it("NEVER takes a word of general background (the model's text with no source)", () => {
    const kw = keywordsFor(turn(1, "glaucoma screening", { general: { kind: "background", text: "BACKGROUNDCANARY is a disease of the optic nerve." } }));
    expect(kw).toContain("glaucoma");
    expect(kw).not.toMatch(/backgroundcanary|optic|nerve/);
  });

  it("is made from the version of a message that is being read: the words that were replaced are not in it, nor are the replies that went with them", () => {
    const first = [...turn(1, "OLDWORDS glaucoma screening", { searchQuery: "oldsearch glaucoma" }), ...turn(2, "second question OLDLATER topic")];
    expect(keywordsFor(first)).toMatch(/oldwords/);
    const edited = editUserMessage(first, "u1", "diabetic retinopathy", reply("a1b", { query: "diabetic retinopathy" }))!;
    const kw = keywordsFor(edited);
    expect(kw).toContain("retinopathy");
    expect(kw).not.toMatch(/oldwords|oldsearch|glaucoma|oldlater|second/);
  });

  it("keeps at most MEMORY_WORDS words, the newest questions' first, and never more than the characters the entry may take", () => {
    const msgs = Array.from({ length: 12 }, (_, i) => turn(i + 1, `alpha${i}x beta${i}x gamma${i}x delta${i}x`)).flat();
    const kw = keywordsFor(msgs).split(" ");
    expect(kw.length).toBe(MEMORY_WORDS);
    expect(kw[0]).toBe("alpha11x");
    expect(kw).not.toContain("alpha0x");
    expect(keywordsFor(msgs).length).toBeLessThanOrEqual(400);
  });

  it("keeps Devanagari words whole", () => {
    expect(keywordsFor(turn(1, "मधुमेह में व्यायाम का असर")).split(" ")).toEqual(["मधुमेह", "व्यायाम"]);
  });
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

  it("keeps an entry with its owner, its words and its exclusion", () => {
    expect(parseIndex([raw({ owner: "u1", kw: "glaucoma screen", nomem: true })], 30)).toEqual([{ id: "a", title: "A chat", updatedAt: 5, owner: "u1", kw: "glaucoma screen", nomem: true }]);
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

  it("does not keep an owner or a word list that is absurdly long (no 'owner' of a megabyte)", () => {
    const [e] = parseIndex([raw({ owner: "x".repeat(500), kw: "y".repeat(5000) })], 30);
    expect(e!.owner).toBeUndefined();
    expect((e!.kw ?? "").length).toBeLessThanOrEqual(400);
  });
});

describe("whose chats they are", () => {
  const index: MemoryEntry[] = [entry("mine", "a", { owner: "u1" }), entry("theirs", "b", { owner: "u2" }), entry("old", "c", { owner: undefined })];

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
    const { kept } = touchIndex([entry("a", "old words", { owner: undefined })], "a", undefined, 9, 30, { owner: "u1", kw: "new words" });
    expect(kept[0]).toEqual({ id: "a", title: "a", updatedAt: 9, owner: "u1", kw: "new words" });
    expect(touchIndex(kept, "a", undefined, 10, 30).kept[0]).toMatchObject({ owner: "u1", kw: "new words" });
  });

  it("a patch that says undefined takes the field away (a chat that has no words left keeps none)", () => {
    const { kept } = touchIndex([entry("a", "old words")], "a", undefined, 9, 30, { kw: undefined });
    expect(json(kept[0])).not.toContain("kw");
  });

  it("the thirty-first chat pushes the oldest out together with its words: nothing of it is left in what is kept", () => {
    const index30 = Array.from({ length: 30 }, (_, i) => entry(`c${i}`, `WORDS${i}`, { updatedAt: 1000 - i }));
    const { kept, dropped } = touchIndex(index30, "new", "New", 2000, 30, { kw: "fresh" });
    expect(kept).toHaveLength(30);
    expect(dropped.map((e) => e.id)).toEqual(["c29"]);
    expect(json(kept)).not.toContain("WORDS29");
  });
});

describe("which chats an open page lets go of when another tab changed the list", () => {
  const index = [entry("a", "x"), entry("b", "y")];

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

describe("recallChats: which earlier chats a new message may draw on", () => {
  it("is nothing for no chats", () => {
    expect(recall("and in children?", [])).toEqual([]);
  });

  it("an unrelated question matches nothing: the floor", () => {
    const index = [entry("g", "glaucoma screen india"), entry("d", "diabetes children insulin")];
    expect(recall("how does CRISPR editing work", index)).toEqual([]);
    expect(recall("what about the cost", index)).toEqual([]);
    expect(recall("and in 2020?", index)).toEqual([]);
    expect(MEMORY_FLOOR).toBeGreaterThan(0);
  });

  it("a question that shares a topic word finds that chat, and only that one", () => {
    const index = [entry("g", "glaucoma screen india"), entry("d", "diabetes children insulin")];
    expect(recall("and in children?", index)).toEqual(["d"]);
    expect(recall("glaucoma costs", index)).toEqual(["g"]);
  });

  it("a word that most of the chats share is not enough on its own, a word only one has is", () => {
    const index = ["a", "b", "c", "d", "e", "f"].map((id, i) => entry(id, `india topic${id}word`, { updatedAt: NOW - i * DAY }));
    expect(recall("and in india?", index)).toEqual([]);
    expect(recall("india topicdword", index)).toEqual(["d"]);
  });

  it("works in Hinglish and in Hindi: the little words of the language are not what is matched", () => {
    const index = [entry("h", "diabetes exercise"), entry("m", "मधुमेह व्यायाम"), entry("g", "glaucoma screen")];
    expect(recall("diabetes ke liye diet batao", index)).toEqual(["h"]);
    expect(recall("मधुमेह में आहार", index)).toEqual(["m"]);
    expect(recall("aur uske side effects?", index)).toEqual([]);
  });

  it("the best match first; of equal matches the newer chat, and of equal age the order is by id (no coin toss)", () => {
    const strong = entry("strong", "glaucoma screen cost india", { updatedAt: NOW - 100 * DAY });
    const weak = entry("weak", "glaucoma", { updatedAt: NOW - DAY });
    expect(recall("glaucoma screening cost india", [weak, strong, entry("x1", "other1"), entry("x2", "other2")])[0]).toBe("strong");
    const same = [entry("b", "glaucoma", { updatedAt: NOW - 5 * DAY }), entry("a", "glaucoma", { updatedAt: NOW - 5 * DAY }), entry("c", "glaucoma", { updatedAt: NOW - 2 * DAY })];
    expect(recall("glaucoma", same)).toEqual(["c", "a", "b"]);
    expect(recall("glaucoma", [...same].reverse())).toEqual(["c", "a", "b"]);
  });

  it("recency orders what is related and never makes anything related: an old chat with a real match is found, a new one without is not", () => {
    const index = [entry("old", "glaucoma", { updatedAt: NOW - 3000 * DAY }), entry("new", "retinopathy", { updatedAt: NOW })];
    expect(recall("glaucoma", index)).toEqual(["old"]);
  });

  it("at most three chats, however many match", () => {
    const index = Array.from({ length: 6 }, (_, i) => entry(`c${i}`, `topic${i}x`, { updatedAt: NOW - i * DAY }));
    // four chats relate, each by a word of its own, equally well: the three newest
    expect(recall("topic0x topic1x topic2x topic3x", index)).toEqual(["c0", "c1", "c2"]);
    expect(recall("topic3x topic4x topic5x topic1x", index)).toEqual(["c1", "c3", "c4"]);
  });

  it("only this person's own chats: another person's, and one that has no owner yet (it is theirs only once they open it), are not drawn on", () => {
    const index = [entry("mine", "glaucoma", { owner: "me" }), entry("theirs", "glaucoma", { owner: "someone-else" }), entry("old", "glaucoma", { owner: undefined })];
    expect(recall("glaucoma", index)).toEqual(["mine"]);
    expect(recall("glaucoma", index, { owner: null })).toEqual([]);
    expect(recall("glaucoma", index, { owner: undefined })).toEqual([]);
  });

  it("not a chat the person left out ('Do not use this chat as memory'), not the chat that is open", () => {
    const index = [entry("left-out", "glaucoma", { nomem: true }), entry("open", "glaucoma"), entry("other", "glaucoma")];
    expect(recall("glaucoma", index, { currentId: "open" })).toEqual(["other"]);
    expect(recall("glaucoma", [entry("left-out", "glaucoma", { nomem: true })])).toEqual([]);
  });

  it("only the chats the rail lists (the latest six): a seventh, which the person cannot see, is never drawn on", () => {
    const index = Array.from({ length: 8 }, (_, i) => entry(`c${i}`, i === 6 ? "glaucoma" : `other${i}x`, { updatedAt: NOW - i * DAY }));
    expect(RAIL_CHATS).toBe(6);
    expect(recall("glaucoma", index)).toEqual([]);
    expect(recall("glaucoma", [...index.slice(0, 5), index[6]!])).toEqual(["c6"]);
  });

  it("the open chat uses one of the six places: five others are what is left", () => {
    const index = Array.from({ length: 8 }, (_, i) => entry(`c${i}`, `glaucoma word${i}x`, { updatedAt: NOW - i * DAY }));
    const ids = recall("glaucoma", index, { currentId: "c0" });
    expect(ids).not.toContain("c0");
    expect(ids.every((id) => ["c1", "c2", "c3", "c4", "c5"].includes(id))).toBe(true);
  });

  it("a chat with no words (an Idea Check only, or kept before this existed) is never found", () => {
    expect(recall("glaucoma", [entry("none", undefined), entry("empty", "")])).toEqual([]);
  });

  it("a message with no words of its own (only little words, a year, a question mark) finds nothing", () => {
    expect(recall("and?", [entry("a", "glaucoma")])).toEqual([]);
    expect(recall("", [entry("a", "glaucoma")])).toEqual([]);
  });

  it("is cheap: thirty chats, a hundred searches", () => {
    const index = Array.from({ length: 30 }, (_, i) => entry(`c${i}`, Array.from({ length: MEMORY_WORDS }, (_, k) => `word${(i * 7 + k) % 80}x`).join(" ")));
    const t = performance.now();
    for (let i = 0; i < 100; i++) recall("word3x word41x something", index);
    expect(performance.now() - t).toBeLessThan(400);
  });
});

describe("pickEarlier: what is carried", () => {
  const index = [entry("g", "glaucoma screen india"), entry("d", "diabetes children insulin"), entry("x1", "xone"), entry("x2", "xtwo")];
  const r = (message: string, over: Partial<Parameters<typeof pickEarlier>[0]> = {}) => ({ message, index, owner: "me" as string | null, currentId: null, now: NOW, ...over });
  const found = [
    { id: "g", turns: [{ question: "glaucoma screening in India", searchQuery: "glaucoma screening india" }, { question: "diabetic retinopathy imaging" }, { question: "cataract surgery outcomes" }] },
    { id: "d", turns: [{ question: "insulin pumps in children", searchQuery: "insulin pump children" }] },
  ];

  it("is the questions of the chats that relate, with their search words, and not the other questions of those chats", () => {
    expect(pickEarlier(r("and in children?"), found)).toEqual([{ question: "insulin pumps in children", searchQuery: "insulin pump children" }]);
    expect(pickEarlier(r("glaucoma costs"), found)).toEqual([{ question: "glaucoma screening in India", searchQuery: "glaucoma screening india" }]);
  });

  it("is nothing when no question relates (the floor, again, for each question)", () => {
    expect(pickEarlier(r("how does CRISPR editing work"), found)).toEqual([]);
    expect(pickEarlier(r("what about the cost"), found)).toEqual([]);
    expect(pickEarlier(r("glaucoma"), [])).toEqual([]);
  });

  it("at most three, the best first; a better match comes before a newer one", () => {
    const many = [{ id: "g", turns: ["glaucoma screening india", "glaucoma screening india price", "glaucoma screening", "glaucoma", "glaucoma india"].map((question) => ({ question })) }];
    const out = pickEarlier(r("glaucoma screening india"), many);
    expect(out).toHaveLength(MAX_EARLIER_ENTRIES);
    expect(out[0]!.question).toMatch(/^glaucoma screening india/);
  });

  it("the same question twice is carried once", () => {
    const out = pickEarlier(r("glaucoma"), [{ id: "g", turns: [{ question: "Glaucoma screening" }, { question: "glaucoma  screening" }] }]);
    expect(out).toHaveLength(1);
  });

  it("holds only questions and their search words: never another key, never an answer, an idea or a list", () => {
    const out = pickEarlier(r("glaucoma"), [{ id: "g", turns: [{ question: "glaucoma screening", searchQuery: "glaucoma", answer: "ANSWERCANARY", idea: "IDEACANARY" } as EarlierQuestion] }]);
    expect(out).toEqual([{ question: "glaucoma screening", searchQuery: "glaucoma" }]);
    expect(json(out)).not.toMatch(/CANARY/);
  });

  it("draws only on the chats recallChats allowed: a chat that was not shortlisted is ignored even if its questions are given", () => {
    const out = pickEarlier(r("glaucoma", { index: [entry("g", "glaucoma", { nomem: true })] }), [{ id: "g", turns: [{ question: "glaucoma screening" }] }]);
    expect(out).toEqual([]);
    expect(pickEarlier(r("glaucoma", { owner: "someone-else" }), [{ id: "g", turns: [{ question: "glaucoma screening" }] }])).toEqual([]);
    // with one chat allowed, the questions of another that is given alongside are still left out
    const two = [entry("ok", "glaucoma"), entry("out", "glaucoma", { nomem: true })];
    const both = [{ id: "ok", turns: [{ question: "glaucoma screening in clinics" }] }, { id: "out", turns: [{ question: "glaucoma drops at night" }] }];
    expect(pickEarlier(r("glaucoma", { index: two }), both)).toEqual([{ question: "glaucoma screening in clinics" }]);
  });

  it("a question of a related chat must itself be related: one that shares only a word nearly every chat has is not carried", () => {
    const six = ["a", "b", "c", "d", "e"].map((id) => entry(id, `india topic${id}x`));
    const index = [entry("g", "glaucoma india"), ...six];
    const turns = [{ question: "glaucoma screening in India" }, { question: "cataract surgery in India" }];
    expect(pickEarlier(r("glaucoma india?", { index }), [{ id: "g", turns }])).toEqual([{ question: "glaucoma screening in India" }]);
  });
});

describe("fitEarlier: inside what the server reads", () => {
  const long = (c: string, n: number) => c.repeat(n);

  it("cuts a question and its search words to 200 characters each, on a whole character", () => {
    const out = fitEarlier([{ question: long("a", 260), searchQuery: long("b", 260) }]);
    expect(out[0]!.question).toHaveLength(MAX_EARLIER_QUESTION_CHARS);
    expect(out[0]!.searchQuery).toHaveLength(MAX_EARLIER_QUERY_CHARS);
    const hindi = fitEarlier([{ question: long("क्षत्रिय ", 40) }])[0]!.question;
    expect(hindi.length).toBeLessThanOrEqual(MAX_EARLIER_QUESTION_CHARS);
    expect(hindi.endsWith("य") || hindi.endsWith(" ") || hindi.endsWith("क्षत्रिय")).toBe(true);
    expect(fitEarlier([{ question: `${long("x", 199)}😀😀` }])[0]!.question).not.toMatch(/[\uD800-\uDBFF]$/);
  });

  it("keeps three at most, and drops the last ones until what is left is at most 800 characters (as the server does)", () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ question: `q${i}${long("a", 198)}`, searchQuery: `s${i}${long("b", 198)}` }));
    const out = fitEarlier(five);
    expect(out.length).toBeLessThanOrEqual(MAX_EARLIER_ENTRIES);
    const size = out.reduce((n, x) => n + x.question.length + (x.searchQuery?.length ?? 0), 0);
    expect(size).toBeLessThanOrEqual(MAX_EARLIER_CHARS);
    expect(out).toHaveLength(2);
    expect(out[0]!.question.startsWith("q0")).toBe(true);
  });

  it("the first one stays even when it alone is more than the total (the server keeps it too)", () => {
    expect(fitEarlier([{ question: long("a", 200), searchQuery: long("b", 200) }])).toHaveLength(1);
  });

  it("leaves out an entry the server would refuse (no letter or number in the question, under two characters), and a search that has none", () => {
    expect(fitEarlier([{ question: "?" }, { question: "!!!" }, { question: "a" }])).toEqual([]);
    expect(fitEarlier([{ question: "glaucoma", searchQuery: "..." }])).toEqual([{ question: "glaucoma" }]);
  });

  it("is empty for nothing, and one question stays one question on one line (no line break, nothing invisible)", () => {
    expect(fitEarlier([])).toEqual([]);
    expect(fitEarlier([{ question: `glau${zw(0x200b)}coma\nscreening\t${zw(0x202e)}here` }])).toEqual([{ question: "glaucoma screening here" }]);
  });

  it("the server's own reader takes what is built, whole and unchanged", () => {
    const built = fitEarlier([
      { question: "glaucoma screening in India", searchQuery: "glaucoma screening india" },
      { question: "मधुमेह में व्यायाम का असर" },
      { question: `${long("z", 250)}`, searchQuery: long("y", 250) },
    ]);
    const read = readEarlier(built);
    expect(read).toEqual({ ok: true, earlier: built });
  });
});

describe("lastQuestions: the last three searches of the chat a person chose to continue from", () => {
  it("is their questions and search words, the newest first, at most three", () => {
    const msgs = [1, 2, 3, 4, 5].flatMap((i) => turn(i, `question number ${i}`, { searchQuery: `words ${i}x` }));
    expect(lastQuestions(askedTurns(msgs))).toEqual([
      { question: "question number 5", searchQuery: "words 5x" },
      { question: "question number 4", searchQuery: "words 4x" },
      { question: "question number 3", searchQuery: "words 3x" },
    ]);
  });

  it("is empty for a chat with no finished search, and fewer than three when there are fewer", () => {
    expect(lastQuestions([])).toEqual([]);
    expect(lastQuestions(askedTurns(turn(1, "only one question")))).toEqual([{ question: "only one question" }]);
  });

  it("holds nothing of an idea, a pasted list, small talk or an answer", () => {
    const msgs = [...turn(1, "glaucoma screening"), user("u2", "IDEACANARY idea"), idea("i2", "IDEACANARY idea"), ...turn(3, "hello", { reason: "small_talk" }), ...turn(4, `PASTECANARY ${"x".repeat(320)}`)];
    expect(json(lastQuestions(askedTurns(msgs)))).toBe(json([{ question: "glaucoma screening" }]));
  });

  it("is inside the server's limits", () => {
    const msgs = [1, 2, 3].flatMap((i) => turn(i, `${"q".repeat(250)}${i}`, { searchQuery: "s".repeat(250) }));
    const got = lastQuestions(askedTurns(msgs));
    expect(readEarlier(got)).toEqual({ ok: true, earlier: got });
  });
});

describe("what a reply says it used from earlier chats", () => {
  const withContext = (earlier: EarlierQuestion[] | undefined, count: number | undefined): AssistantMsg => reply("a", { ...(earlier ? { earlier } : {}), context: { turns: 0, intent: "refine", rewrote: false, ...(count === undefined ? {} : { earlier: count }) } });

  it("is the questions that were sent, when the server says a model read them", () => {
    const q = [{ question: "one" }, { question: "two" }];
    expect(earlierUsed(withContext(q, 2))).toEqual(q);
  });

  it("is only as many as the server says it read", () => {
    expect(earlierUsed(withContext([{ question: "one" }, { question: "two" }], 1))).toEqual([{ question: "one" }]);
  });

  it("is nothing when no model read them (the rules settled the message, a visitor, the switch off at the server), and nothing when none were sent", () => {
    expect(earlierUsed(withContext([{ question: "one" }], undefined))).toEqual([]);
    expect(earlierUsed(withContext([{ question: "one" }], 0))).toEqual([]);
    expect(earlierUsed(withContext(undefined, 2))).toEqual([]);
    expect(earlierUsed(reply("a", { earlier: [{ question: "one" }] }))).toEqual([]);
  });

  it("is not fooled by what comes out of storage: not a list, a question that is not text", () => {
    const m = reply("a", { earlier: "nope" as unknown as EarlierQuestion[], context: { turns: 0, intent: "new", rewrote: false, earlier: 1 } });
    expect(earlierUsed(m)).toEqual([]);
    const m2 = reply("a", { earlier: [{ question: 3 }, null, { question: "fine" }] as unknown as EarlierQuestion[], context: { turns: 0, intent: "new", rewrote: false, earlier: 3 } });
    expect(earlierUsed(m2)).toEqual([{ question: "fine" }]);
  });
});

describe("chatRequestBody with earlier chats", () => {
  const history: HistoryEntry[] = [{ role: "user", text: "glaucoma screening" }, { role: "assistant" }];
  const earlier: EarlierQuestion[] = [{ question: "diabetes in children", searchQuery: "diabetes children" }];

  it("without them the body is exactly what it was", () => {
    expect(json(chatRequestBody({ signedIn: true, mode: "auto", message: "hello", history }))).toBe(json({ mode: "auto", message: "hello", history }));
    expect(json(chatRequestBody({ signedIn: true, mode: "auto", message: "hello", earlier: [] }))).toBe('{"mode":"auto","message":"hello"}');
    expect(json(chatRequestBody({ signedIn: true, mode: "auto", message: "hello", earlier: undefined }))).toBe('{"mode":"auto","message":"hello"}');
  });

  it("in Auto they go last, after the earlier turns of the same chat", () => {
    expect(Object.keys(chatRequestBody({ signedIn: true, mode: "auto", message: "x", scope: "india", history, earlier })).join()).toBe("mode,message,scope,history,earlier");
    expect(Object.keys(chatRequestBody({ signedIn: true, mode: "auto", message: "x", earlier })).join()).toBe("mode,message,earlier");
  });

  it("never in a search the reader chose, and never with 'anyway': the server refuses both", () => {
    expect(json(chatRequestBody({ signedIn: true, mode: "search", message: "x", earlier }))).toBe('{"mode":"search","message":"x"}');
    expect(json(chatRequestBody({ signedIn: true, mode: "auto", message: "x", anyway: true, earlier }))).toBe('{"mode":"auto","message":"x","anyway":true}');
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

describe("leftOfEarlier: asking an answer again after a question was taken off it", () => {
  const q = (question: string, searchQuery?: string): EarlierQuestion => ({ question, ...(searchQuery ? { searchQuery } : {}) });

  it("keeps what would be carried now AND is still left on the reply, in the order of now", () => {
    expect(leftOfEarlier([q("a b"), q("c d"), q("e f")], [q("e f"), q("a b")])).toEqual([q("a b"), q("e f")]);
  });

  it("never brings back a question the person took off, even if it relates again", () => {
    expect(leftOfEarlier([q("a b"), q("c d")], [q("c d")])).toEqual([q("c d")]);
  });

  it("sends nothing that is no longer allowed (the switch is off, the chip is gone, the chat was deleted: none of it is in now), though the reply still stores it", () => {
    expect(leftOfEarlier([], [q("a b"), q("c d")])).toEqual([]);
    expect(leftOfEarlier([q("c d")], [q("a b")])).toEqual([]);
  });

  it("takes the search words from now, not from what the reply stored", () => {
    expect(leftOfEarlier([q("a b", "new words")], [q("a b", "old words")])).toEqual([q("a b", "new words")]);
  });

  it("nothing left on the reply is nothing sent", () => expect(leftOfEarlier([q("a b")], [])).toEqual([]));
});

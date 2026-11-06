import { describe, expect, it } from "vitest";
import {
  LEDGER_FULL_TURNS, LEDGER_PAPERS, LEDGER_REPLY_CHARS, LEDGER_TOKEN_CAP, LEDGER_VISITOR_TURNS, buildLedger, editUserMessage, firstAuthor, intentOf, ledgerBefore, ledgerForSend, ledgerTokens, startAssistant, switchVersion,
  type AssistantMsg, type ChatMsg, type IdeaMsg, type LedgerTurn, type Paper, type UserMsg,
} from "@scholar/shared";

/* The turn ledger (design PDF "Sodhsetu understanding, follow-ups and MCP", M2; packages/shared/src/ledger.ts): what it holds of a chat, what it never holds, and what of it would be sent. */

const user = (id: string, text: string, over: Partial<UserMsg> = {}): UserMsg => ({ id, role: "user", text, at: 1, ...over });
const reply = (id: string, over: Partial<AssistantMsg> = {}): AssistantMsg => ({ ...startAssistant(id, "q", 1, true), understood: true, how: "rules", status: "done", step: null, papersFinal: true, ...over });
const paper = (i: number, over: Partial<Paper> = {}): Paper => ({ id: `doi:10.1/${i}`, doi: `10.1/${i}`, pmid: null, title: `Paper number ${i}`, authors: [`Wei Li${i}`, "A. B"], year: 2020 + (i % 5), venue: "J", abstract: "x", citationCount: 1, oaUrl: null, retracted: false, retractionSources: [], sources: ["openalex"], score: 1, ...over });
const answer = (text: string) => ({ text, citations: [], grounded: true, checked: true });
const turn = (i: number, text: string, over: Partial<AssistantMsg> = {}): ChatMsg[] => [user(`u${i}`, text), reply(`a${i}`, { query: text, ...over })];
const json = (x: unknown) => JSON.stringify(x);

describe("buildLedger: one record per turn of this chat", () => {
  it("numbers the turns, keeps the person's words, the intent, the standalone question, the start of the reply and the first ten papers, numbered as the cards", () => {
    const msgs = [
      ...turn(1, "LoRA for medical visual question answering", { papers: Array.from({ length: 14 }, (_, i) => paper(i + 1)), answer: answer("LoRA adapts big models cheaply [1]. It works for VQA [2].") }),
      ...turn(2, "only after 2020", { context: { turns: 1, intent: "refine", rewrote: true, question: "LoRA for medical VQA after 2020" }, papers: [paper(1)] }),
    ];
    const l = buildLedger(msgs);
    expect(l.map((t) => t.turn)).toEqual([1, 2]);
    expect(l[0]).toMatchObject({ user: "LoRA for medical visual question answering", intent: "search", standalone: "LoRA for medical visual question answering", reply: "LoRA adapts big models cheaply. It works for VQA." });
    expect(l[0]!.papers).toHaveLength(LEDGER_PAPERS);
    expect(l[0]!.papers[1]).toEqual({ n: 2, id: "doi:10.1/2", doi: "10.1/2", title: "Paper number 2", year: 2022, first_author: "Li2" });
    expect(l[1]).toMatchObject({ intent: "refine_search", standalone: "LoRA for medical VQA after 2020" });
  });

  it("reads the intent from what the reply already says (no model): small talk is chat, the same papers are ask_results, another tool is offer_tool, an Idea Check is offer_tool", () => {
    expect(intentOf(reply("a", { reason: "small_talk" }))).toBe("chat");
    expect(intentOf(reply("a", { context: { turns: 1, intent: "same_papers", rewrote: false } }))).toBe("ask_results");
    expect(intentOf(reply("a", { context: { turns: 1, intent: "refine", rewrote: true, fellBack: true } }))).toBe("search");
    expect(intentOf(reply("a", { mode: "verify", reason: "routed" }))).toBe("offer_tool");
    expect(intentOf(reply("a", { mode: "paper", reason: "routed" }))).toBe("ask_paper");
    const idea: IdeaMsg = { id: "i1", role: "idea", text: "IDEATEXT drones for glaucoma", at: 2 };
    const l = buildLedger([user("u1", "drones for glaucoma screening"), idea]);
    expect(l).toEqual([{ turn: 1, user: "drones for glaucoma screening", intent: "offer_tool", standalone: "drones for glaucoma screening", reply: null, papers: [] }]);
    expect(json(l)).not.toContain("IDEATEXT");
  });

  it("a stopped, failed or cut-off reply is a turn with reply null; a reply still being written is not a turn yet", () => {
    for (const status of ["stopped", "error", "interrupted"] as const) expect(buildLedger(turn(1, "glaucoma screening", { status }))[0]!.reply).toBeNull();
    expect(buildLedger(turn(1, "glaucoma screening", { status: "working" }))).toEqual([]);
  });

  it("cuts the reply to 300 characters and the person's words to 300, on one line", () => {
    const l = buildLedger(turn(1, `glaucoma\n${"x".repeat(500)}`, { answer: answer("y".repeat(900)) }));
    expect(l[0]!.reply!.length).toBeLessThanOrEqual(LEDGER_REPLY_CHARS);
    expect(l[0]!.user.length).toBeLessThanOrEqual(300);
    expect(l[0]!.user).not.toContain("\n");
  });

  it("never holds a reply of the safety lane, or a turn that carries its crisis or urgent line", () => {
    const msgs = [
      ...turn(1, "glaucoma screening"),
      ...turn(2, "LANECANARY chest pain right now", { reason: "urgent" }),
      ...turn(3, "LANECANARY two", { reason: "safety" }),
      ...turn(4, "LANECANARY three", { notices: [{ kind: "safety_crisis", text: "x" }] }),
      ...turn(5, "LANECANARY four", { reason: "decision" }),
    ];
    expect(json(buildLedger(msgs))).not.toContain("LANECANARY");
    expect(buildLedger(msgs)).toHaveLength(1);
  });

  it("New topic cuts the ledger: only the turns from the marked message on are in it", () => {
    const msgs = [...turn(1, "OLDTOPIC glaucoma"), user("u2", "malaria vaccines", { newTopic: true }), reply("a2", { query: "malaria vaccines" }), ...turn(3, "and in children?")];
    const l = buildLedger(msgs);
    expect(l.map((t) => t.user)).toEqual(["malaria vaccines", "and in children?"]);
    expect(json(l)).not.toContain("OLDTOPIC");
    // the message sent right after New topic leans on nothing
    expect(ledgerBefore(msgs, 2)).toEqual([]);
    expect(ledgerBefore(msgs, 4).map((t) => t.user)).toEqual(["malaria vaccines"]);
  });

  it("Edit and resend: the turns after the edited message are not in it (they are a version put away), and a version brought back brings its own", () => {
    const msgs = [...turn(1, "glaucoma screening"), ...turn(2, "VERSIONONE in India"), ...turn(3, "LATERTURN cost")];
    const edited = editUserMessage(msgs, "u2", "VERSIONTWO in Africa", reply("a2b", { query: "VERSIONTWO in Africa" }))!;
    const l = buildLedger(edited);
    expect(l.map((t) => t.user)).toEqual(["glaucoma screening", "VERSIONTWO in Africa"]);
    expect(json(l)).not.toMatch(/VERSIONONE|LATERTURN/);
    // what an edit of message 2 is sent with: the turns before it
    expect(ledgerBefore(msgs, 2).map((t) => t.user)).toEqual(["glaucoma screening"]);
    const back = switchVersion(edited, "u2", 0)!;
    expect(buildLedger(back).map((t) => t.user)).toEqual(["glaucoma screening", "VERSIONONE in India", "LATERTURN cost"]);
  });

  it("is total: a damaged record gives no turn and does not throw", () => {
    const broken = [user("u1", "glaucoma"), { ...reply("a1"), papers: null } as unknown as AssistantMsg, user("u2", 5 as unknown as string), reply("a2")];
    expect(() => buildLedger(broken)).not.toThrow();
  });

  it("firstAuthor reads both name orders", () => {
    expect(firstAuthor(["Wei Li"])).toBe("Li");
    expect(firstAuthor(["Li, Wei"])).toBe("Li");
    expect(firstAuthor([])).toBeNull();
    expect(firstAuthor(undefined)).toBeNull();
  });
});

describe("ledgerForSend: what of it would go with a message (M4)", () => {
  const many = (n: number, size = 20): LedgerTurn[] => Array.from({ length: n }, (_, i) => ({ turn: i + 1, user: `question ${i + 1} ${"w".repeat(size)}`, intent: "search", standalone: `standalone ${i + 1}`, reply: "r".repeat(size), papers: [] }));

  it("signed in: the six latest turns whole, the older ones only as their standalone question", () => {
    const out = ledgerForSend(many(9), { signedIn: true });
    expect(out).toHaveLength(9);
    expect(out.slice(0, 3)).toEqual([{ turn: 1, standalone: "standalone 1" }, { turn: 2, standalone: "standalone 2" }, { turn: 3, standalone: "standalone 3" }]);
    expect(out.slice(3).every((t) => "user" in t)).toBe(true);
    expect(out.slice(3)).toHaveLength(LEDGER_FULL_TURNS);
  });

  it("a visitor: only the three latest", () => {
    expect(ledgerForSend(many(9), { signedIn: false }).map((t) => t.turn)).toEqual([7, 8, 9]);
    expect(LEDGER_VISITOR_TURNS).toBe(3);
  });

  it("at most about 3,000 tokens: the oldest go first, and the latest turn always stays", () => {
    const out = ledgerForSend(many(6, 3000), { signedIn: true });
    expect(ledgerTokens(out) <= LEDGER_TOKEN_CAP || out.length === 1).toBe(true);
    expect(out.at(-1)!.turn).toBe(6);
    const one = ledgerForSend(many(1, 20000), { signedIn: true });
    expect(one).toHaveLength(1);
  });

  it("does not change the ledger it is given, and is empty for an empty ledger", () => {
    const l = many(8);
    const copy = json(l);
    ledgerForSend(l, { signedIn: true });
    expect(json(l)).toBe(copy);
    expect(ledgerForSend([], { signedIn: true })).toEqual([]);
  });
});

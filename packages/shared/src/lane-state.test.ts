import { describe, expect, it } from "vitest";
import { NOTICE_KINDS, SAFETY_NOTICE_KINDS, applyChatEvent, askedTurns, contextBefore, leavesNoTrace, startAssistant, type AssistantMsg, type ChatEvent, type ChatMsg } from "@scholar/shared";

/**
 * The shared half of R4 (docs/design/intent-and-state.md, 4.5 and H0 items 5 and 6): the new reasons and notice kinds, the rule that no lane reply ever rides along as context (a symptom or crisis
 * message must not be sent with the next message), what an old open tab does with a kind or a reason it does not know, and the predicate the page's
 * store uses to decide that a chat must leave no trace.
 */
const user = (id: string, text: string, at = 1): ChatMsg => ({ id, role: "user", text, at });
const reply = (id: string, over: Partial<AssistantMsg> = {}): AssistantMsg => ({ ...startAssistant(id, "a question", 2), status: "done", step: null, papersFinal: true, ...over });
const notice = (kind: string, text = "a line") => ({ kind: kind as never, text });
const NORMAL = reply("a-ok", { query: "glaucoma screening", searchQuery: "glaucoma screening", papers: [], answer: { text: "Screening finds glaucoma early [1].", grounded: true, checked: true, leftOut: 0, citations: [] } });

describe("the notice kinds and the reasons", () => {
  it("the four safety kinds are there, one for each line (the reducer keeps one notice of a kind), and `weak` of the failure policy is still there", () => {
    expect([...SAFETY_NOTICE_KINDS]).toEqual(["safety_crisis", "safety_urgent", "safety_decision", "safety_care"]);
    for (const k of SAFETY_NOTICE_KINDS) expect(NOTICE_KINDS).toContain(k);
    for (const k of ["partial", "nothing", "retracted", "years", "weak"]) expect(NOTICE_KINDS).toContain(k);
    expect(new Set(NOTICE_KINDS).size).toBe(NOTICE_KINDS.length);
  });

  it("a reply keeps one line of each safety kind, two cues keep both, and a repeated line is ignored", () => {
    const events: ChatEvent[] = [
      { type: "notice", kind: "safety_crisis", text: "one" },
      { type: "notice", kind: "safety_urgent", text: "two" },
      { type: "notice", kind: "safety_crisis", text: "again" },
    ];
    const m = events.reduce(applyChatEvent, startAssistant("x", "q", 1, true));
    expect(m.notices).toEqual([{ kind: "safety_crisis", text: "one" }, { kind: "safety_urgent", text: "two" }]);
  });

  it("the new reasons are kept as the reducer keeps any reason", () => {
    for (const reason of ["urgent", "safety", "decision"] as const) {
      const m = applyChatEvent(startAssistant("x", "q", 1, true), { type: "done", answered: false, reason, tookMs: 1 });
      expect(m).toMatchObject({ status: "done", reason });
    }
  });

  it("an old open tab meeting a kind or a reason it does not know shows text and never throws (the reducer takes any kind and any reason)", () => {
    const m = [{ type: "notice", kind: "from_the_future", text: "plain words" }, { type: "done", answered: false, reason: "from_the_future", tookMs: 1 }, { type: "extra_field_event", x: 1 }].reduce(
      (acc, e) => {
        try {
          return applyChatEvent(acc, e as unknown as ChatEvent);
        } catch {
          throw new Error("the reducer threw");
        }
      },
      startAssistant("x", "q", 1, true),
    );
    expect(m.notices).toEqual([{ kind: "from_the_future", text: "plain words" }]);
    expect(m.reason).toBe("from_the_future");
  });
});

describe("a lane reply never rides along as context (historyTurn)", () => {
  const withReply = (a: AssistantMsg): ChatMsg[] => [user("u1", "my father has chest pain right now"), a];
  const CASES: [string, AssistantMsg][] = [
    ["reason urgent", reply("a1", { reason: "urgent", general: { kind: "not_research", text: "If someone is in danger now, call." } })],
    ["reason safety", reply("a2", { reason: "safety", general: { kind: "not_research", text: "If you might hurt yourself, call." } })],
    ["reason decision (the papers are about the topic, not the person's case)", reply("a3", { reason: "decision", papers: [] })],
    ["a search chosen by hand that carries the crisis line", reply("a4", { mode: "search", searchQuery: "q", notices: [notice("safety_crisis")] })],
    ["a search chosen by hand that carries the urgent line", reply("a5", { mode: "search", searchQuery: "q", notices: [notice("safety_urgent")] })],
  ];
  it.each(CASES)("%s: no turn is made of it, so nothing is sent with the next message", (_name, a) => {
    const path = withReply(a);
    expect(contextBefore(path, path.length)).toEqual([]);
    expect(askedTurns(path)).toEqual([]);
  });

  it("an ordinary turn still is one, and so is one that carries only the lines for a decision or a care (those are health questions, not a danger)", () => {
    const path = [user("u0", "glaucoma screening"), NORMAL, user("u1", "pregnant caffeine miscarriage"), reply("a-care", { query: "pregnant caffeine", searchQuery: "pregnant caffeine miscarriage", notices: [notice("safety_care")] })];
    expect(contextBefore(path, path.length)).toHaveLength(4);
  });

  it("in a longer chat the message that was a danger is left out of the turns, and the others stay", () => {
    const path: ChatMsg[] = [user("u0", "glaucoma screening in rural India"), { ...NORMAL, searchQuery: "glaucoma screening rural India" }, user("u1", "my wife has severe wheezing right now zebrafish"), reply("a1", { reason: "urgent", general: { kind: "not_research", text: "x" } })];
    const turns = JSON.stringify(askedTurns(path));
    expect(turns).toMatch(/glaucoma/);
    expect(turns).not.toMatch(/wheezing|zebrafish/);
  });
});

describe("leavesNoTrace: the store's question of a finished reply", () => {
  it("is true for the reasons urgent and safety and for a reply that carries the crisis or the urgent line, and for nothing else", () => {
    expect(leavesNoTrace(reply("a", { reason: "urgent" }))).toBe(true);
    expect(leavesNoTrace(reply("a", { reason: "safety" }))).toBe(true);
    expect(leavesNoTrace(reply("a", { notices: [notice("safety_crisis")] }))).toBe(true);
    expect(leavesNoTrace(reply("a", { notices: [notice("safety_urgent")] }))).toBe(true);
    for (const r of [reply("a", { reason: "decision" }), reply("a", { notices: [notice("safety_care")] }), reply("a", { notices: [notice("safety_decision")] }), reply("a", { reason: "small_talk" }), NORMAL, reply("a", { reason: "not_answered", notices: [notice("weak")] })]) {
      expect(leavesNoTrace(r)).toBe(false);
    }
  });
  it("is false for a reply that is still being written (the reason is only known at the end)", () => {
    expect(leavesNoTrace({ ...reply("a", { reason: "urgent" }), status: "working" })).toBe(false);
  });
});

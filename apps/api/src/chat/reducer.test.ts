import { describe, expect, it } from "vitest";
import { INTERIM_ABSTRACT_CHARS, applyChatEvent, chatTitle, interruptAssistant, slimForInterim, startAssistant, stopAssistant, trimForStorage, type ChatEvent, type Paper } from "@scholar/shared";
import { stubPapers } from "./stub";

const run = (events: ChatEvent[]) => events.reduce(applyChatEvent, startAssistant("a1", "glaucoma", 1));
const papers: Paper[] = stubPapers();

describe("applyChatEvent", () => {
  it("builds a reply event by event: steps, papers, words, the checked answer, done", () => {
    const m = run([
      { type: "understood", mode: "search", query: "glaucoma screening", language: "en", auto: true, how: "rules", confidence: 0.9, searchQuery: "glaucoma screening india" },
      { type: "step", step: "search" },
      { type: "papers", results: papers.slice(0, 2), final: false },
      { type: "papers", results: papers, final: true },
      { type: "step", step: "read" },
      { type: "step", step: "write" },
      { type: "token", text: "The first " },
      { type: "token", text: "paper [1]." },
    ]);
    expect(m.query).toBe("glaucoma screening");
    expect(m).toMatchObject({ language: "en", auto: true, how: "rules", confidence: 0.9, searchQuery: "glaucoma screening india" });
    expect(m.papers).toHaveLength(5);
    expect(m.papersFinal).toBe(true);
    expect(m.step).toBe("write");
    expect(m.stepsDone).toEqual(["search", "read"]);
    expect(m.live).toBe("The first paper [1].");
    expect(m.status).toBe("working");
    const d = applyChatEvent(m, { type: "answer", answer: { text: "The first paper [1].", citations: [], grounded: true } });
    expect(d.live).toBe("");
    expect(d.answer?.text).toBe("The first paper [1].");
    const end = applyChatEvent(d, { type: "done", answered: true, tookMs: 900 });
    expect(end).toMatchObject({ status: "done", step: null, tookMs: 900 });
    expect(end.stepsDone).toEqual(["search", "read", "write", "check"]);
  });
  it("a notice of a kind is kept once", () => {
    const m = run([{ type: "notice", kind: "partial", text: "x" }, { type: "notice", kind: "partial", text: "x" }, { type: "notice", kind: "retracted", text: "y" }]);
    expect(m.notices.map((n) => n.kind)).toEqual(["partial", "retracted"]);
  });
  it("done carries the reason there is no answer; an error ends the reply and drops the half-written words", () => {
    expect(run([{ type: "done", answered: false, reason: "sign_in", tookMs: 5 }]).reason).toBe("sign_in");
    const e = run([{ type: "token", text: "half" }, { type: "error", code: "x", title: "Something went wrong" }]);
    expect(e).toMatchObject({ status: "error", live: "", error: "Something went wrong" });
  });
  it("events after the end are ignored", () => {
    const end = run([{ type: "done", answered: false, tookMs: 1 }]);
    expect(applyChatEvent(end, { type: "token", text: "late" })).toBe(end);
    expect(applyChatEvent(end, { type: "papers", results: papers, final: true })).toBe(end);
  });
  it("is pure: the reply it was given is not changed", () => {
    const m = startAssistant("a1", "q", 1);
    const copy = JSON.stringify(m);
    applyChatEvent(m, { type: "token", text: "x" });
    expect(JSON.stringify(m)).toBe(copy);
  });
});

describe("stop, interrupt, storage", () => {
  it("Stop keeps the papers and drops the half-written words; it does nothing to a finished reply", () => {
    const m = stopAssistant(run([{ type: "papers", results: papers, final: true }, { type: "token", text: "half" }]));
    expect(m).toMatchObject({ status: "stopped", live: "", reason: "stopped" });
    expect(m.papers).toHaveLength(5);
    const done = run([{ type: "done", answered: true, tookMs: 1 }]);
    expect(stopAssistant(done)).toBe(done);
  });
  it("a reply found working in storage becomes interrupted; a finished one stays", () => {
    expect(interruptAssistant(startAssistant("a", "q", 1)).status).toBe("interrupted");
    const done = run([{ type: "done", answered: true, tookMs: 1 }]);
    expect(interruptAssistant(done)).toBe(done);
  });
  it("trimForStorage cuts long abstracts at a word with an ellipsis and clears provisional text", () => {
    const long = { ...papers[0]!, abstract: "word ".repeat(300) };
    const t = trimForStorage({ ...run([{ type: "token", text: "x" }]), papers: [long, papers[1]!] });
    expect(t.live).toBe("");
    expect(t.papers[0]!.abstract!.length).toBeLessThanOrEqual(602);
    expect(t.papers[0]!.abstract!.endsWith("…")).toBe(true);
    expect(t.papers[1]!.abstract).toBe(papers[1]!.abstract);
  });
});

describe("chatTitle", () => {
  it("is the message when short, cut at a word with an ellipsis when long", () => {
    expect(chatTitle("  glaucoma   screening ")).toBe("glaucoma screening");
    const t = chatTitle("what is the best method to screen for glaucoma in rural primary health centres of India today");
    expect(t.endsWith("…")).toBe(true);
    expect(t.length).toBeLessThanOrEqual(61);
    expect(t).not.toMatch(/\s…$/);
  });
});

describe("slimForInterim", () => {
  const long = { ...stubPapers()[0]!, abstract: "Word ".repeat(200).trim() };
  it("cuts a long abstract at a word, with an ellipsis, to about what a folded card shows", () => {
    const [s] = slimForInterim([long]);
    expect(s!.abstract!.length).toBeLessThanOrEqual(INTERIM_ABSTRACT_CHARS + 1);
    expect(s!.abstract!.endsWith("…")).toBe(true);
    expect(s!.abstract).not.toMatch(/\s…$/);
    expect(long.abstract!.startsWith(s!.abstract!.slice(0, -1))).toBe(true);
  });
  it("leaves short, missing and exactly-long-enough abstracts as they are, and does not change its input", () => {
    const p = stubPapers();
    const none = { ...p[0]!, abstract: null };
    const exact = { ...p[1]!, abstract: "a".repeat(INTERIM_ABSTRACT_CHARS) };
    const out = slimForInterim([p[2]!, none, exact]);
    expect(out[0]).toBe(p[2]);
    expect(out[1]!.abstract).toBeNull();
    expect(out[2]!.abstract).toBe(exact.abstract);
    const copy = JSON.stringify(long);
    slimForInterim([long]);
    expect(JSON.stringify(long)).toBe(copy);
  });
  it("is a large saving on a real-sized list and keeps every other field", () => {
    const list = Array.from({ length: 20 }, (_, i) => ({ ...long, id: `x${i}`, abstract: "A sentence of an abstract about the method. ".repeat(30) }));
    const slim = slimForInterim(list);
    expect(JSON.stringify(slim).length).toBeLessThan(JSON.stringify(list).length * 0.4);
    expect(slim.every((p, i) => p.id === list[i]!.id && p.title === list[i]!.title && p.doi === list[i]!.doi)).toBe(true);
  });
});

describe("general background (W5)", () => {
  it("is built apart from the answer: its words are provisional, the final event replaces them, the checked answer is not touched", () => {
    const m = run([
      { type: "step", step: "search" },
      { type: "papers", results: [], final: true },
      { type: "answer", answer: { text: "", citations: [], grounded: false } },
      { type: "step", step: "general" },
      { type: "general_token", text: "In general terms " },
      { type: "general_token", text: "this is well studied [1]." },
    ]);
    expect(m.generalLive).toBe("In general terms this is well studied [1].");
    expect(m.general).toBeNull();
    expect(m.answer).toEqual({ text: "", citations: [], grounded: false });
    expect(m.step).toBe("general");
    const done = applyChatEvent(applyChatEvent(m, { type: "general", kind: "background", text: "In general terms this is well studied." }), { type: "done", answered: false, reason: "not_answered", tookMs: 5 });
    expect(done).toMatchObject({ generalLive: "", general: { kind: "background", text: "In general terms this is well studied." }, status: "done", reason: "not_answered" });
    expect(done.stepsDone).toContain("general");
    expect(done.answer?.grounded).toBe(false);
  });

  it("'unsure' empties what was shown", () => {
    const m = run([{ type: "general_token", text: "words" }, { type: "general", kind: "unsure", text: "" }]);
    expect(m.generalLive).toBe("");
    expect(m.general).toEqual({ kind: "unsure", text: "" });
  });

  it("'general' is a step only when it happened: a reply with no background does not list it", () => {
    const end = run([{ type: "step", step: "search" }, { type: "step", step: "read" }, { type: "step", step: "check" }, { type: "done", answered: true, tookMs: 1 }]);
    expect(end.stepsDone).toEqual(["search", "read", "write", "check"]);
    const withBg = run([{ type: "step", step: "search" }, { type: "step", step: "general" }, { type: "done", answered: false, tookMs: 1 }]);
    expect(withBg.stepsDone).toContain("general");
  });

  it("Stop, an error and storage drop the words that were being written", () => {
    const working = run([{ type: "general_token", text: "half" }]);
    expect(stopAssistant(working).generalLive).toBe("");
    expect(interruptAssistant(working).generalLive).toBe("");
    expect(applyChatEvent(working, { type: "error", code: "x", title: "Something went wrong" }).generalLive).toBe("");
    expect(trimForStorage(working).generalLive).toBe("");
  });

  it("a reply kept before this existed (no general fields) is read without trouble", () => {
    const old = { ...startAssistant("o", "q", 1) } as Partial<ReturnType<typeof startAssistant>>;
    delete old.general;
    delete old.generalLive;
    const done = applyChatEvent(old as ReturnType<typeof startAssistant>, { type: "done", answered: true, tookMs: 1 });
    expect(done.status).toBe("done");
    expect(applyChatEvent(old as ReturnType<typeof startAssistant>, { type: "general_token", text: "x" }).generalLive).toBe("x");
  });
});

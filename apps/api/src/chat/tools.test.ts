import { describe, expect, it } from "vitest";
import { applyChatEvent, applyToolEvent, refTally, startAssistant, trimForStorage, type ChatEvent, type Paper, type RefVerdict } from "@scholar/shared";
import { MAX_CHAT_RETRACTION_DOIS, doisIn, modeOfPlan, pickDoc, planTool, relayAsk, runVerify, type PlanInput, type ToolDeps } from "./tools";
import { stubVerify } from "./tools-stub";

/** CHAT_TOOLS (docs/design/chat-tools.md): which tool runs, and how a tool's run turns into the chat's events. Pure parts; the route is tools-route.test.ts. */

const LIST = [
  "[1] Watson, J. D., & Crick, F. H. C. (1953). Molecular structure of nucleic acids. Nature, 171, 737-738.",
  "[2] Vaswani, A., et al. (2017). Attention is all you need. Advances in Neural Information Processing Systems.",
  "[3] Invented, Q. (2021). A study that does not exist at all. Journal of Nothing, 1, 1-2.",
].join("\n");
const paper = (o: Partial<Paper> = {}): Paper => ({ id: "doi:10.1000/x.1", doi: "10.1000/x.1", title: "A paper", authors: [], year: 2021, venue: null, abstract: "An abstract.", sources: [], citations: null, retracted: false, retractionSources: [], score: 1, oaUrl: null, ...o }) as Paper;
const base = (o: Partial<PlanInput> = {}): PlanInput => ({ text: "glaucoma screening", mode: "search", intent: null, preset: null, question: "glaucoma screening", signedIn: true, ...o });

describe("planTool: which tool runs (the owner's rule: cheap tools by themselves, Idea Check and the literature scan stay a card)", () => {
  it("a pasted list of references, taken for Check references, is checked in the reply", () => {
    const p = planTool(base({ text: LIST, mode: "verify", question: LIST }));
    expect(p).toEqual({ kind: "verify", refs: expect.any(Array), skipped: 0 });
    expect(p?.kind === "verify" && p.refs.length).toBe(3);
    expect(modeOfPlan(p!)).toBe("verify");
  });

  it("a request with no list ('check my references') keeps the card: the page takes the list", () => {
    expect(planTool(base({ text: "please check my references", mode: "verify" }))).toBeNull();
    expect(planTool(base({ text: "references check karo", mode: "verify" }))).toBeNull();
  });

  it("one or two entries that each look like a reference are checked too; more than 60 are cut, and the rest is said", () => {
    expect(planTool(base({ text: LIST.split("\n")[0]!, mode: "verify" }))?.kind).toBe("verify");
    const many = Array.from({ length: 64 }, (_, i) => `[${i + 1}] Kumar, A. (20${String(10 + (i % 10))}). Title number ${i} of a long list of papers. Journal ${i}, 1, 1-9.`).join("\n");
    const p = planTool(base({ text: many, mode: "verify" }));
    expect(p?.kind).toBe("verify");
    if (p?.kind === "verify") {
      expect(p.refs).toHaveLength(60);
      expect(p.skipped).toBe(4);
    }
  });

  it("DOIs with a word that asks about retraction (English, Hinglish, Hindi) are checked for retractions, whatever the router said", () => {
    for (const text of ["is 10.1000/abc.123 retracted?", "10.1000/abc.123 retract hua kya", "क्या 10.1000/abc.123 वापस लिया गया?", "check these for retractions: 10.1000/a.1, 10.1000/b.2."]) {
      const p = planTool(base({ text, mode: "search" }));
      expect(p?.kind, text).toBe("retractions");
    }
    const p = planTool(base({ text: "check these for retractions: 10.1000/a.1, 10.1000/b.2.", mode: "search" }));
    expect(p).toEqual({ kind: "retractions", dois: ["10.1000/a.1", "10.1000/b.2"] });
  });

  it("a bare DOI, or retraction as a topic with no DOI, is not a retraction check (it is searched as before)", () => {
    expect(planTool(base({ text: "10.1000/abc.123", mode: "search" }))).toBeNull();
    expect(planTool(base({ text: "retraction rates in medical journals", mode: "search" }))).toBeNull();
  });

  it("a list of references that asks about retraction is checked as references (each verdict marks a retraction)", () => {
    expect(planTool(base({ text: `are any of these retracted?\n${LIST}`, mode: "verify" }))?.kind).toBe("verify");
  });

  it("a question about ONE paper of the chat, signed in, runs Ask this paper; a visitor, two papers or a paper with no DOI or arXiv number keep the answer from the abstracts", () => {
    const p = planTool(base({ intent: "ask_results", preset: [paper()], question: "What method did it use?" }));
    expect(p).toMatchObject({ kind: "ask_paper", ref: { doi: "10.1000/x.1" }, key: "doi:10.1000/x.1", question: "What method did it use?" });
    expect(modeOfPlan(p!)).toBe("paper");
    expect(planTool(base({ intent: "ask_results", preset: [paper()], question: "What method?", signedIn: false }))).toBeNull();
    expect(planTool(base({ intent: "ask_results", preset: [paper(), paper({ doi: "10.1000/y.2" })], question: "Compare them" }))).toBeNull();
    expect(planTool(base({ intent: "ask_results", preset: [paper({ doi: null })], question: "What method?" }))).toBeNull();
  });

  it("a question about the person's own paper runs only signed in", () => {
    expect(planTool(base({ mode: "paper", question: "what does my uploaded paper say about dropout?" }))).toEqual({ kind: "ask_doc", question: "what does my uploaded paper say about dropout?" });
    expect(planTool(base({ mode: "paper", question: "what does my uploaded paper say?", signedIn: false }))).toBeNull();
  });

  it("Idea Check and anything else never run here", () => {
    expect(planTool(base({ text: "my idea about bees, is it novel", mode: "idea" }))).toBeNull();
    expect(planTool(base({ text: "glaucoma screening", mode: "search" }))).toBeNull();
  });

  it("the DOIs of any text, each once, without trailing punctuation, at most 200 checked", () => {
    expect(doisIn("see 10.1000/A.1, and (10.1000/b.2). Also https://doi.org/10.1000/a.1")).toEqual(["10.1000/a.1", "10.1000/b.2"]);
    expect(doisIn("Is 10.1000/c.3 retracted? And 10.1000/d.4?!")).toEqual(["10.1000/c.3", "10.1000/d.4"]);
    const many = Array.from({ length: 230 }, (_, i) => `10.1000/x.${i}`).join(" ");
    const p = planTool(base({ text: `retracted? ${many}` }));
    expect(p?.kind === "retractions" && p.dois.length).toBe(MAX_CHAT_RETRACTION_DOIS);
  });
});

describe("pickDoc: which of the person's own papers", () => {
  const docs = [
    { id: "a", title: "Dropout as a Bayesian approximation" },
    { id: "b", title: "Batch normalization in deep networks" },
  ];
  it("the only one, or the one whose title the question names (two words or more, and more than any other)", () => {
    expect(pickDoc("anything", [docs[0]!])).toEqual(docs[0]);
    expect(pickDoc("what does the dropout bayesian paper say about variance?", docs)).toEqual(docs[0]);
  });
  it("null when it cannot be told: the card stays, and its page lets the person choose", () => {
    expect(pickDoc("what does my paper say?", docs)).toBeNull();
    expect(pickDoc("dropout?", docs)).toBeNull();
    expect(pickDoc("anything", [])).toBeNull();
  });
});

const deps = (o: Partial<ToolDeps> = {}): ToolDeps => ({
  verify: stubVerify,
  verifyAllowed: async () => true,
  retractions: async () => ({ checked: [], invalid: [] }),
  askPaper: async () => {},
  askDoc: async () => {},
  askAllowed: async () => true,
  gone: () => false,
  ...o,
});

describe("runVerify: every reference gets the page's verdict or says why it has none (never a made-up verdict)", () => {
  it("each verdict is sent as it arrives, numbered in the order of the paste", async () => {
    const sent: ChatEvent[] = [];
    const items = await runVerify(["Watson, J. (1953). Molecular structure of nucleic acids. Nature.", "Invented, Q. (2021). Nothing. J.", "Mismatch, M. (2019). A title here. J."], deps(), async (e) => void sent.push(e));
    expect(items.map((i) => [i.n, i.verdict?.status])).toEqual([[1, "verified"], [2, "not_found"], [3, "mismatch"]]);
    expect(sent.filter((e) => e.type === "tool_ref")).toHaveLength(3);
    expect(refTally(items)).toEqual({ verified: 1, mismatch: 1, notFound: 1, unchecked: 0 });
  });

  it("a database that cannot be reached, the minute's limit, and a reference over 1,000 characters: no verdict, a reason", async () => {
    const items = await runVerify(["Unreachable, U. (2020). Down. J.", "x".repeat(1200)], deps(), async () => {});
    expect(items[0]).toMatchObject({ verdict: null, error: expect.stringMatching(/could not be reached/) });
    expect(items[1]).toMatchObject({ verdict: null, error: expect.stringMatching(/1000 characters/) });
    const limited = await runVerify(["Watson, J. (1953). Molecular structure. Nature."], deps({ verifyAllowed: async () => false }), async () => {});
    expect(limited[0]).toMatchObject({ verdict: null, error: expect.stringMatching(/Too many/) });
  });

  it("a reader who left stops the run: nothing more is sent", async () => {
    let gone = false;
    const sent: ChatEvent[] = [];
    await runVerify(Array.from({ length: 20 }, (_, i) => `Author, A. (2020). Title ${i}. J.`), deps({ gone: () => gone, verify: async (t) => ((gone = true), stubVerify(t)) }), async (e) => void sent.push(e));
    expect(sent.length).toBeLessThan(20);
  });
});

describe("relayAsk: an ask's events, as the chat's", () => {
  it("relays each event as tool_ask, and says how it ended", async () => {
    const sent: ChatEvent[] = [];
    const answer = { id: "a", question: "q", found: true, answer: "It used X [1].", verified: true, citations: [{ n: 1, page: 2, idx: 0, quote: "We used X." }], createdAt: 0 };
    const end = await relayAsk(async (send) => {
      await send({ type: "stage", stage: "retrieving" });
      await send({ type: "delta", text: "It used" });
      await send({ type: "answer", answer });
    }, async (e) => void sent.push(e));
    expect(end).toEqual({ answer, error: false });
    expect(sent.map((e) => (e.type === "tool_ask" ? e.event.type : e.type))).toEqual(["stage", "delta", "answer"]);
  });

  it("an ask that ends with neither an answer nor an error is said to be unfinished, never left looking like it is still writing", async () => {
    const sent: ChatEvent[] = [];
    const end = await relayAsk(async (send) => void (await send({ type: "stage", stage: "retrieving" })), async (e) => void sent.push(e));
    expect(end.error).toBe(true);
    expect(sent.at(-1)).toMatchObject({ type: "tool_ask", event: { type: "error", code: "cut_off" } });
  });
});

describe("the reply's tool (shared reducer)", () => {
  const v = (status: RefVerdict["status"]): RefVerdict => ({ input: "x", status, reason: "r", confidence: 1, match: null, checks: null });
  it("builds the verify result in order, whatever order the verdicts arrive in", () => {
    let m = startAssistant("r", "q", 0, true);
    for (const e of [
      { type: "tool", tool: "verify", total: 3, skipped: 0 },
      { type: "tool_ref", item: { n: 3, input: "c", verdict: v("not_found") } },
      { type: "tool_ref", item: { n: 1, input: "a", verdict: v("verified") } },
      { type: "tool_ref", item: { n: 2, input: "b", verdict: null, error: "down" } },
    ] as ChatEvent[]) m = applyChatEvent(m, e);
    expect(m.tool?.kind === "verify" && m.tool.items.map((i) => i.n)).toEqual([1, 2, 3]);
  });

  it("an ask's words are provisional: kept only until the checked answer, and never kept in storage", () => {
    let m = startAssistant("r", "q", 0, true);
    m = applyChatEvent(m, { type: "tool", tool: "ask_paper", paper: { title: "T", doi: "10.1/x" }, question: "q?" });
    m = applyChatEvent(m, { type: "tool_ask", event: { type: "delta", text: "half" } });
    expect(m.tool?.kind === "ask_paper" && m.tool.ask.live).toBe("half");
    const kept = trimForStorage(m);
    expect(kept.tool?.kind === "ask_paper" && kept.tool.ask.live).toBe("");
  });

  it("an event of another tool, or before any started, changes nothing; a reply with no tool has no `tool` field", () => {
    expect(applyToolEvent(undefined, { type: "tool_ref", item: { n: 1, input: "a", verdict: null } })).toBeUndefined();
    const m = applyChatEvent(startAssistant("r", "q", 0, true), { type: "tool_retractions", checked: [], invalid: [] });
    expect("tool" in m).toBe(false);
    expect("tool" in trimForStorage(startAssistant("r", "q", 0, true))).toBe(false);
  });
});

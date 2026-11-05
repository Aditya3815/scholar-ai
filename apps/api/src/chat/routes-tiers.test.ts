import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOTHING_NOTICE, FOLLOWUP_UNREAD_NOTICE, applyChatEvent, startAssistant, streamShapeProblems, type AssistantMsg, type ChatEvent, type Paper, type SearchResponse, type SearchScope } from "@scholar/shared";
import type { StreamComplete } from "../docs/qa";
import { fewNotice, noneCloseNotice } from "../understand/tiers-text";

/**
 * R9, CHAT_FLOOR (docs/design/intent-and-state.md, 4.9), through the route with the stand-in network and model (QA_STUB): what each position of the switch does to a reply, what the writer is and is not asked,
 * what the page is told, and that nothing changes for a message the page may not judge (a hand-chosen search, a ramble, a follow-up it could not read, a script it cannot tokenise). The stand-in search gives the same
 * five glaucoma records for any words (stub.ts), so "no strong paper" is what any other words get; a list of any other shape is put in with `searchOverride`.
 */

// the Worker's type set has no Node types (test-node.d.ts shims only the little the tests read): the gzip of the saved probe strings is read the way search/plain-text.test.ts reads it
const nodeFs = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL): Uint8Array };
const nodeZlib = (await import(/* @vite-ignore */ "node:" + "zlib")) as { gunzipSync(data: Uint8Array): { toString(encoding: "utf8"): string } };

const calls = vi.hoisted(() => [] as { who: string; label?: string; system: string; user: string }[]);
const searchOverride = vi.hoisted(() => ({ fn: null as null | ((q: string) => unknown[]) }));
const tiersBroken = vi.hoisted(() => ({ mode: "" as "" | "build" | "order" }));

vi.mock("./stub", async (importOriginal) => {
  const real = await importOriginal<typeof import("./stub")>();
  const rec = (who: string, f: StreamComplete): StreamComplete => async (req, hooks) => {
    calls.push({ who, label: req.label, system: req.system, user: req.user });
    return f(req, hooks);
  };
  return {
    ...real,
    stubSearchFor: (q: string, scope?: SearchScope, opts?: { topical?: boolean }) => {
      const base = real.stubSearchFor(q, scope, opts);
      return searchOverride.fn ? ({ ...base, results: searchOverride.fn(q) } as SearchResponse) : base;
    },
    stubChatStream: rec("writer", real.stubChatStream),
    stubJudgeStream: (env?: unknown) => rec("judge", real.stubJudgeStream(env)),
    stubStrictStream: rec("strict", real.stubStrictStream),
  };
});
vi.mock("./stub-route", async (importOriginal) => {
  const real = await importOriginal<typeof import("./stub-route")>();
  return { ...real, stubRoute: async (req: Parameters<typeof real.stubRoute>[0]) => (calls.push({ who: "router", label: req.label, system: req.system, user: req.user }), real.stubRoute(req)) };
});
// the real module, except that a switch makes everything it returns throw: the route must treat that as "the page may not judge this", and the stream must be what it was
vi.mock("../understand/tiers", async (importOriginal) => {
  const real = await importOriginal<typeof import("../understand/tiers")>();
  return {
    ...real,
    tiererFor: (q: string) => {
      if (tiersBroken.mode === "build") throw new Error("the tiers cannot be made");
      const t = real.tiererFor(q);
      return t && { ...t, order: (l: never) => (tiersBroken.mode === "order" ? (() => { throw new Error("the order cannot be made"); })() : t.order(l)) };
    },
  };
});

import { chatRoutes } from "./routes";

const TOKEN = "t".repeat(40);
const sessionRow = { id: "user-1", name: "Test", email: "t@example.org", orcid: null, avatar_url: null, role: "scholar", privacy_ack: null, stale: 0, providers: "google" };

function fakeDb() {
  const outcomes: string[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            first: async () => (/FROM sessions/.test(sql) ? sessionRow : /SUM\(tokens_in/.test(sql) ? { t: 0 } : null),
            run: async () => {
              if (/answer_outcomes/.test(sql)) outcomes.push(`${String(args[0])}:${String(args[1])}`);
              return {};
            },
            all: async () => ({ results: [] }),
            __args: args,
          };
        },
      };
    },
    async batch(statements: { __args: unknown[] }[]) {
      for (const s of statements) outcomes.push(`${String(s.__args[0])}:${String(s.__args[1])}`);
      return statements.map(() => ({}));
    },
  };
  return { db, outcomes };
}

type Opts = { signedIn?: boolean; env?: Record<string, string> };
async function post(body: unknown, opts: Opts = {}) {
  const { db, outcomes } = fakeDb();
  const headers: Record<string, string> = { "content-type": "application/json", origin: "http://localhost", ...(opts.signedIn === false ? {} : { cookie: `sid=${TOKEN}` }) };
  const res = await chatRoutes.request("http://localhost/", { method: "POST", headers, body: JSON.stringify(body) }, { DB: db, ENABLE_DEV_ROUTES: "1", QA_STUB: "1", CROSSREF_MAILTO: "t@example.org", ...opts.env });
  return { res, text: await res.text(), outcomes };
}
const eventsOf = (text: string): ChatEvent[] =>
  text.split("\n\n").flatMap((block) => {
    const data = block.split("\n").find((l) => l.startsWith("data:"));
    return data ? [JSON.parse(data.slice(5)) as ChatEvent] : [];
  });
type Done = Extract<ChatEvent, { type: "done" }>;
type Notice = Extract<ChatEvent, { type: "notice" }>;
const run = async (body: unknown, opts: Opts = {}) => {
  const { res, text, outcomes } = await post(body, opts);
  expect(res.status).toBe(200);
  const ev = eventsOf(text);
  const finals = ev.filter((e) => e.type === "papers" && e.final) as Extract<ChatEvent, { type: "papers" }>[];
  return {
    ev,
    wire: text.replace(/"tookMs":\d+/g, '"tookMs":0'),
    outcomes,
    understood: ev.find((e) => e.type === "understood") as Extract<ChatEvent, { type: "understood" }>,
    lists: ev.filter((e) => e.type === "papers") as Extract<ChatEvent, { type: "papers" }>[],
    final: finals.at(-1)?.results ?? [],
    notices: ev.filter((e) => e.type === "notice") as Notice[],
    weak: (ev.filter((e) => e.type === "notice" && e.kind === "weak") as Notice[]).map((n) => n.text),
    steps: ev.filter((e) => e.type === "step").map((e) => (e as Extract<ChatEvent, { type: "step" }>).step),
    answer: (ev.find((e) => e.type === "answer") as Extract<ChatEvent, { type: "answer" }> | undefined)?.answer,
    general: ev.find((e) => e.type === "general") as Extract<ChatEvent, { type: "general" }> | undefined,
    done: ev.at(-1) as Done,
  };
};

const auto = (message: string, extra: Record<string, unknown> = {}) => ({ mode: "auto", message, ...extra });
const byHand = (message: string, extra: Record<string, unknown> = {}) => ({ mode: "search", message, ...extra });
const u = (text: string) => ({ role: "user", text });
const a = (extra: Record<string, unknown> = {}) => ({ role: "assistant", ...extra });
const GLAUCOMA = [u("glaucoma screening in rural India"), a({ searchQuery: "glaucoma screening rural India", papers: [{ n: 1, title: "Deep learning for glaucoma screening from fundus photographs", year: 2021 }], text: "Screening found glaucoma early [1]." })];

const writerCalls = () => calls.filter((c) => c.who === "writer" && c.label === "chat_search");
const judgeCalls = () => calls.filter((c) => c.who === "judge");
const backgroundCalls = () => calls.filter((c) => c.who === "writer" && c.label === "chat_general");

/** A paper of a made-up list. */
const paper = (title: string, abstract: string | null, extra: Partial<Paper> = {}): Paper => ({
  // the id comes from the title and the year, so that two runs of one test are given the same papers
  id: `t:${title}|${extra.year ?? 2020}`, doi: null, pmid: null, title, authors: ["A. Rao"], year: 2020, venue: "Journal of Tests", abstract, citationCount: null, oaUrl: null, retracted: false, retractionSources: [], sources: ["openalex"], score: 1, doiStatus: undefined, ...extra,
});
const long = (s: string) => `${s} It was measured in a group of adults over one year. The result was clear.`;

vi.setConfig({ testTimeout: 180_000 });

beforeEach(() => {
  calls.length = 0;
  searchOverride.fn = null;
  tiersBroken.mode = "";
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

/* ---------------------------------------------------------------- the stand-in search */

describe("the stand-in search can be made to write the question's words into its records (QA_STUB_TOPIC), and keeps its own list otherwise", () => {
  it("without it, and with it for the word offtopic, the records are today's byte for byte", async () => {
    const real = await vi.importActual<typeof import("./stub")>("./stub");
    const plain = JSON.stringify(real.stubSearchFor("effect of yoga on blood pressure").results);
    expect(JSON.stringify(real.stubSearchFor("effect of yoga on blood pressure", "all", {}).results)).toBe(plain);
    expect(JSON.stringify(real.stubSearchFor("effect of yoga on blood pressure", "all", { topical: false }).results)).toBe(plain);
    expect(JSON.stringify(real.stubSearchFor("offtopic effect of yoga on blood pressure", "all", { topical: true }).results)).toBe(JSON.stringify(real.stubSearchFor("offtopic effect of yoga on blood pressure").results));
    expect(JSON.stringify(real.stubSearchFor("nothing at all", "all", { topical: true }).results)).toBe("[]");
  });
  it("with it, every record says the words (in the first sentence of its abstract, or in its title when it has none), and the second sentence (the one the answers cite) is untouched", async () => {
    const real = await vi.importActual<typeof import("./stub")>("./stub");
    const topical = real.stubSearchFor("judgedrop glaucoma", "all", { topical: true }).results;
    const plain = real.stubSearchFor("judgedrop glaucoma").results;
    expect(topical.map((p) => p.id)).toEqual(plain.map((p) => p.id));
    // a record with no abstract (a title only) says the words in its title, which is all there is to read
    for (const [i, p] of topical.entries()) {
      if (!plain[i]!.abstract) {
        expect(p.title).toBe(`${plain[i]!.title} (judgedrop glaucoma)`);
        continue;
      }
      expect(p.title).toBe(plain[i]!.title);
      expect(p.abstract).toContain("(judgedrop glaucoma)");
      expect(p.abstract!.split(/(?<=\.)\s/).slice(1)).toEqual(plain[i]!.abstract!.split(/(?<=\.)\s/).slice(1));
    }
  });
});

/* ---------------------------------------------------------------- the four positions, for a list with no strong paper */

describe("a list with no strong paper (the stand-in's glaucoma records for words that are not about glaucoma)", () => {
  const Q = "effect of yoga on blood pressure";
  const base = () => run(auto(Q));

  it("unset, off and a value that is not a position: the writer is asked as before (the stream is the same byte for byte)", async () => {
    const before = await base();
    expect(before.answer).toBeTruthy();
    expect(writerCalls()).toHaveLength(1);
    const envs: Record<string, string>[] = [{}, { CHAT_FLOOR: "off" }, { CHAT_FLOOR: "ON" }, { CHAT_FLOOR: "banana" }, { CHAT_FLOOR: "core" }];
    for (const env of envs) {
      calls.length = 0;
      const r = await run(auto(Q), { env });
      expect(r.wire, JSON.stringify(env)).toBe(before.wire);
      expect(writerCalls()).toHaveLength(1);
    }
  });

  it("shadow: the same stream, byte for byte, and nothing stored unless the counters are on; with them, what it would have done is counted by name", async () => {
    const before = await base();
    const quiet = await run(auto(Q), { env: { CHAT_FLOOR: "shadow" } });
    expect(quiet.wire).toBe(before.wire);
    expect(quiet.outcomes.filter((o) => o.startsWith("chat_input:"))).toEqual([]);
    const counted = await run(auto(Q), { env: { CHAT_FLOOR: "shadow", CHAT_COUNTERS: "on" } });
    expect(counted.wire).toBe(before.wire);
    expect(counted.outcomes).toContain("chat_input:would_tier_none");
    expect(counted.outcomes).not.toContain("chat_input:tier_none");
    expect(counted.outcomes.filter((o) => o === "chat:floor_skipped")).toEqual([]);
    expect(counted.outcomes).toContain("chat:answered");
    // counters that are shadow or off store nothing of the floor either
    for (const c of ["shadow", "off"]) expect((await run(auto(Q), { env: { CHAT_FLOOR: "shadow", CHAT_COUNTERS: c } })).outcomes.filter((o) => o.startsWith("chat_input:"))).toEqual([]);
  });

  it("writer: the writer is NOT asked, the judge is not asked, the papers are listed in their old order with no line, and the reply ends not_answered, counted as floor_skipped", async () => {
    const before = await base();
    calls.length = 0;
    const r = await run(auto(Q), { env: { CHAT_FLOOR: "writer" } });
    expect(writerCalls()).toHaveLength(0);
    expect(judgeCalls()).toHaveLength(0);
    expect(r.answer).toBeUndefined();
    expect(r.ev.some((e) => e.type === "token")).toBe(false);
    expect(r.final.map((p) => p.id)).toEqual(before.final.map((p) => p.id));
    // no line of its own: the notices are the ones the list always had (the stand-in's list holds a retracted paper)
    expect(r.notices).toEqual(before.notices);
    expect(r.weak).toEqual([]);
    expect(r.done).toMatchObject({ answered: false, reason: "not_answered" });
    expect(r.outcomes).toContain("chat:floor_skipped");
    expect(r.outcomes).not.toContain("chat:not_answered");
    // the background from general knowledge runs, as it does for "no abstracts", under its own label and step
    expect(backgroundCalls()).toHaveLength(1);
    expect(r.general).toMatchObject({ kind: "background" });
    expect(r.steps).toEqual(["search", "general"]);
  });

  it("writer with the counters on: tier_none is what it did, and nothing is stored about the papers", async () => {
    const r = await run(auto(Q), { env: { CHAT_FLOOR: "writer", CHAT_COUNTERS: "on" } });
    expect(r.outcomes).toContain("chat_input:tier_none");
    expect(r.outcomes).toContain("chat:floor_skipped");
    expect(r.outcomes.some((o) => /would_tier/.test(o))).toBe(false);
  });

  it("on: the same, and one line says no paper matches the words closely, with the words in it, above the papers that are all still listed", async () => {
    const before = await base();
    calls.length = 0;
    const r = await run(auto(Q), { env: { CHAT_FLOOR: "on", CHAT_COUNTERS: "on" } });
    expect(writerCalls()).toHaveLength(0);
    expect(judgeCalls()).toHaveLength(0);
    expect(r.weak).toEqual([noneCloseNotice(Q, "en")]);
    expect(r.weak[0]).toContain(`“${Q}”`);
    expect(r.final).toHaveLength(before.final.length);
    expect([...r.final.map((p) => p.id)].sort()).toEqual([...before.final.map((p) => p.id)].sort());
    expect(r.done).toMatchObject({ answered: false, reason: "not_answered" });
    expect(r.outcomes).toContain("chat:floor_skipped");
    expect(r.outcomes).toContain("chat_input:tier_none");
    expect(r.steps).toEqual(["search", "general"]);
    expect(backgroundCalls()).toHaveLength(1);
  });

  it("the page's reducer takes the stream (the last reply is a finished one, with the line and no answer), and no step says an answer is being read", async () => {
    const r = await run(auto(Q), { env: { CHAT_FLOOR: "on" } });
    let m: AssistantMsg = startAssistant("m1", Q, 0, true);
    for (const e of r.ev) m = applyChatEvent(m, e);
    expect(m.status).toBe("done");
    expect(m.reason).toBe("not_answered");
    expect(m.answer).toBeNull();
    expect(m.notices.filter((n) => n.kind === "weak")).toHaveLength(1);
    // the page draws the card for a written answer only from the steps "read" and "write" (ChatView `reserved`): the server sends neither, so no empty card is held for an answer that is not coming
    expect(r.steps).not.toContain("read");
    expect(r.steps).not.toContain("write");
    expect(r.steps).not.toContain("check");
    expect(streamShapeProblems("chat", r.ev)).toEqual([]);
  });
});

/* ---------------------------------------------------------------- a list with some strong papers */

describe("a list with one or two strong papers (glaucoma screening: the stand-in's records have two)", () => {
  const Q = "glaucoma screening";
  it("off: the old order, an answer, no line", async () => {
    const r = await run(auto(Q));
    expect(r.final.map((p) => p.doi)).toEqual(["10.1000/glaucoma.1", "10.1000/glaucoma.2", "10.1000/glaucoma.3", null, "10.1000/glaucoma.4"]);
    expect(r.weak).toEqual([]);
    expect(r.answer?.grounded).toBe(true);
  });

  it("writer: the old order, no line, and the writer reads the strong papers only (the marks are the cards' own places)", async () => {
    const r = await run(auto(Q), { env: { CHAT_FLOOR: "writer" } });
    expect(r.final.map((p) => p.doi)).toEqual(["10.1000/glaucoma.1", "10.1000/glaucoma.2", "10.1000/glaucoma.3", null, "10.1000/glaucoma.4"]);
    expect(r.weak).toEqual([]);
    const prompt = writerCalls()[0]!.user;
    // papers 1 and 5 are strong: 2 (no word of the topic), 3 (retracted) and 4 (no abstract) are not read
    expect([...prompt.matchAll(/^\[(\d+)\] /gm)].map((m) => Number(m[1]))).toEqual([1, 5]);
    expect(r.answer?.citations.map((c) => c.paperId)).toEqual(["doi:10.1000/glaucoma.1"]);
  });

  it("on: strong first, then medium, then weak, each in its old order; the line says two of these papers match closely; the writer reads the strong ones, as the first two cards", async () => {
    const r = await run(auto(Q), { env: { CHAT_FLOOR: "on", CHAT_COUNTERS: "on" } });
    // strong: 1 and 5; medium: 3 (the retracted one: it says glaucoma); weak: 2 and 4
    expect(r.final.map((p) => p.doi)).toEqual(["10.1000/glaucoma.1", "10.1000/glaucoma.4", "10.1000/glaucoma.3", "10.1000/glaucoma.2", null]);
    expect(r.weak).toEqual([fewNotice(2, "en")]);
    expect([...writerCalls()[0]!.user.matchAll(/^\[(\d+)\] /gm)].map((m) => Number(m[1]))).toEqual([1, 2]);
    expect(r.answer?.citations.map((c) => c.paperId)).toEqual(["doi:10.1000/glaucoma.1"]);
    // the number of every mark is the place of its paper in the list the page was sent
    for (const c of r.answer!.citations) expect(r.final[c.n - 1]!.id).toBe(c.paperId);
    expect(r.outcomes).toContain("chat_input:tier_few");
    expect(r.outcomes).toContain("chat:answered");
    expect(r.done).toMatchObject({ answered: true });
    expect(r.steps).toEqual(["search", "read", "write", "check"]);
  });

  it("the lists sent while the sources answer are ordered by the same rule as the final one", async () => {
    const r = await run(auto(Q), { env: { CHAT_FLOOR: "on" } });
    const order = (l: Paper[]) => l.map((p) => p.doi);
    expect(r.lists.length).toBeGreaterThanOrEqual(2);
    for (const l of r.lists) expect(order(l.results)).toEqual(order(r.final));
  });

  it("the writer is told no more than before: the same question, and the strong papers' abstracts word for word", async () => {
    await run(auto(Q), { env: { CHAT_FLOOR: "on" } });
    const prompt = writerCalls()[0]!.user;
    expect(prompt.startsWith(`Question: ${Q}\n`)).toBe(true);
    expect(prompt).toContain("We trained a convolutional network on 12,000 fundus photographs to detect glaucoma.");
    expect(prompt).not.toContain("Low-cost smartphone adapters");
  });
});

describe("a list of three or more strong papers, or only strong ones, is left exactly as it is", () => {
  it("every paper strong (the stand-in told to write the words into its records): the stream with the floor on is the stream with it off", async () => {
    const env = { QA_STUB_TOPIC: "1" };
    const off = await run(auto("effect of yoga on blood pressure"), { env });
    const on = await run(auto("effect of yoga on blood pressure"), { env: { ...env, CHAT_FLOOR: "on" } });
    expect(on.wire).toBe(off.wire);
    expect(on.weak).toEqual([]);
    expect(on.answer).toBeTruthy();
    const writer = await run(auto("effect of yoga on blood pressure"), { env: { ...env, CHAT_FLOOR: "writer" } });
    expect(writer.wire).toBe(off.wire);
  });

  it("one paper of one: it is strong and there are no others, so nothing says that the others are weaker", async () => {
    searchOverride.fn = () => [paper("Glaucoma screening in rural clinics", long("Glaucoma screening."))];
    const r = await run(auto("glaucoma screening"), { env: { CHAT_FLOOR: "on" } });
    expect(r.weak).toEqual([]);
    expect(r.answer).toBeTruthy();
  });
});

/* ---------------------------------------------------------------- what the writer reads */

describe("the writer reads only strong papers with an abstract", () => {
  const strong1 = () => paper("Glaucoma screening in rural clinics", long("Glaucoma screening was offered."));
  const medium = () => paper("Glaucoma in older adults", long("Older adults were seen."));
  const weak = () => paper("Cataract surgery outcomes", long("Surgery was done."));
  it("a strong paper without an abstract, or retracted, is still not evidence, and a medium paper with a long abstract is not either", async () => {
    searchOverride.fn = () => [paper("Glaucoma screening programmes", null), medium(), paper("Glaucoma screening trial", long("Glaucoma screening."), { retracted: true, retractionSources: ["openalex"] }), weak(), strong1()];
    const r = await run(auto("glaucoma screening"), { env: { CHAT_FLOOR: "writer" } });
    expect([...writerCalls()[0]!.user.matchAll(/^\[(\d+)\] /gm)].map((m) => Number(m[1]))).toEqual([5]);
    expect(r.answer?.grounded).toBe(true);
  });

  it("strong papers that all lack an abstract: nothing for the writer to read, which is what no abstracts always meant", async () => {
    searchOverride.fn = () => [paper("Glaucoma screening programmes", null), paper("Glaucoma screening in India", null), medium()];
    const r = await run(auto("glaucoma screening"), { env: { CHAT_FLOOR: "on" } });
    expect(writerCalls()).toHaveLength(0);
    expect(r.done).toMatchObject({ answered: false, reason: "no_abstracts" });
    expect(r.outcomes).toContain("chat:no_abstracts");
    expect(r.weak).toEqual([fewNotice(2, "en")]);
    expect(backgroundCalls()).toHaveLength(1);
  });

  it("no strong paper but plenty of abstracts: the writer is not asked, however much there is to read", async () => {
    searchOverride.fn = () => Array.from({ length: 12 }, (_, i) => paper(`Glaucoma in group ${i}`, long("Older adults were seen.")));
    for (const position of ["writer", "on"]) {
      calls.length = 0;
      const r = await run(auto("glaucoma screening"), { env: { CHAT_FLOOR: position } });
      expect(writerCalls(), position).toHaveLength(0);
      expect(r.done, position).toMatchObject({ answered: false, reason: "not_answered" });
      expect(r.outcomes, position).toContain("chat:floor_skipped");
    }
  });
});

/* ---------------------------------------------------------------- the owner's own message */

describe("the owner's message: Can you search about convoluton nueral netwrk all papers", () => {
  const MESSAGE = "Can you search about convoluton nueral netwrk all papers";
  const TOPIC = "convoluton nueral netwrk";
  const AD_A = "We can tell you all about 1-Formylpiperidine.";
  const AD_B = "FIND OUT ALL YOU CAN ABOUT . . .";
  /** Crossref only, title only, the advertisements first: the SHAPE of the list he got (17 records). The two advertisement titles are real strings saved from the 3 Nov 2026 probes; the others are well-known titles on the subject. */
  const owners = () => [
    paper(AD_A, null, { year: 1980, sources: ["crossref"], doi: "10.1021/cen-v058n019.ifc", id: "doi:10.1021/cen-v058n019.ifc" }),
    paper(AD_A, null, { year: 1979, sources: ["crossref"], doi: "10.1021/cen-v057n047.ifc", id: "doi:10.1021/cen-v057n047.ifc" }),
    paper(AD_B, null, { year: 2012, sources: ["crossref"] }),
    ...[
      "Gradient-based learning applied to document recognition",
      "ImageNet classification with deep convolutional neural networks",
      "Very deep convolutional networks for large-scale image recognition",
      "Going deeper with convolutions",
      "Deep residual learning for image recognition",
      "Fully convolutional networks for semantic segmentation",
      "Convolutional neural networks for sentence classification",
      "Backpropagation applied to handwritten zip code recognition",
      "Densely connected convolutional networks",
      "Rethinking the inception architecture for computer vision",
      "A survey of the recent architectures of deep convolutional neural networks",
      "Convolutional neural network: a review of models, methodologies and applications",
      "Neural network ensembles",
      "Artificial neural networks for pattern recognition",
    ].map((t, i) => paper(t, null, { year: 1990 + i, sources: ["crossref"] })),
  ];
  const ENV = { CHAT_CLEAN: "on", CHAT_FLOOR: "on", CHAT_COUNTERS: "on" };

  it("the two advertisement titles are real strings of the saved probe lists", () => {
    const saved = JSON.parse(nodeZlib.gunzipSync(nodeFs.readFileSync(new URL("../../eval/probe-strings.json.gz", import.meta.url))).toString("utf8")) as { title: string[] };
    expect(saved.title).toContain(AD_A);
    expect(saved.title.some((t) => t.replace(/[‘’]/g, "").trim() === AD_B)).toBe(true);
    expect(owners()).toHaveLength(17);
  });

  it("with the cleaner and the floor on: the topic is the three words, no paper is strong, the writer is not asked, the line says so with the typed words, and all 17 records are still listed", async () => {
    searchOverride.fn = owners;
    const r = await run(auto(MESSAGE), { env: ENV });
    expect(r.understood.searchQuery).toBe(TOPIC);
    expect(r.understood.reading?.topic).toBe(TOPIC);
    expect(writerCalls()).toHaveLength(0);
    expect(judgeCalls()).toHaveLength(0);
    expect(r.answer).toBeUndefined();
    expect(r.weak).toEqual([noneCloseNotice(TOPIC, "en")]);
    expect(r.weak[0]).toBe(`No paper matches “convoluton nueral netwrk” closely. These are the nearest records and may be off topic. Check the spelling, or try fewer or different words.`);
    expect(r.final).toHaveLength(17);
    // nothing is hidden or removed: the same 17 records, the ones that say "convolutional" or "convolutions" (the only word his typing can match) first and the advertisements after them
    expect([...r.final.map((p) => p.title)].sort()).toEqual([...owners().map((p) => p.title)].sort());
    const titles = r.final.map((p) => p.title);
    expect(titles.slice(0, 8).every((t) => /convolution/i.test(t))).toBe(true);
    // the advertisements are weak, so they come after every record that says "convolutional", and first among the weak ones, in the order they had (a fold keeps the old relative order)
    expect(titles.slice(0, 8).filter((t) => t === AD_A || t === AD_B)).toEqual([]);
    expect(titles.slice(8, 11)).toEqual([AD_A, AD_A, AD_B]);
    expect(r.done).toMatchObject({ answered: false, reason: "not_answered" });
    expect(r.outcomes).toContain("chat:floor_skipped");
    expect(r.outcomes).toContain("chat_input:tier_none");
    expect(r.outcomes).toContain("chat_input:clean_applied");
    // signed in: the background from general knowledge, under its own label, is what a list with no abstracts gets; the writer is not
    expect(backgroundCalls()).toHaveLength(1);
    // and it never reads the Reading: its question is what the person wrote
    expect(backgroundCalls()[0]!.user).toContain(`Question: ${MESSAGE}`);
    expect(r.steps).toEqual(["search", "general"]);
  });

  it("the same with the stand-in's own list (five records about glaucoma)", async () => {
    const r = await run(auto(MESSAGE), { env: ENV });
    expect(r.understood.searchQuery).toBe(TOPIC);
    expect(writerCalls()).toHaveLength(0);
    expect(r.weak).toEqual([noneCloseNotice(TOPIC, "en")]);
    expect(r.final).toHaveLength(5);
  });

  it("signed out: the same line and the same list, and the reply does not invite a sign-in for an answer that would not come", async () => {
    searchOverride.fn = owners;
    const r = await run(auto(MESSAGE), { env: ENV, signedIn: false });
    expect(r.weak).toEqual([noneCloseNotice(TOPIC, "en")]);
    expect(r.final).toHaveLength(17);
    expect(r.done).toMatchObject({ answered: false, reason: "not_answered" });
    // what is counted is what has always been counted for a visitor
    expect(r.outcomes).toContain("chat:sign_in");
    expect(r.outcomes).not.toContain("chat:floor_skipped");
    expect(backgroundCalls()).toHaveLength(0);
  });

  it("without the cleaner the message has eight content stems and is not judged: the page abstains and the list is what it always was", async () => {
    const envs: Record<string, string>[] = [{ CHAT_FLOOR: "on" }, { CHAT_FLOOR: "on", CHAT_CLEAN: "shadow" }, { CHAT_FLOOR: "on", CHAT_CLEAN: "off" }];
    for (const env of envs) {
      calls.length = 0;
      const off = await run(auto(MESSAGE), { env: { ...env, CHAT_FLOOR: "off" } });
      const on = await run(auto(MESSAGE), { env });
      expect(on.wire, JSON.stringify(env)).toBe(off.wire);
      expect(on.weak).toEqual([]);
    }
  });

  it("chosen by hand, the exact words are searched, listed and answered as before whatever the switch says", async () => {
    searchOverride.fn = owners;
    for (const position of ["writer", "shadow", "on"]) {
      const off = await run(byHand(TOPIC));
      const on = await run(byHand(TOPIC), { env: { ...ENV, CHAT_FLOOR: position } });
      expect(on.wire, position).toBe(off.wire);
      expect(on.weak, position).toEqual([]);
    }
  });
});

/* ---------------------------------------------------------------- what the page does not judge */

describe("the trust rule and the messages the page may not judge: the stream is what it was", () => {
  const same = async (body: unknown, flags: Record<string, string> = {}, opts: Opts = {}) => {
    const off = await run(body, { ...opts, env: { ...opts.env, ...flags } });
    for (const position of ["writer", "shadow", "on"]) {
      const r = await run(body, { ...opts, env: { ...opts.env, ...flags, CHAT_FLOOR: position } });
      expect(r.wire, position).toBe(off.wire);
      expect(r.weak, position).toEqual([]);
    }
    return off;
  };

  it("a long ramble (more than six content stems) that nobody read is searched as written, with no order, no line, and the writer as before", async () => {
    // a visitor has no model to read it, so the words are searched as they were typed; a signed-in person's ramble is read by the router, and the page then judges the router's own English words (below)
    const ramble = "I have been wondering for a long time whether the thing that my uncle told me about the effect of walking after dinner on blood sugar in older people with diabetes is really true";
    await same(auto(ramble), {}, { signedIn: false });
    const r = await same(auto("alpha beta gamma delta epsilon zeta eta"));
    expect(r.answer).toBeTruthy();
  });

  it("the words a model wrote for a message the rules could not settle are the words that were searched, so those are what the page judges (and quotes)", async () => {
    // the stand-in's router writes "translated: " and the first five words of the message
    const ramble = "I have been wondering for a long time whether walking after dinner lowers blood sugar";
    const r = await run(auto(ramble), { env: { CHAT_FLOOR: "on" } });
    expect(r.understood.searchQuery).toBe("translated: I have been wondering for");
    expect(r.weak).toEqual([noneCloseNotice("translated: I have been wondering for", "en")]);
    expect(writerCalls()).toHaveLength(0);
  });

  it("a search chosen by hand: no tier, no reorder, no line, the writer as today (and the Indian scope, and anyway)", async () => {
    await same(byHand("effect of yoga on blood pressure"));
    await same(byHand("glaucoma screening"));
    await same(byHand("glaucoma screening", { scope: "india" }));
    await same(byHand("hello there friend", { anyway: true }));
    await same(byHand("nothing about glaucoma"));
  });

  it("a script the tokeniser cuts in the middle of a word (Devanagari) is not judged", async () => {
    await same(auto("मधुमेह में व्यायाम का प्रभाव"));
  });

  it("words with no content stem at all are not judged", async () => {
    await same(auto("study of the review of the trial"));
  });

  it("small talk and another tool's offer are untouched", async () => {
    await same(auto("thanks a lot"));
    await same(auto("now my idea about bees, is it novel"));
  });

  it("nothing found is the existing line, and the background runs as it did", async () => {
    const off = await run(auto("nothing at all about glaucoma"));
    for (const position of ["writer", "shadow", "on"]) {
      const r = await run(auto("nothing at all about glaucoma"), { env: { CHAT_FLOOR: position } });
      expect(r.wire, position).toBe(off.wire);
      expect(r.notices.map((n) => n.kind)).toEqual(["nothing"]);
      expect(r.notices[0]!.text).toBe(NOTHING_NOTICE);
    }
  });

  it("a source that did not answer keeps its own line, and the floor's line comes beside it, each of its own kind", async () => {
    const r = await run(auto("partial glaucoma screening"), { env: { CHAT_FLOOR: "on" } });
    // (the stand-in's list also holds a retracted paper, which has its line)
    expect(r.notices.map((n) => n.kind)).toEqual(["partial", "retracted", "weak"]);
  });

  it("the Hinglish words of a visitor, in letters the tokeniser keeps whole, are judged and the line is the plan's Hinglish one", async () => {
    const r = await run(auto("diabetes me exercise ka kya asar hota hai"), { env: { CHAT_FLOOR: "on" }, signedIn: false });
    expect(r.weak).toEqual([noneCloseNotice("diabetes me exercise ka kya asar hota hai", "hinglish")]);
    expect(r.weak[0]).toMatch(/^Koi paper “/);
  });

  it("when the tiers cannot be made (they throw), the stream is what it was and nothing breaks", async () => {
    const off = await run(auto("glaucoma screening"));
    const working: Record<string, string> = {};
    for (const position of ["writer", "shadow"]) working[position] = (await run(auto("glaucoma screening"), { env: { CHAT_FLOOR: position, CHAT_COUNTERS: "on" } })).wire;
    // the tiers cannot be made: the page judges nothing, in any position: the papers in their order and the writer as before, and nothing counted that the floor does
    tiersBroken.mode = "build";
    for (const position of ["writer", "shadow", "on"]) {
      const r = await run(auto("glaucoma screening"), { env: { CHAT_FLOOR: position, CHAT_COUNTERS: "on" } });
      expect(r.wire, `build / ${position}`).toBe(off.wire);
      expect(r.outcomes.some((o) => /tier|floor/.test(o)), `build / ${position}`).toBe(false);
    }
    // the order fails (only the position that lists in tier order uses it): that reply is what it was; the positions that never order are not touched by it
    tiersBroken.mode = "order";
    const on = await run(auto("glaucoma screening"), { env: { CHAT_FLOOR: "on", CHAT_COUNTERS: "on" } });
    expect(on.wire).toBe(off.wire);
    expect(on.outcomes.some((o) => /tier|floor/.test(o))).toBe(false);
    for (const position of ["writer", "shadow"]) expect((await run(auto("glaucoma screening"), { env: { CHAT_FLOOR: position, CHAT_COUNTERS: "on" } })).wire, position).toBe(working[position]);
  });

  it("a message that has a request frame the cleaner would take off, while the cleaner is not on, is not judged (the frame's words would be counted as topic words)", async () => {
    const framed = "can you search about yoga blood pressure";
    const off = await run(auto(framed));
    const envs: Record<string, string>[] = [{ CHAT_FLOOR: "on" }, { CHAT_FLOOR: "on", CHAT_CLEAN: "shadow" }, { CHAT_FLOOR: "writer", CHAT_CLEAN: "off" }];
    for (const env of envs) {
      const r = await run(auto(framed), { env });
      expect(r.wire, JSON.stringify(env)).toBe(off.wire);
    }
    // with the cleaner on, the words are "yoga" and the list is judged against that
    const cleaned = await run(auto(framed), { env: { CHAT_FLOOR: "on", CHAT_CLEAN: "on" } });
    expect(cleaned.understood.searchQuery).toBe("yoga blood pressure");
    expect(cleaned.weak).toEqual([noneCloseNotice("yoga blood pressure", "en")]);
  });
});

/* ---------------------------------------------------------------- the year range */

describe("with a year range", () => {
  it("the same papers are listed as with the floor off, only in another order, and the tiers are cut from the same twenty", async () => {
    const list = () => [
      paper("Cataract surgery outcomes", long("Surgery."), { year: 2021, id: "t:w1" }),
      paper("Glaucoma screening in rural clinics", long("Glaucoma screening."), { year: 2022, id: "t:s1" }),
      paper("Glaucoma in older adults", long("Older adults."), { year: 2023, id: "t:m1" }),
      paper("Glaucoma screening by phone", long("Glaucoma screening."), { year: 2010, id: "t:old" }),
      paper("Glaucoma screening costs", long("Glaucoma screening."), { year: 2024, id: "t:s2" }),
    ];
    searchOverride.fn = list;
    const off = await run(auto("glaucoma screening", { sinceYear: 2020 }));
    const on = await run(auto("glaucoma screening", { sinceYear: 2020 }), { env: { CHAT_FLOOR: "on" } });
    expect(off.final.map((p) => p.id)).toEqual(["t:w1", "t:s1", "t:m1", "t:s2"]);
    expect(on.final.map((p) => p.id)).toEqual(["t:s1", "t:s2", "t:m1", "t:w1"]);
    expect(on.weak).toEqual([fewNotice(2, "en")]);
    for (const l of on.lists) expect(l.results.map((p) => p.id)).toEqual(on.final.map((p) => p.id));
    // the writer reads the first strong paper, as card 1
    expect(on.answer?.citations.map((c) => c.n)).toEqual([1]);
  });
});

/* ---------------------------------------------------------------- the personal medicine lane keeps its way */

describe("a personal medicine decision (CHAT_SAFETY=on): the papers, no answer, no background, whatever the floor says", () => {
  const MSG = "can I take paracetamol with my blood pressure tablets";
  it("the reply still ends `decision`, the background is not asked, and the floor's own ending is not counted", async () => {
    const env = { CHAT_SAFETY: "on", CHAT_FLOOR: "on" };
    const r = await run(auto(MSG), { env });
    expect(r.done).toMatchObject({ answered: false, reason: "decision" });
    expect(backgroundCalls()).toHaveLength(0);
    expect(writerCalls()).toHaveLength(0);
    expect(r.outcomes).not.toContain("chat:floor_skipped");
    expect(r.notices.some((n) => n.kind === "safety_decision")).toBe(true);
  });
});

/* ---------------------------------------------------------------- follow-ups, and the one kind `weak` that two releases use */

describe("a follow-up", () => {
  it("one that the router read is judged on the words it searched: no strong paper means no written answer, as for a first message", async () => {
    const body = auto("newtopic tuberculosis vaccines", { history: GLAUCOMA });
    const off = await run(body);
    expect(off.answer).toBeTruthy();
    const on = await run(body, { env: { CHAT_FLOOR: "on" } });
    expect(writerCalls().length).toBe(1); // only the "off" run's
    expect(on.answer).toBeUndefined();
    expect(on.done).toMatchObject({ answered: false, reason: "not_answered" });
    expect(on.outcomes).toContain("chat:floor_skipped");
    expect(on.weak).toHaveLength(1);
    expect(on.weak[0]).toMatch(/^No paper matches “/);
  });

  it("one whose router call failed is not judged at all: nothing was read, so its words are no topic (the same stream as with the floor off)", async () => {
    const body = auto("routerquota and in children", { history: GLAUCOMA });
    for (const policy of ["off", "shadow", "on"]) {
      const off = await run(body, { env: { CHAT_FAILPOLICY: policy } });
      for (const floor of ["writer", "shadow", "on"]) {
        const r = await run(body, { env: { CHAT_FAILPOLICY: policy, CHAT_FLOOR: floor } });
        expect(r.wire, `${policy} / ${floor}`).toBe(off.wire);
      }
    }
  });

  it("THE `weak` COLLISION: a follow-up whose router call failed, the failure policy on and the floor on gets ONE line of the kind weak, and it is the failure policy's (nothing was read, so nothing can be said about a topic)", async () => {
    const body = auto("routerquota and in children", { history: GLAUCOMA });
    const r = await run(body, { env: { CHAT_FAILPOLICY: "on", CHAT_FLOOR: "on", CHAT_COUNTERS: "on" } });
    expect(r.weak).toEqual([FOLLOWUP_UNREAD_NOTICE]);
    expect(r.outcomes).toContain("chat:followup_unread");
    expect(r.outcomes).not.toContain("chat:floor_skipped");
    expect(r.done).toMatchObject({ answered: false, reason: "not_answered" });
    expect(writerCalls()).toHaveLength(0);
    // and the papers are listed in the order the search gave them (no tier was claimed for words nobody read)
    const policyOnly = await run(body, { env: { CHAT_FAILPOLICY: "on" } });
    expect(r.final.map((p) => p.id)).toEqual(policyOnly.final.map((p) => p.id));
  });

  it("whatever the positions, no reply has two notices of the kind weak (the page keeps one of each kind, the first), and the failure policy's line is the one when both could be", async () => {
    const bodies: [string, unknown, Opts][] = [
      ["a first message with no strong paper", auto("effect of yoga on blood pressure"), {}],
      ["a first message with two strong papers", auto("glaucoma screening"), {}],
      ["a read follow-up with no strong paper", auto("newtopic tuberculosis vaccines", { history: GLAUCOMA }), {}],
      ["a follow-up the router could not read", auto("routerquota and in children", { history: GLAUCOMA }), {}],
      ["a search by hand", byHand("effect of yoga on blood pressure"), {}],
      ["a visitor", auto("effect of yoga on blood pressure"), { signedIn: false }],
    ];
    for (const [label, body, opts] of bodies) {
      for (const floor of ["off", "writer", "shadow", "on"]) {
        for (const policy of ["off", "shadow", "on"]) {
          const r = await run(body, { ...opts, env: { CHAT_FLOOR: floor, CHAT_FAILPOLICY: policy } });
          expect(r.weak.length, `${label} / ${floor} / ${policy}`).toBeLessThanOrEqual(1);
          if (label === "a follow-up the router could not read" && policy === "on") expect(r.weak, `${label} / ${floor}`).toEqual([FOLLOWUP_UNREAD_NOTICE]);
        }
      }
    }
  });
});

/* ---------------------------------------------------------------- the counters never hold text */

describe("what the floor stores", () => {
  it("only closed names: the floor's own outcome, and the shape names, never a word of the message or of a paper", async () => {
    const canary = "zzcanaryquokka";
    const r = await run(auto(`${canary} glaucoma screening`), { env: { CHAT_FLOOR: "on", CHAT_COUNTERS: "on" } });
    for (const o of r.outcomes) expect(o, o).not.toContain(canary);
    expect(r.outcomes.every((o) => /^(chat|chat_input):[a-z0-9_]+$/.test(o))).toBe(true);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(canary);
  });
});

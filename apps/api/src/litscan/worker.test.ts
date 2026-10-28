import { describe, expect, it } from "vitest";
import type { Paper, SearchResponse } from "@scholar/shared";
import { AllProvidersFailedError, NoRouteError, QuotaError } from "../llm";
import { SearchUnavailableError, answerSubQuestion, cleanTitle, type WorkerDeps } from "./worker";

const paper = (i: number, abstract: string | null = "We studied children near busy roads. Attacks were more frequent close to traffic. The effect was strongest in winter.", extra: Partial<Paper> = {}): Paper => ({
  id: `doi:10.1/p${i}`, doi: `10.1/p${i}`, pmid: null, title: `Children near busy roads ${i}`, authors: ["A. Rao", "B. Iyer"], year: 2020, venue: "J", abstract, citationCount: 1, oaUrl: null, retracted: false, retractionSources: [], sources: ["openalex"], score: 1, ...extra,
});
const found = (results: Paper[]): SearchResponse => ({ query: "q", results, providers: {}, tookMs: 1 } as unknown as SearchResponse);
const item = { question: "How is exposure measured?", searchQuery: "children near busy roads" };
const answerJson = (n: number, s = 2) => ({ coverage: "full", answer: `Attacks were more frequent near traffic [${n}].`, evidence: [{ n, s }] });
const deps = (results: Paper[], json: unknown | (() => unknown)): WorkerDeps & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    search: async (q) => (calls.push(`search:${q}`), found(results)),
    stream: async (req) => {
      calls.push(`model:${req.label}`);
      const out = typeof json === "function" ? (json as () => unknown)() : json;
      return { json: out, model: "m" };
    },
  };
};
const run = (d: WorkerDeps, extra: Partial<Parameters<typeof answerSubQuestion>[0]> = {}) => answerSubQuestion({ idx: 3, item, language: "en", deps: d, ...extra });

describe("a title in the report", () => {
  it("is plain text: escaped markup and line breaks from the index are taken out", () => {
    expect(cleanTitle("&lt;b&gt;Association of Problematic Smartphone Use&lt;/b&gt; With Eye Strain")).toBe("Association of Problematic Smartphone Use With Eye Strain");
    expect(cleanTitle("Use of Atropine: Guidelines for\nClinical   Use")).toBe("Use of Atropine: Guidelines for Clinical Use");
    expect(cleanTitle("Tom &amp; Jerry <i>in</i> trials")).toBe("Tom & Jerry in trials");
  });
});

describe("one worker of a scan with the support judge", () => {
  const json = { coverage: "full", answer: "Attacks were more frequent near traffic [1]. The effect was strongest in winter [1]. An invented cure exists [1].", evidence: [{ n: 1, s: 2 }, { n: 1, s: 3 }] };
  const judgeSays = (claims: unknown[]) => async () => ({ json: { claims }, model: "j" });
  it("takes out what the sentences do not support, shows the sentences the judge found, and lists a paper once as a source", async () => {
    const d = { ...deps([paper(1), paper(2)], json), judge: judgeSays([{ c: 0, v: "yes", refs: [{ n: 1, s: [2] }] }, { c: 1, v: "yes", refs: [{ n: 1, s: [3] }] }, { c: 2, v: "no", refs: [] }]) };
    const part = await run(d);
    if (part.status !== "answered") throw new Error("not answered");
    expect(part.text).toBe("Attacks were more frequent near traffic [1]. The effect was strongest in winter [1].");
    expect(part.citations.map((c) => [c.n, c.sentenceNo])).toEqual([[1, 2], [1, 3]]);
    expect(part.sources.map((x) => x.n)).toEqual([1]);
  });
  it("is a gap, and says so, when the judge finds nothing that supports any claim", async () => {
    const d = { ...deps([paper(1)], json), judge: judgeSays([{ c: 0, v: "no", refs: [] }, { c: 1, v: "no", refs: [] }, { c: 2, v: "no", refs: [] }]) };
    expect(await run(d)).toMatchObject({ status: "gap", reason: "not_grounded" });
  });
  it("keeps the answer as it was written when the judge fails: a failing judge does not lose a scan's answer", async () => {
    const d = { ...deps([paper(1)], json), judge: async () => { throw new AllProvidersFailedError([]); } };
    const part = await run(d);
    expect(part).toMatchObject({ status: "answered" });
  });
});

describe("one worker of a scan", () => {
  it("searches with the sub-question's search words and returns a checked answer with real sources", async () => {
    const d = deps([paper(1), paper(2)], answerJson(1));
    const part = await run(d);
    expect(part).toMatchObject({ idx: 3, status: "answered", found: 2 });
    if (part.status !== "answered") throw new Error("not answered");
    expect(part.text).toContain("[1]");
    expect(part.citations[0]).toMatchObject({ n: 1, paperId: "doi:10.1/p1", sentence: "Attacks were more frequent close to traffic." });
    expect(part.sources).toEqual([{ n: 1, paperId: "doi:10.1/p1", title: "Children near busy roads 1", year: 2020, doi: "10.1/p1", authors: ["A. Rao", "B. Iyer"], venue: "J", url: "https://doi.org/10.1/p1" }]);
    expect(d.calls).toEqual(["search:children near busy roads", "model:litscan_worker"]);
  });

  it("tells where it is, in order, without words", async () => {
    const stages: string[] = [];
    await run(deps([paper(1)], answerJson(1)), { onStage: (s) => void stages.push(s) });
    expect(stages).toEqual(["searching", "reading"]);
  });

  it("throws, so the workflow tries again, when the search found nothing because the sources did not answer (rate limits): that is not \"nothing found\"", async () => {
    const d: WorkerDeps = { search: async () => ({ query: "q", results: [], providers: { openalex: { ok: false, count: 0, ms: 5, cached: false, error: "OpenAlex HTTP 429" }, s2: { ok: false, count: 0, ms: 1, cached: false, error: "S2_API_KEY not configured" } }, tookMs: 1 } as unknown as SearchResponse), stream: async () => ({ json: answerJson(1), model: "m" }) };
    await expect(run(d)).rejects.toBeInstanceOf(SearchUnavailableError);
  });

  it("says nothing was found only when every source that was asked answered", async () => {
    const d: WorkerDeps = { search: async () => ({ query: "q", results: [], providers: { openalex: { ok: true, count: 0, ms: 5, cached: false }, s2: { ok: false, count: 0, ms: 1, cached: false, error: "S2_API_KEY not configured" } }, tookMs: 1 } as unknown as SearchResponse), stream: async () => ({ json: answerJson(1), model: "m" }) };
    expect(await run(d)).toMatchObject({ status: "gap", reason: "nothing_found" });
  });

  it("is a gap, without asking the model, when the search finds nothing", async () => {
    const d = deps([], answerJson(1));
    expect(await run(d)).toEqual({ idx: 3, status: "gap", found: 0, reason: "nothing_found" });
    expect(d.calls).toEqual(["search:children near busy roads"]);
  });

  it("is a gap, without asking the model, when the papers found are not about the sub-question (a live search returned a blast injury and an HIV programme for a question about phones and eyes)", async () => {
    const off = [paper(1, "Injuries from phone battery explosions have risen. Blast injuries need quick care.", { title: "Blast injury after a phone battery explosion" }), paper(2, "A text-message programme for truckers.", { title: "HIV risk reduction by text" })];
    const d = deps(off, answerJson(1));
    expect(await run(d)).toEqual({ idx: 3, status: "gap", found: 2, reason: "no_relevant" });
    expect(d.calls).toEqual(["search:children near busy roads"]);
  });

  it("reads only the papers that are about it: the others are not shown to the model and are not sources", async () => {
    let user = "";
    const d: WorkerDeps = { search: async () => found([paper(1, "A study of phone battery blasts and burns.", { title: "Blast injury" }), paper(2)]), stream: async (req) => ((user = req.user), { json: answerJson(1), model: "m" }) };
    const part = await run(d);
    expect(user).toContain("Children near busy roads 2");
    expect(user).not.toContain("Blast injury");
    expect(part).toMatchObject({ status: "answered", found: 2 });
    if (part.status === "answered") expect(part.sources.map((s) => s.paperId)).toEqual(["doi:10.1/p2"]);
  });

  it("is a gap when no paper has an abstract to read, or the only one that does is retracted", async () => {
    expect(await run(deps([paper(1, null), paper(2, "too short")], answerJson(1)))).toEqual({ idx: 3, status: "gap", found: 2, reason: "no_abstracts" });
    expect(await run(deps([paper(1, undefined, { retracted: true })], answerJson(1)))).toMatchObject({ status: "gap", reason: "no_abstracts" });
  });

  it("is a gap, not an answer, when the model's claim cannot be found in an abstract (the sentence does not exist)", async () => {
    expect(await run(deps([paper(1)], answerJson(1, 99)))).toMatchObject({ status: "gap", reason: "not_grounded", found: 1 });
  });

  it("is a gap when the model says the papers do not answer", async () => {
    expect(await run(deps([paper(1)], { coverage: "none", answer: "", evidence: [] }))).toMatchObject({ status: "gap", reason: "not_answered" });
  });

  it("never uses a paper the model was not shown: a source the answer names that is not in the list is not a source", async () => {
    const part = await run(deps([paper(1)], answerJson(7)));
    expect(part).toMatchObject({ status: "gap" });
  });

  it("a used-up allowance is a gap that says so", async () => {
    const d = deps([paper(1)], () => {
      throw new QuotaError("daily AI quota reached");
    });
    expect(await run(d)).toMatchObject({ status: "gap", reason: "quota" });
  });

  it("no model available is a gap, and a time limit that fired is 'too slow', not an outage", async () => {
    const none = deps([paper(1)], () => {
      throw new NoRouteError("no route");
    });
    expect(await run(none)).toMatchObject({ status: "gap", reason: "unavailable" });
    const ctl = new AbortController();
    const slow = deps([paper(1)], () => {
      ctl.abort();
      throw new AllProvidersFailedError([{ provider: "workersai", model: "m", ok: false, ms: 80_000, error: "aborted" }]);
    });
    expect(await run(slow, { signal: ctl.signal })).toMatchObject({ status: "gap", reason: "too_slow" });
  });

  it("lets a failure that waiting could cure go up, so the workflow tries the step again", async () => {
    const d = deps([paper(1)], () => {
      throw new AllProvidersFailedError([{ provider: "workersai", model: "m", ok: false, ms: 10, error: "503" }]);
    });
    await expect(run(d)).rejects.toBeInstanceOf(AllProvidersFailedError);
  });

  it("writes in the language that was chosen", async () => {
    let system = "";
    const d: WorkerDeps = { search: async () => found([paper(1)]), stream: async (req) => ((system = req.system), { json: answerJson(1), model: "m" }) };
    await run(d, { language: "hinglish" });
    expect(system).toMatch(/Hinglish/);
  });
});

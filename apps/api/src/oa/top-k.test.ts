import { describe, expect, it, vi } from "vitest";

/**
 * Bug B28 (docs/design/untangle.md, section 5): "Ask this paper" took the development variable QA_TOP_K (passages shown to the model, the cost experiments) with no upper bound, while a
 * question about a paper of one's own takes it only from 1 to 12. Both read it through devOptions now: from 1 to 12, in development mode only.
 */

const seen = vi.hoisted(() => ({ topK: [] as (number | undefined)[] }));

vi.mock("./store", async (importOriginal) => {
  const real = await importOriginal<typeof import("./store")>();
  const row = { key: "doi:10.1/x", status: "ready", title: "A paper", source: "pdf", license: null, chunk_count: 1, done_chunks: 1, reason: null };
  return { ...real, getPaper: async () => row, failIfStale: async () => false, readyChunks: async () => [{ idx: 0, page: 1, text: "Some text of the paper.", embedding: null }], claimRefresh: async () => null };
});
vi.mock("../search/retraction-service", async (importOriginal) => ({ ...(await importOriginal<typeof import("../search/retraction-service")>()), isRetracted: async () => false }));
vi.mock("../outcomes", async (importOriginal) => ({ ...(await importOriginal<typeof import("../outcomes")>()), countOutcome: async () => {} }));
vi.mock("../docs/qa", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../docs/qa")>()),
  answerQuestionStream: async (args: { topK?: number }) => {
    seen.topK.push(args.topK);
    return { id: "a", question: "q", answer: "", found: false, citations: [], model: "stub", createdAt: 0 };
  },
}));

const { oaService } = await import("./service");
const { depsFor } = await import("../app/deps");

async function topKWith(env: Record<string, string>): Promise<number | undefined> {
  seen.topK.length = 0;
  const abort = new AbortController();
  const e = { DB: {}, CROSSREF_MAILTO: "t@example.org", QA_STUB: "1", ...env } as never;
  await oaService.ask(
    e,
    { userId: "u", ref: { doi: "10.1/x" }, key: "doi:10.1/x", question: "What did they find?", clientAbstract: "", embed: async (t: string[]) => t.map(() => [1]), abort, deps: depsFor(e) },
    { gone: false, send: async () => {} },
  );
  return seen.topK[0];
}

describe("the passages of a question about an open-access paper (bug B28)", () => {
  it("takes QA_TOP_K from 1 to 12 in development mode, and nothing else", async () => {
    expect(await topKWith({ ENABLE_DEV_ROUTES: "1", QA_TOP_K: "12" })).toBe(12);
    expect(await topKWith({ ENABLE_DEV_ROUTES: "1", QA_TOP_K: "3" })).toBe(3);
    expect(await topKWith({ ENABLE_DEV_ROUTES: "1", QA_TOP_K: "50" })).toBeUndefined();
    expect(await topKWith({ ENABLE_DEV_ROUTES: "1", QA_TOP_K: "0" })).toBeUndefined();
    expect(await topKWith({ QA_TOP_K: "3" })).toBeUndefined();
  });
});

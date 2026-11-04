import { describe, expect, it } from "vitest";
import { parseTrending } from "@scholar/shared";
import { fakeKv } from "./fake-kv";
import { STUB_FAULT_KEY, makeStubTrending, parseStubFault } from "./stub";
import { TRENDING_KEYS } from "./store";
import { runTrendingFromEnv, type TrendingJobEnv } from "./job";

/**
 * The stand-ins of stub.ts can be made to fail, so that the local end-to-end run (scripts/trending-e2e.mjs) can show that a source that fails leaves the last file. The switch is a KV key that
 * only the QA_STUB branch of the job reads (QA_STUB=1 together with ENABLE_DEV_ROUTES=1, never in production), and that is written through the dev-only route /api/v1/dev/kv.
 */
const DAY = "2026-11-03";
const TUESDAY = Date.parse(`${DAY}T03:17:00Z`);
const call = (stub: ReturnType<typeof makeStubTrending>, url: string) => stub.fetch(url);
const openalexUrl = "https://api.openalex.org/works?filter=primary_topic.subfield.id:1702,from_publication_date:2026-02-01,to_publication_date:2026-05-02&group_by=keywords.id";
const arxivUrl = "https://export.arxiv.org/api/query?search_query=all:%22rag%22+AND+submittedDate:[202610040000+TO+202611032359]&max_results=1";

describe("the stand-ins can be made to fail", () => {
  it("without a fault they answer as before", async () => {
    const stub = makeStubTrending({ asOf: () => DAY });
    expect((await call(stub, openalexUrl)).status).toBe(200);
    expect((await call(stub, arxivUrl)).status).toBe(200);
    const found = await stub.search("graph neural networks", "all");
    expect(Object.values(found.providers).every((p) => p.ok)).toBe(true);
  });

  it("'openalex': every OpenAlex call is answered with HTTP 500, and nothing else changes", async () => {
    const stub = makeStubTrending({ asOf: () => DAY, fault: "openalex" });
    expect((await call(stub, openalexUrl)).status).toBe(500);
    expect((await call(stub, arxivUrl)).status).toBe(200);
    expect(Object.values((await stub.search("graph neural networks", "all")).providers).every((p) => p.ok)).toBe(true);
  });

  it("'arxiv': arXiv answers its Error entry under HTTP 200, as the real one does, and nothing else changes", async () => {
    const stub = makeStubTrending({ asOf: () => DAY, fault: "arxiv" });
    const res = await call(stub, arxivUrl);
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/<title>Error<\/title>/);
    expect((await call(stub, openalexUrl)).status).toBe(200);
  });

  it("'search': no source of the product's own search answers, and nothing else changes", async () => {
    const stub = makeStubTrending({ asOf: () => DAY, fault: "search" });
    const found = await stub.search("graph neural networks", "all");
    expect(Object.keys(found.providers).length).toBeGreaterThan(0);
    expect(Object.values(found.providers).some((p) => p.ok)).toBe(false);
    expect((await call(stub, openalexUrl)).status).toBe(200);
    expect((await call(stub, arxivUrl)).status).toBe(200);
  });

  it("only the three names are faults: anything else is none", () => {
    expect(["openalex", "arxiv", "search"].map(parseStubFault)).toEqual(["openalex", "arxiv", "search"]);
    for (const v of [null, undefined, "", "1", "OpenAlex", "all", 1, {}]) expect(parseStubFault(v)).toBeNull();
  });
});

describe("the job as the Worker runs it with the stand-ins", () => {
  const env = (kv: KVNamespace, over: Partial<TrendingJobEnv> = {}) => ({ CACHE: kv, CROSSREF_MAILTO: "ops@example.org", ENABLE_DEV_ROUTES: "1", QA_STUB: "1", ...over }) as unknown as TrendingJobEnv;

  it("reads the fault key at the start of a run: with a fault the run goes by it (arXiv: those phrases are out for the night; the search: the run fails and the last file stays exactly as it was); without it the next run is fine", async () => {
    const w = fakeKv({ writeLimit: false });
    await runTrendingFromEnv(env(w.kv), TUESDAY);
    const last = w.read(TRENDING_KEYS.file);
    expect(parseTrending(JSON.parse(last!))?.groups.global.chips.length).toBeGreaterThanOrEqual(8);

    w.seed(STUB_FAULT_KEY, "arxiv");
    // arXiv answering its Error entry for both of the stand-ins' computing and physics phrases: each is out for the night (two in a row is a hiccup, three an outage), and the file is made from the others
    const r = await runTrendingFromEnv(env(w.kv), TUESDAY + 3_600_000);
    expect(r.daily).toMatchObject({ published: true });
    expect(r.daily!.rejected!.unconfirmed).toBeGreaterThanOrEqual(2);
    const degraded = w.read(TRENDING_KEYS.file)!;
    const texts = parseTrending(JSON.parse(degraded))!.groups.global.chips.map((c) => c.text);
    expect(texts).not.toContain("retrieval-augmented generation");
    expect(texts).not.toContain("altermagnetism");
    expect(texts.length).toBeGreaterThanOrEqual(8);

    w.seed(STUB_FAULT_KEY, "search");
    await expect(runTrendingFromEnv(env(w.kv), TUESDAY + 7_200_000)).rejects.toThrow(/no source answered/);
    expect(w.read(TRENDING_KEYS.file)).toBe(degraded);

    await w.kv.delete(STUB_FAULT_KEY);
    await expect(runTrendingFromEnv(env(w.kv), TUESDAY + 10_800_000)).resolves.toMatchObject({ daily: { published: true } });
  });

  it("a fault on OpenAlex fails a first run before any file is made", async () => {
    const w = fakeKv({ writeLimit: false });
    w.seed(STUB_FAULT_KEY, "openalex");
    await expect(runTrendingFromEnv(env(w.kv), TUESDAY)).rejects.toMatchObject({ source: "openalex", kind: "http", status: 500 });
    expect(w.read(TRENDING_KEYS.file)).toBeNull();
  });

  it("never reads the key unless both QA_STUB and ENABLE_DEV_ROUTES are set (the production path has no fault switch)", async () => {
    for (const over of [{ QA_STUB: undefined }, { ENABLE_DEV_ROUTES: undefined }, { QA_STUB: "0" }, { ENABLE_DEV_ROUTES: "0" }, { QA_STUB: undefined, ENABLE_DEV_ROUTES: undefined }]) {
      const w = fakeKv({ writeLimit: false });
      w.seed(STUB_FAULT_KEY, "arxiv");
      // the variable TRENDING=off ends the run before any call goes out, so no real address is asked in this test: what is left to see is which keys were read
      await runTrendingFromEnv(env(w.kv, { ...over, TRENDING: "off" }), TUESDAY);
      expect(w.log.gets.flat()).not.toContain(STUB_FAULT_KEY);
    }
  });

  it("and the key is not one of the feed's own keys: the runbook's table of keys does not list a switch that exists only in tests", () => {
    expect(Object.values(TRENDING_KEYS).map(String)).not.toContain(STUB_FAULT_KEY);
  });
});

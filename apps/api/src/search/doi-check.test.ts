import type { Paper } from "@scholar/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryStore } from "../cache/store";
import { applyDoiChecks, checkDois } from "./doi-check";
import { normalizeDoi } from "./normalize";

const paper = (doi: string | null, title: string, over: Partial<Paper> = {}): Paper => ({
  id: doi ? `doi:${doi}` : `t:${title.toLowerCase()}|2020`,
  doi, pmid: null, title, authors: ["A. One"], year: 2020, venue: "J", abstract: null, citationCount: 1, oaUrl: null,
  retracted: false, retractionSources: [], sources: ["openalex"], score: 0.1, ...over,
});

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const env = () => ({ store: memoryStore(), CROSSREF_MAILTO: "t@example.org" });
afterEach(() => vi.unstubAllGlobals());

function stub(opts: { registered?: Record<string, string>; handles?: Record<string, number | "error"> }) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("api.crossref.org/works?")) {
      const items = Object.entries(opts.registered ?? {}).map(([DOI, title]) => ({ DOI, title: [title] }));
      return json({ message: { items } });
    }
    const m = url.match(/doi\.org\/api\/handles\/(.+)$/);
    if (m) {
      const h = opts.handles?.[decodeURIComponent(m[1]!)];
      if (h === "error") return new Response("", { status: 503 });
      return h === 1 ? json({ responseCode: 1 }) : json({ responseCode: 100 }, 404);
    }
    return new Response("", { status: 404 });
  });
  return calls;
}

describe("normalizeDoi", () => {
  it.each([
    ["https://doi.org/10.1051/bioconf/202621302009/pdf", "10.1051/bioconf/202621302009"],
    ["10.1002/abc.123/full", "10.1002/abc.123"],
    ["10.1016/J.CELL.2015.03.017.", "10.1016/j.cell.2015.03.017"],
    ["10.1007/s11263-019-01228-7/epdf", "10.1007/s11263-019-01228-7"],
    ["not a doi", null],
  ])("%s", (raw, expected) => expect(normalizeDoi(raw)).toBe(expected));
});

describe("checkDois + applyDoiChecks", () => {
  it("keeps registered DOIs whose title agrees, marks them verified", async () => {
    stub({ registered: { "10.1/real": "Graph neural networks for protein function prediction" } });
    const checks = await checkDois(["10.1/real"], env(), AbortSignal.timeout(5000));
    const p = paper("10.1/real", "Graph neural networks for protein function prediction");
    expect(applyDoiChecks([p], checks)).toBe(0);
    expect(p).toMatchObject({ doi: "10.1/real", doiStatus: "verified" });
  });

  it("REMOVES a DOI that does not exist anywhere, and re-keys the result", async () => {
    stub({ handles: { "10.63544/ghost": 100 as unknown as number } });
    const p = paper("10.63544/ghost", "Machine Learning for Handwritten Digit Recognition", { retracted: true, retractionSources: ["crossref-retraction-watch"] });
    const checks = await checkDois(["10.63544/ghost"], env(), AbortSignal.timeout(5000));
    expect(applyDoiChecks([p], checks)).toBe(1);
    expect(p.doi).toBeNull();
    expect(p.doiStatus).toBe("dropped_unresolvable");
    expect(p.id.startsWith("t:")).toBe(true); // no longer embeds the bad DOI
    expect(p.retracted).toBe(false); // a retraction flag that came from the bad DOI goes with it
  });

  it("REMOVES a DOI whose registered title belongs to a different record (commentary attached to the paper)", async () => {
    stub({ registered: { "10.1097/ebp.1032": "Dapagliflozin, not just for diabetes anymore" } });
    const p = paper("10.1097/ebp.1032", "Dapagliflozin in patients with heart failure and reduced ejection fraction", { sources: ["s2"] });
    const checks = await checkDois(["10.1097/ebp.1032"], env(), AbortSignal.timeout(5000));
    expect(applyDoiChecks([p], checks)).toBe(1);
    expect(p).toMatchObject({ doi: null, doiStatus: "dropped_conflict" });
  });

  it("keeps DataCite-style DOIs that resolve at doi.org but are not in Crossref", async () => {
    stub({ handles: { "10.5281/zenodo.1": 1 } });
    const p = paper("10.5281/zenodo.1", "A dataset");
    const checks = await checkDois(["10.5281/zenodo.1"], env(), AbortSignal.timeout(5000));
    expect(applyDoiChecks([p], checks)).toBe(0);
    expect(p).toMatchObject({ doi: "10.5281/zenodo.1", doiStatus: "verified" });
  });

  it("never drops a DOI because doi.org errored: it stays, marked unchecked", async () => {
    stub({ handles: { "10.9/x": "error" } });
    const p = paper("10.9/x", "Something");
    const checks = await checkDois(["10.9/x"], env(), AbortSignal.timeout(5000));
    expect(applyDoiChecks([p], checks)).toBe(0);
    expect(p).toMatchObject({ doi: "10.9/x", doiStatus: "unchecked" });
  });

  it("makes ONE Crossref call for the batch and caps doi.org lookups (subrequest budget)", async () => {
    const dois = Array.from({ length: 30 }, (_, i) => `10.7/n${i}`);
    const calls = stub({ handles: Object.fromEntries(dois.map((d) => [d, 1 as const])) });
    const checks = await checkDois(dois, env(), AbortSignal.timeout(5000));
    expect(calls.filter((c) => c.includes("api.crossref.org")).length).toBe(1);
    expect(calls.filter((c) => c.includes("doi.org/api/handles")).length).toBe(12);
    expect(Object.values(checks).filter((c) => c.status === "unchecked").length).toBe(18);
  });

  it("caches the batch so a repeated search costs nothing", async () => {
    const e = env();
    const calls = stub({ registered: { "10.1/a": "Title A" } });
    await checkDois(["10.1/a"], e, AbortSignal.timeout(5000));
    const before = calls.length;
    await checkDois(["10.1/a"], e, AbortSignal.timeout(5000));
    expect(calls.length).toBe(before);
  });

  it("results without a DOI are untouched", () => {
    const p = paper(null, "No DOI here");
    expect(applyDoiChecks([p], {})).toBe(0);
    expect(p.doiStatus).toBeUndefined();
  });
});

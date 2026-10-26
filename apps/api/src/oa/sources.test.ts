import { describe, expect, it } from "vitest";
import REAL_XML from "./fixtures/PMC1182327.xml?raw";
import { fetchArxivMeta, fetchPaperSource, fetchPmcXml, lookupByDoi, type Lane } from "./sources";

const UA = "scholar-ai-test (mailto:test@example.com)";
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n");
const EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest";
const search = (doi: string) => `${EPMC}/search?query=${encodeURIComponent(`DOI:"${doi}"`)}&format=json&resultType=core&pageSize=1`;

const hit = (over: Record<string, unknown> = {}) => JSON.stringify({ resultList: { result: [{ id: "x", source: "MED", pmcid: "PMC1182327", isOpenAccess: "Y", license: "cc by", title: "Why <i>Most</i> Published Findings Are False", abstractText: "<h4>Background</h4><p>There is concern &amp; doubt.</p>", ...over }] } });
const json = (body: string) => () => new Response(body, { status: 200, headers: { "content-type": "application/json" } });
const pdf = () => new Response(PDF, { status: 200, headers: { "content-type": "application/pdf" } });
const status = (s: number) => () => new Response("no", { status: s });

function world(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const lanes: Lane[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return (routes[url] ?? status(404))();
  }) as typeof fetch;
  return { calls, lanes, deps: { fetchImpl, userAgent: UA, gated: async <T,>(lane: Lane, run: () => Promise<T>) => (lanes.push(lane), run()) } };
}

describe("lookupByDoi", () => {
  it("returns the PubMed Central number, the open-access flag, the normalised licence, and the title and abstract as plain text", async () => {
    const w = world({ [search("10.1371/journal.pmed.0020124")]: json(hit()) });
    expect(await lookupByDoi("https://doi.org/10.1371/JOURNAL.PMED.0020124", w.deps)).toEqual({
      pmcid: "PMC1182327", isOpenAccess: true, license: "cc-by", title: "Why Most Published Findings Are False", abstract: "Background There is concern & doubt.",
    });
    expect(w.lanes).toEqual(["europepmc"]);
  });
  it("tells a paper that is known but not open access, and one with no PMC copy", async () => {
    const w = world({ [search("10.1111/a.1")]: json(hit({ pmcid: undefined, isOpenAccess: "N", license: undefined })) });
    expect(await lookupByDoi("10.1111/a.1", w.deps)).toMatchObject({ pmcid: null, isOpenAccess: false, license: null });
  });
  it("is null for nothing found, a failed call, bad JSON, and a DOI that cannot be put in a query", async () => {
    const w = world({ [search("10.1111/none")]: json(JSON.stringify({ resultList: { result: [] } })), [search("10.1111/down")]: status(500), [search("10.1111/junk")]: json("<html>") });
    expect(await lookupByDoi("10.1111/none", w.deps)).toBeNull();
    expect(await lookupByDoi("10.1111/down", w.deps)).toBeNull();
    expect(await lookupByDoi("10.1111/junk", w.deps)).toBeNull();
    expect(await lookupByDoi('10.1111/has"quote', w.deps)).toBeNull();
    expect(await lookupByDoi("not a doi", w.deps)).toBeNull();
    expect(w.calls).not.toContain(search('10.1111/has"quote'));
  });
});

describe("fetchPmcXml", () => {
  it("gives the XML of an article, and not an error document that came with a 200", async () => {
    const w = world({ [`${EPMC}/PMC1182327/fullTextXML`]: () => new Response(REAL_XML, { status: 200 }), [`${EPMC}/PMC9/fullTextXML`]: () => new Response("<html>not found</html>", { status: 200 }) });
    const ok = await fetchPmcXml("pmc1182327", w.deps);
    expect(ok.ok && ok.xml.includes("Why Most Published Research Findings Are False")).toBe(true);
    expect(await fetchPmcXml("PMC9", w.deps)).toEqual({ ok: false, reason: "no_source" });
    expect(await fetchPmcXml("not-a-pmcid", w.deps)).toEqual({ ok: false, reason: "no_source" });
  });
});

describe("fetchArxivMeta", () => {
  it("reads the title and abstract of the first entry", async () => {
    const atom = `<feed><title>query</title><entry><id>x</id><title>Attention Is
 All You Need</title><summary>  The dominant sequence
 transduction models.  </summary></entry></feed>`;
    const w = world({ "https://export.arxiv.org/api/query?id_list=1706.03762": () => new Response(atom, { status: 200 }) });
    expect(await fetchArxivMeta("arXiv:1706.03762v5", w.deps)).toEqual({ title: "Attention Is All You Need", abstract: "The dominant sequence transduction models." });
    expect(w.lanes).toEqual(["arxiv"]);
    expect(await fetchArxivMeta("nonsense", w.deps)).toBeNull();
  });
});

describe("fetchPaperSource: the ladder", () => {
  it("1. takes Europe PMC's XML when the DOI has an open-access PubMed Central copy, and does not touch the PDF link", async () => {
    const w = world({ [search("10.1371/journal.pmed.0020124")]: json(hit()), [`${EPMC}/PMC1182327/fullTextXML`]: () => new Response(REAL_XML, { status: 200 }), "https://x.example.org/p.pdf": pdf });
    const r = await fetchPaperSource({ doi: "10.1371/journal.pmed.0020124", oaUrl: "https://x.example.org/p.pdf" }, w.deps);
    expect(r).toMatchObject({ ok: true, source: "europepmc", format: "xml", license: "cc-by", title: "Why Most Published Findings Are False" });
    expect(w.calls).not.toContain("https://x.example.org/p.pdf");
  });

  it("2. falls to the arXiv PDF when there is no PubMed Central copy", async () => {
    const w = world({ [search("10.48550/arxiv.1706.03762")]: json(JSON.stringify({ resultList: { result: [] } })), "https://arxiv.org/pdf/1706.03762": pdf });
    const r = await fetchPaperSource({ doi: "10.48550/arXiv.1706.03762" }, w.deps);
    expect(r).toMatchObject({ ok: true, source: "arxiv", format: "pdf" });
    expect(w.lanes).toContain("arxiv");
  });

  it("an arXiv number alone is enough", async () => {
    const w = world({ "https://arxiv.org/pdf/1706.03762": pdf });
    expect(await fetchPaperSource({ arxivId: "1706.03762v2" }, w.deps)).toMatchObject({ ok: true, source: "arxiv" });
    expect(w.calls).toEqual(["https://arxiv.org/pdf/1706.03762"]);
  });

  it("3. falls to the open-access link of the record when the others fail, through its own lane", async () => {
    const w = world({ [search("10.5555/a")]: json(hit({ pmcid: undefined, isOpenAccess: "N" })), "https://journal.example.org/a.pdf": pdf });
    const r = await fetchPaperSource({ doi: "10.5555/a", oaUrl: "https://journal.example.org/a.pdf" }, w.deps);
    expect(r).toMatchObject({ ok: true, source: "pdf", format: "pdf" });
    expect(w.lanes.at(-1)).toBe("oahost");
  });

  it("a PubMed Central XML that cannot be fetched does not stop the other sources", async () => {
    const w = world({ [search("10.5555/b")]: json(hit()), [`${EPMC}/PMC1182327/fullTextXML`]: status(500), "https://journal.example.org/b.pdf": pdf });
    expect(await fetchPaperSource({ doi: "10.5555/b", oaUrl: "https://journal.example.org/b.pdf" }, w.deps)).toMatchObject({ ok: true, source: "pdf" });
  });

  it("a paper that is not in the open-access subset is not asked for its XML", async () => {
    const w = world({ [search("10.5555/c")]: json(hit({ isOpenAccess: "N" })) });
    const r = await fetchPaperSource({ doi: "10.5555/c" }, w.deps);
    expect(r).toEqual({ ok: false, reason: "not_open_access" });
    expect(w.calls.some((u) => u.includes("fullTextXML"))).toBe(false);
  });

  it("4. says why nothing could be read: blocked beats not-found, and a known closed paper is 'not open access'", async () => {
    const blocked = world({ [search("10.5555/d")]: json(JSON.stringify({ resultList: { result: [] } })), "https://pub.example.org/d.pdf": status(403) });
    expect(await fetchPaperSource({ doi: "10.5555/d", oaUrl: "https://pub.example.org/d.pdf" }, blocked.deps)).toEqual({ ok: false, reason: "blocked" });
    const mixed = world({ "https://arxiv.org/pdf/1234.5678": status(404), "https://pub.example.org/e.pdf": status(403) });
    expect(await fetchPaperSource({ arxivId: "1234.5678", oaUrl: "https://pub.example.org/e.pdf" }, mixed.deps)).toEqual({ ok: false, reason: "blocked" });
    const closed = world({ [search("10.5555/f")]: json(hit({ pmcid: undefined, isOpenAccess: "N" })) });
    expect(await fetchPaperSource({ doi: "10.5555/f" }, closed.deps)).toEqual({ ok: false, reason: "not_open_access" });
    const nothing = world({});
    expect(await fetchPaperSource({ doi: "10.5555/g" }, nothing.deps)).toEqual({ ok: false, reason: "no_source" });
    expect(await fetchPaperSource({}, nothing.deps)).toEqual({ ok: false, reason: "no_source" });
  });

  it("a private address given as the record's link is never fetched", async () => {
    const w = world({ "https://169.254.169.254/latest/meta-data/": pdf });
    expect(await fetchPaperSource({ oaUrl: "https://169.254.169.254/latest/meta-data/" }, w.deps)).toEqual({ ok: false, reason: "blocked" });
    expect(w.calls).toEqual([]);
  });
});

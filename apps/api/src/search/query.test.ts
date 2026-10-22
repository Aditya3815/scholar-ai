import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryStore } from "../cache/store";
import { runSearch } from "./index";
import { FEW_RESULTS, interleave, queryVariants, splitToken } from "./query";
import type { ProviderPaper, SearchEnv } from "./types";

describe("splitToken", () => {
  it("splits a name written as one word into the words it is", () => {
    expect(splitToken("SwinYolo")).toEqual(["Swin", "Yolo"]);
    expect(splitToken("SwinYOLO")).toEqual(["Swin", "YOLO"]);
    expect(splitToken("swinYolo")).toEqual(["swin", "Yolo"]);
    expect(splitToken("swin_yolo")).toEqual(["swin", "yolo"]);
    expect(splitToken("XMLHttpRequest")).toEqual(["XML", "Http", "Request"]);
    expect(splitToken("ResNet50")).toEqual(["Res", "Net50"]);
  });
  it("leaves a real acronym with a version, a short name and plain words alone", () => {
    for (const t of ["YOLOv8", "GPT4", "3D", "5G", "BERT", "transformer", "Transformer", "CRISPR-Cas9", "e.g.", "10.1000/x"]) expect(splitToken(t), t).toEqual([t]);
  });
  it("is not confused by accents, other scripts, numbers or an empty token", () => {
    expect(splitToken("ÉcoleNormale")).toEqual(["École", "Normale"]);
    expect(splitToken("भारत")).toEqual(["भारत"]);
    expect(splitToken("2024")).toEqual(["2024"]);
    expect(splitToken("")).toEqual([""]);
  });
});

describe("queryVariants", () => {
  it("writes the one-word name as words, in place, and keeps the other words", () => {
    expect(queryVariants("SwinYolo")).toEqual(["Swin Yolo"]);
    expect(queryVariants("SwinYOLO underwater detection")).toEqual(["Swin YOLO underwater detection"]);
    expect(queryVariants("fish detection with SwinYolo")).toEqual(["fish detection with Swin Yolo"]);
  });
  it("has nothing to add for an ordinary search", () => {
    for (const q of ["glaucoma screening", "Attention is all you need", "deep learning", "YOLOv8 face detection", "CRISPR-Cas9 off target effects", "10.1038/nature14539", "ab", ""]) expect(queryVariants(q), q).toEqual([]);
  });
  it("never offers the original, and never more than two", () => {
    const v = queryVariants("SwinYolo FooBar");
    expect(v.length).toBeLessThanOrEqual(2);
    expect(v.every((x) => x.toLowerCase() !== "swinyolo foobar")).toBe(true);
  });
  it("does not split into pieces too small to mean anything", () => {
    expect(queryVariants("iPhone")).toEqual([]);
    expect(queryVariants("eBay")).toEqual([]);
    expect(queryVariants("McDonald")).toEqual([]);
  });
});

const P = (title: string, doi: string | null = null, year = 2022): ProviderPaper => ({ doi, pmid: null, title, authors: [], year, venue: null, abstract: null, citationCount: null, oaUrl: null, retracted: false });

describe("interleave", () => {
  it("takes the lists rank by rank, the first list first, each paper once", () => {
    const out = interleave([[P("A", "10.1/a"), P("B", "10.1/b")], [P("C", "10.1/c"), P("A again", "10.1/a"), P("D", "10.1/d")]]);
    expect(out.map((p) => p.title)).toEqual(["A", "C", "B", "D"]);
  });
  it("matches a paper without a DOI by its title and year", () => {
    expect(interleave([[P("Same Title!")], [P("same title")]])).toHaveLength(1);
    expect(interleave([[P("Same Title", null, 2020)], [P("same title", null, 2021)]])).toHaveLength(2);
  });
  it("copes with empty lists", () => {
    expect(interleave([])).toEqual([]);
    expect(interleave([[], []])).toEqual([]);
    expect(interleave([[], [P("A")]]).map((p) => p.title)).toEqual(["A"]);
  });
});

/* ---------------------------------------------------------------- the whole search with the services stubbed */

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const oaWork = (title: string, i: number) => ({ id: `https://openalex.org/W${i}`, doi: `https://doi.org/10.5555/${title.replace(/\W+/g, "").toLowerCase()}${i}`, title, publication_year: 2023, cited_by_count: 3, is_retracted: false, authorships: [], primary_location: null, open_access: null, abstract_inverted_index: null, ids: {} });
const env = (): SearchEnv => ({ store: memoryStore(), OPENALEX_API_KEY: "k", S2_API_KEY: "k", CROSSREF_MAILTO: "t@example.org" });

function network(answer: (service: "openalex" | "s2" | "crossref" | "pubmed", query: string) => unknown[]) {
  const calls: { service: string; query: string }[] = [];
  vi.stubGlobal("fetch", async (input: unknown) => {
    const url = new URL(String(input));
    const host = url.hostname;
    if (host === "api.openalex.org") {
      const query = decodeURIComponent((url.searchParams.get("filter") ?? "").replace(/^title_and_abstract\.search:/, ""));
      calls.push({ service: "openalex", query });
      return json({ results: answer("openalex", query) });
    }
    if (host === "api.semanticscholar.org") {
      const query = url.searchParams.get("query") ?? "";
      calls.push({ service: "s2", query });
      return json({ data: answer("s2", query) });
    }
    if (host === "api.crossref.org" && url.searchParams.has("query.bibliographic")) {
      const query = url.searchParams.get("query.bibliographic") ?? "";
      calls.push({ service: "crossref", query });
      return json({ message: { items: answer("crossref", query) } });
    }
    if (host === "eutils.ncbi.nlm.nih.gov") {
      calls.push({ service: "pubmed", query: url.searchParams.get("term") ?? "" });
      return json({ esearchresult: { idlist: [] } });
    }
    if (host === "doi.org") return json({ responseCode: 1 });
    return json({ message: { items: [] } }); // Crossref DOI and retraction checks
  });
  return calls;
}

describe("a search that finds few papers is run again with the name written as words", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("SwinYolo: the one paper it finds as written, plus the many it finds as 'Swin Yolo'", async () => {
    const calls = network((service, q) => (service === "openalex" ? (q === "SwinYolo" ? [oaWork("Underwater Enhancement with SwinYolo", 1)] : Array.from({ length: 20 }, (_, i) => oaWork(`Swin-YOLO study ${i}`, 100 + i))) : []));
    const out = await runSearch(env(), "SwinYolo", 20);
    expect(out.alsoSearched).toEqual(["Swin Yolo"]);
    expect(out.results.length).toBeGreaterThanOrEqual(15);
    expect(out.results[0]!.title).toBe("Underwater Enhancement with SwinYolo"); // what was asked for as written stays first
    expect(calls.filter((c) => c.service === "openalex").map((c) => c.query)).toEqual(["SwinYolo", "Swin Yolo"]);
  });

  it("every service is asked the other spelling too, and a service that fails on it does not spoil the rest", async () => {
    const calls = network(() => []);
    vi.stubGlobal("fetch", async (input: unknown) => {
      const url = new URL(String(input));
      if (url.hostname === "api.semanticscholar.org" && url.searchParams.get("query") === "Swin Yolo") return json({}, 503);
      return json({ results: [], data: [], message: { items: [] }, esearchresult: { idlist: [] } });
    });
    const out = await runSearch(env(), "SwinYolo", 20);
    expect(out.alsoSearched).toEqual(["Swin Yolo"]);
    expect(out.providers.s2!.ok).toBe(true);
    expect(calls).toBeDefined();
  });

  it("a search that already finds enough papers is not run a second time", async () => {
    const calls = network((service) => (service === "openalex" ? Array.from({ length: 20 }, (_, i) => oaWork(`Many papers ${i}`, i)) : []));
    const out = await runSearch(env(), "SwinYolo", 20);
    expect(FEW_RESULTS).toBeLessThan(20);
    expect(out.alsoSearched).toBeUndefined();
    expect(calls.filter((c) => c.service === "openalex")).toHaveLength(1);
  });

  it("an ordinary search that finds few papers has no other spelling to try, so nothing extra is asked", async () => {
    const calls = network((service) => (service === "openalex" ? [oaWork("Only one", 1)] : []));
    const out = await runSearch(env(), "glaucoma smartphone", 20);
    expect(out.alsoSearched).toBeUndefined();
    expect(calls.filter((c) => c.service === "openalex")).toHaveLength(1);
  });

  it("when every service failed the first time, nothing more is asked", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (input: unknown) => {
      seen.push(new URL(String(input)).hostname);
      return json({}, 503);
    });
    const out = await runSearch(env(), "SwinYolo", 20);
    expect(out.alsoSearched).toBeUndefined();
    expect(out.results).toEqual([]);
    expect(seen.filter((h) => h === "api.openalex.org")).toHaveLength(1);
  });

  it("the page is told about the other spelling in the snapshots too", async () => {
    network((service, q) => (service === "openalex" ? (q === "SwinYolo" ? [] : [oaWork("Swin-YOLO result", 5)]) : []));
    const snaps: (string[] | undefined)[] = [];
    await runSearch(env(), "SwinYolo", 20, { onSnapshot: (s) => void snaps.push(s.alsoSearched) });
    expect(snaps.at(-1)).toEqual(["Swin Yolo"]);
  });
});

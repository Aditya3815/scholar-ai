import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStore } from "../cache/store";
import { resetGates } from "../gate";
import { runSearch } from "./index";
import { SHODHGANGA_SOURCE, doajQuery, recordPage, toDoajPapers, toIndiaPapers, webUrl, withoutIndia } from "./india";
import type { SearchEnv } from "./types";

describe("the words sent to DOAJ", () => {
  it("keeps the words that carry meaning, joined so that each must be in the record", () => {
    expect(doajQuery("Groundwater quality assessment")).toBe("groundwater AND quality AND assessment");
    expect(doajQuery("anaemia in adolescent girls of India")).toBe("anaemia AND adolescent AND girls");
  });
  it("lets nothing of the query syntax through: quotes, colons, brackets, wildcards and operators become plain words or go", () => {
    const q = doajQuery('title:"x" OR (bibjson.journal.country:US) AND glau* -cancer \\ NOT');
    expect(q).not.toMatch(/[":()*\\-]/);
    expect(q.split(" AND ").every((w) => /^[a-z0-9]+$/.test(w))).toBe(true);
  });
  it("is empty when nothing is left, and keeps at most eight words", () => {
    expect(doajQuery("the of and")).toBe("");
    expect(doajQuery("a1x b2x c3x d4x e5x f6x g7x h8x i9x j0x").split(" AND ")).toHaveLength(8);
  });
});

describe("the words for an Indian source", () => {
  it("leave out India, which the source already is, unless nothing else is left", () => {
    expect(withoutIndia("adolescent girls India anaemia prevalence")).toBe("adolescent girls anaemia prevalence");
    expect(withoutIndia("Indian monsoon rainfall")).toBe("monsoon rainfall");
    expect(withoutIndia("India")).toBe("India");
    expect(withoutIndia("Indiana farm subsidies")).toBe("Indiana farm subsidies");
  });
});

describe("only a web address becomes a link", () => {
  it("keeps http and https", () => {
    expect(webUrl("https://shodhganga.inflibnet.ac.in/handle/10603/22976")).toBe("https://shodhganga.inflibnet.ac.in/handle/10603/22976");
    expect(webUrl(" http://www.jcor.in/article.asp?x=1 ")).toBe("http://www.jcor.in/article.asp?x=1");
  });
  it("refuses a script, a data address, a relative one and anything that is not text", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,<b>x</b>", "/handle/1", "ftp://x.org/a", "", null, 42]) expect(webUrl(bad), String(bad)).toBeNull();
  });
});

describe("the page of a Shodhganga thesis", () => {
  it("every address OpenAlex gives for the same record becomes its handle page", () => {
    const page = "https://shodhganga.inflibnet.ac.in/handle/10603/26589";
    for (const raw of [
      "https://shodhganga.inflibnet.ac.in/handle/10603/26589",
      "https://shodhganga.inflibnet.ac.in/jspui/handle/10603/26589",
      "https://shodhganga.inflibnet.ac.in/jspui/handle/10603/26589?mode=full",
      "http://shodhganga.inflibnet.ac.in:8080/jspui/bitstream/10603/26589/1/01_title.pdf",
    ]) expect(recordPage(raw), raw).toBe(page);
  });
  it("another repository's page, or a Shodhganga address without a handle, is kept as it is; a script is not", () => {
    expect(recordPage("http://dyuthi.cusat.ac.in/purl/3703")).toBe("http://dyuthi.cusat.ac.in/purl/3703");
    expect(recordPage("https://shodhganga.inflibnet.ac.in/")).toBe("https://shodhganga.inflibnet.ac.in/");
    expect(recordPage("javascript:alert(1)")).toBeNull();
  });
});

describe("a DOAJ record becomes a paper", () => {
  const rec = (b: object) => ({ bibjson: { title: "Screening camps in rural <i>Maharashtra</i>", year: "2021", author: [{ name: " P. Deshmukh " }, {}], identifier: [{ id: "2320-3897", type: "pissn" }, { id: "10.4103/IJO.IJO_531_24", type: "DOI" }], journal: { title: "Indian Journal of Ophthalmology", country: "IN" }, link: [{ type: "fulltext", url: "https://www.ijo.in/a" }], abstract: "<p>Camps examined 4,200 adults &amp; found glaucoma.</p>", ...b } });
  it("takes the DOI whatever its case, the journal, the year, the authors, the abstract without markup and the full-text link", () => {
    const [p] = toDoajPapers([rec({})]);
    expect(p).toMatchObject({ doi: "10.4103/ijo.ijo_531_24", title: "Screening camps in rural Maharashtra", year: 2021, venue: "Indian Journal of Ophthalmology", authors: ["P. Deshmukh"], abstract: "Camps examined 4,200 adults & found glaucoma.", oaUrl: "https://www.ijo.in/a", workType: "article", retracted: false });
  });
  it("drops a record without a title, gives no link for a script address and no year for nonsense", () => {
    expect(toDoajPapers([rec({ title: "" }), {}])).toHaveLength(0);
    const [p] = toDoajPapers([rec({ link: [{ type: "fulltext", url: "javascript:alert(1)" }], year: "n.d." })]);
    expect(p!.oaUrl).toBeNull();
    expect(p!.year).toBeNull();
  });
});

describe("an OpenAlex record in the Indian search", () => {
  const work = (o: object) => ({ title: "Automated system for the diagnosis of glaucoma", publication_year: 2012, type: "dissertation", primary_location: { landing_page_url: "https://shodhganga.inflibnet.ac.in/handle/10603/22976", source: { display_name: "Shodhganga" } }, authorships: [{ author: { display_name: "S N Kavitha" } }], ...o });
  it("a thesis with no DOI keeps the page of its record, says it is a dissertation, and has no abstract to answer from", () => {
    const [p] = toIndiaPapers([work({})]);
    expect(p).toMatchObject({ doi: null, url: "https://shodhganga.inflibnet.ac.in/handle/10603/22976", workType: "dissertation", venue: "Shodhganga", abstract: null });
  });
  it("a paper with a DOI is linked by its DOI, not by a page", () => {
    const [p] = toIndiaPapers([work({ doi: "https://doi.org/10.1000/X1", type: "article" })]);
    expect(p!.doi).toBe("10.1000/x1");
    expect("url" in p!).toBe(false);
  });
  it("a record found through Shodhganga is a thesis even when OpenAlex calls it an article", () => {
    expect(toIndiaPapers([work({ type: "article" })], { thesis: true })[0]!.workType).toBe("dissertation");
    expect(toIndiaPapers([work({ type: "article" })])[0]!.workType).toBe("article");
  });
  it("a page that is not a web address is not kept", () => {
    expect(toIndiaPapers([work({ primary_location: { landing_page_url: "javascript:x()" } })])[0]!.url).toBeNull();
  });
});

/* ---------------------------------------------------------------- the whole Indian search, the services stubbed */

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const env = (): SearchEnv => ({ store: memoryStore(), OPENALEX_API_KEY: "k", S2_API_KEY: "k", CROSSREF_MAILTO: "t@example.org" });

describe("runSearch with the Indian scope", () => {
  beforeEach(() => resetGates({ doaj: { minIntervalMs: 0 } }));
  afterEach(() => vi.unstubAllGlobals());

  function network(opts: { doajStatus?: number } = {}) {
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (input: unknown) => {
      const url = new URL(String(input));
      if (url.hostname === "doaj.org") {
        asked.push(`doaj ${decodeURIComponent(url.pathname)}`);
        if (opts.doajStatus) return json({}, opts.doajStatus);
        return json({ results: [{ bibjson: { title: "Glaucoma screening camps in rural Maharashtra", year: "2021", identifier: [{ id: "10.4103/ijo.1", type: "doi" }], journal: { title: "Indian Journal of Ophthalmology" }, abstract: "Camps examined adults." } }] });
      }
      if (url.hostname === "api.openalex.org") {
        const filter = url.searchParams.get("filter") ?? "";
        asked.push(`openalex ${filter.split(",")[0]}`);
        if (filter.includes(SHODHGANGA_SOURCE)) return json({ results: [{ title: "Glaucoma awareness among adults in Karnataka", publication_year: 2016, type: "dissertation", primary_location: { landing_page_url: "https://shodhganga.inflibnet.ac.in/handle/10603/1", source: { display_name: "Shodhganga" } } }] });
        // the same DOAJ article, as OpenAlex knows it: the two copies become one paper
        return json({ results: [{ doi: "https://doi.org/10.4103/IJO.1", title: "Glaucoma screening camps in rural Maharashtra", publication_year: 2021, cited_by_count: 7, type: "article", primary_location: { source: { display_name: "Indian Journal of Ophthalmology" } } }] });
      }
      if (url.hostname === "doi.org") return json({ responseCode: 1 });
      asked.push(`other ${url.hostname}`);
      return json({ message: { items: [] } }); // Crossref: the DOI and retraction checks
    });
    return asked;
  }

  it("asks only the Indian sources, merges the copies, keeps the thesis with its page, and says which scope it was", async () => {
    const asked = network();
    const out = await runSearch(env(), "glaucoma screening", 20, {}, "india");
    expect(Object.keys(out.providers).sort()).toEqual(["doaj", "openalex-india", "shodhganga"]);
    expect(asked.filter((a) => a.startsWith("doaj"))).toEqual(["doaj /api/v4/search/articles/(glaucoma AND screening) AND bibjson.journal.country:IN"]);
    expect(asked).toContain("openalex authorships.institutions.country_code:IN");
    expect(asked).toContain(`openalex locations.source.id:${SHODHGANGA_SOURCE}`);
    expect(asked.some((a) => /semanticscholar|ncbi/.test(a))).toBe(false);
    expect(out.scope).toBe("india");
    expect(out.results).toHaveLength(2);
    const article = out.results.find((p) => p.doi === "10.4103/ijo.1")!;
    expect(article.sources.sort()).toEqual(["doaj", "openalex-india"]);
    expect(article.citationCount).toBe(7);
    const thesis = out.results.find((p) => p.workType === "dissertation")!;
    expect(thesis).toMatchObject({ doi: null, url: "https://shodhganga.inflibnet.ac.in/handle/10603/1", sources: ["shodhganga"] });
  });

  it("a source that fails is reported, and the others are still shown", async () => {
    network({ doajStatus: 503 });
    const out = await runSearch(env(), "glaucoma screening", 20, {}, "india");
    expect(out.providers.doaj).toMatchObject({ ok: false, error: "DOAJ HTTP 503" });
    expect(out.results.length).toBe(2);
  });

  it("the regular search does not change: no Indian source is asked and no scope is reported", async () => {
    const asked = network();
    const out = await runSearch(env(), "glaucoma screening", 20);
    expect(asked.some((a) => a.startsWith("doaj") || a.includes("country_code") || a.includes(SHODHGANGA_SOURCE))).toBe(false);
    expect(out.scope).toBeUndefined();
    expect(Object.keys(out.providers).sort()).toEqual(["crossref", "openalex", "pubmed", "s2"]);
  });
});

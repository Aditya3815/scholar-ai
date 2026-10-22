import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_PAPER_REFERENCES, type PaperInfo } from "@scholar/shared";
import { enrichPaperInfo, sanitizePaperInfo } from "./info";

const env = { CROSSREF_MAILTO: "test@example.org" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

const base: PaperInfo = { pages: 12, title: "Glaucoma Screening in Rural Clinics", doi: "10.1234/glaucoma.5", arxiv: null, outline: [], headings: [], references: [], referencesSource: "none", metadata: null };

const crossrefRecord = (over: Record<string, unknown> = {}) => ({
  message: { DOI: "10.1234/glaucoma.5", title: ["Glaucoma screening in rural clinics"], author: [{ given: "Anita", family: "Desai" }, { given: "Rahul", family: "Verma" }], issued: { "date-parts": [[2021]] }, "container-title": ["Ophthalmology Today"], ...over },
});

describe("sanitizePaperInfo", () => {
  it("keeps good data and ignores what the client has no say in", () => {
    const info = sanitizePaperInfo({
      pages: 12, title: "  A   Title ", doi: "10.1234/ABC.5", arxiv: "1706.03762", metadata: { title: "forged" }, referencesSource: "crossref",
      outline: [{ title: "Intro", page: 2, level: 1 }], headings: [{ title: "Methods", page: 3, level: 2 }], references: ["Smith, J. (2020). A reference with enough text. Journal, 1."],
    })!;
    expect(info).toMatchObject({ pages: 12, title: "A Title", doi: "10.1234/abc.5", arxiv: "1706.03762", metadata: null, referencesSource: "pdf" });
    expect(info.outline).toEqual([{ title: "Intro", page: 2, level: 1 }]);
    expect(info.references).toHaveLength(1);
  });

  it("rejects input without a usable page count, and non-objects", () => {
    expect(sanitizePaperInfo(null)).toBeNull();
    expect(sanitizePaperInfo("text")).toBeNull();
    expect(sanitizePaperInfo({ title: "x" })).toBeNull();
    expect(sanitizePaperInfo({ pages: 0 })).toBeNull();
    expect(sanitizePaperInfo({ pages: 9999 })).toBeNull();
  });

  it("drops malformed identifiers, junk entries and out-of-range values", () => {
    const info = sanitizePaperInfo({
      pages: 5, doi: "not a doi", arxiv: "<script>", title: 42,
      outline: [{ title: "ok", page: 99, level: 99 }, { title: "", page: 1 }, "str", null],
      references: ["short", 7, "x".repeat(3000)],
    })!;
    expect(info.doi).toBeNull();
    expect(info.arxiv).toBeNull();
    expect(info.title).toBeNull();
    expect(info.outline).toEqual([{ title: "ok", page: 0, level: 1 }]);
    expect(info.references).toHaveLength(1);
    expect(info.references[0]!.length).toBe(1000);
  });

  it("caps the sizes of the lists", () => {
    const info = sanitizePaperInfo({ pages: 5, outline: Array.from({ length: 500 }, (_, i) => ({ title: `h${i}`, page: 1, level: 1 })), references: Array.from({ length: 900 }, (_, i) => `Reference number ${i} with enough text to count.`) })!;
    expect(info.outline).toHaveLength(150);
    expect(info.references).toHaveLength(MAX_PAPER_REFERENCES);
  });
});

describe("enrichPaperInfo", () => {
  it("adds metadata from Crossref when the title agrees with the PDF's", async () => {
    vi.stubGlobal("fetch", async () => json(crossrefRecord()));
    const out = await enrichPaperInfo(base, env);
    expect(out.metadata).toMatchObject({ source: "crossref", year: 2021, venue: "Ophthalmology Today", authors: ["Anita Desai", "Rahul Verma"] });
  });

  it("does not trust a DOI whose record is a different paper", async () => {
    vi.stubGlobal("fetch", async () => json(crossrefRecord({ title: ["Quarterly sales of kitchen appliances"] })));
    expect((await enrichPaperInfo(base, env)).metadata).toBeNull();
  });

  it("uses the arXiv DOI through OpenAlex for a preprint with no DOI of its own", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (u: unknown) => {
      urls.push(String(u));
      if (String(u).includes("crossref")) return json({}, 404);
      return json({ doi: "https://doi.org/10.48550/arxiv.1706.03762", title: "Attention Is All You Need", publication_year: 2025, authorships: [{ author: { display_name: "Ashish Vaswani" } }], primary_location: { source: { display_name: "arXiv" } } });
    });
    const out = await enrichPaperInfo({ ...base, doi: null, arxiv: "1706.03762", title: "Attention Is All You Need" }, env);
    expect(out.metadata).toMatchObject({ source: "openalex", year: 2017, authors: ["Ashish Vaswani"] }); // OpenAlex said 2025 (latest version); the arXiv id says 2017
    expect(urls.some((u) => u.includes("10.48550/arxiv.1706.03762"))).toBe(true);
  });

  it("never fails because a lookup service is down", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("offline"); });
    const out = await enrichPaperInfo(base, env);
    expect(out.metadata).toBeNull();
    expect(out.references).toEqual([]);
  });

  it("falls back to the publisher's reference list when the PDF's could not be read", async () => {
    vi.stubGlobal("fetch", async () =>
      json({
        message: {
          ...crossrefRecord().message,
          reference: [
            { key: "1", unstructured: "Smith J. A study of studies. J Examples 2019;4:1-9." },
            { key: "2", author: "Rao", year: "2018", "article-title": "Open access in India", "journal-title": "Scientometrics", volume: "124", "first-page": "55", DOI: "10.1007/x" },
            { key: "3", DOI: "10.1000/only.a.doi.here" },
            { key: "4", unstructured: "tiny" },
          ],
        },
      }),
    );
    const out = await enrichPaperInfo(base, env);
    expect(out.referencesSource).toBe("crossref");
    expect(out.references).toEqual([
      "Smith J. A study of studies. J Examples 2019;4:1-9.",
      "Rao (2018) Open access in India. Scientometrics, 124, 55. https://doi.org/10.1007/x".replace("Rao (2018)", "Rao (2018)"),
      "https://doi.org/10.1000/only.a.doi.here",
    ]);
  });

  it("keeps the PDF's own list when it found a sensible one", async () => {
    vi.stubGlobal("fetch", async () => json({ message: { ...crossrefRecord().message, reference: [{ unstructured: "Some deposited reference that is long enough." }, { unstructured: "Another deposited reference that is long enough." }, { unstructured: "A third deposited reference that is long enough." }] } }));
    const own = ["Aaa, A. 2001. A first reference of ordinary length. J A 1.", "Bbb, B. 2002. A second reference of ordinary length. J B 2.", "Ccc, C. 2003. A third reference of ordinary length. J C 3."];
    const out = await enrichPaperInfo({ ...base, references: own, referencesSource: "pdf" }, env);
    expect(out.references).toEqual(own);
    expect(out.referencesSource).toBe("pdf");
  });
});

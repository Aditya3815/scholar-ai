import { afterEach, describe, expect, it, vi } from "vitest";
import { resetGates, gatesOff, withGate } from "../gate";
import { verifyReference } from "./verify";

const env = { CROSSREF_MAILTO: "test@example.org" };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const cr = (over: Record<string, unknown> = {}) => ({
  DOI: "10.1000/real.1",
  title: ["Graph neural networks for protein function prediction"],
  author: [{ given: "Anita", family: "Desai" }, { given: "Rahul", family: "Verma" }],
  issued: { "date-parts": [[2021, 5, 1]] },
  "container-title": ["Bioinformatics"],
  ...over,
});

type Handler = (url: string) => Response | Promise<Response> | undefined;
function stub(...handlers: Handler[]) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    for (const h of handlers) {
      const r = await h(url);
      if (r) return r;
    }
    return json({ message: { items: [] } }); // default: empty Crossref result (also fine for the retraction check)
  });
  return calls;
}
const retractedNotice = (doi: string) => ({ message: { items: [{ DOI: "10.1000/notice", "update-to": [{ DOI: doi, type: "retraction" }] }] } });

afterEach(() => {
  vi.unstubAllGlobals();
  gatesOff(); // a test that turned the lane on leaves it off again
});

const GOOD = "Desai, A., & Verma, R. (2021). Graph neural networks for protein function prediction. Bioinformatics, 37(5), 1-12.";

describe("with a DOI", () => {
  it("verifies when the DOI's record matches title, authors and year", async () => {
    stub((u) => (u.includes("/works/10.1000/real.1") ? json({ message: cr() }) : undefined));
    const r = await verifyReference(`${GOOD} https://doi.org/10.1000/real.1`, env);
    expect(r.status).toBe("verified");
    expect(r.match?.doi).toBe("10.1000/real.1");
    expect(r.retracted).toBe(false);
  });

  it("flags a verified reference whose DOI is retracted", async () => {
    stub((u) => (u.includes("/works/10.1000/real.1") && !u.includes("filter") ? json({ message: cr() }) : undefined), (u) => (u.includes("filter=updates") ? json(retractedNotice("10.1000/real.1")) : undefined));
    const r = await verifyReference(`${GOOD} doi:10.1000/real.1`, env);
    expect(r.status).toBe("verified");
    expect(r.retracted).toBe(true);
  });

  it("calls it a mismatch when the DOI belongs to a different paper", async () => {
    stub((u) => (u.includes("/works/10.1000/other") ? json({ message: cr({ DOI: "10.1000/other", title: ["A survey of soil microbiomes"], author: [{ family: "Okafor" }] }) }) : undefined));
    const r = await verifyReference(`${GOOD} 10.1000/other`, env);
    expect(r.status).toBe("mismatch");
    expect(r.reason).toMatch(/different paper/);
  });

  it("calls it a mismatch when the title is real but authors and year were altered", async () => {
    stub((u) => (u.includes("/works/10.1000/real.1") ? json({ message: cr() }) : undefined));
    const r = await verifyReference("Nakamura, T., Ito, K. (2015). Graph neural networks for protein function prediction. Nature Methods. 10.1000/real.1", env);
    expect(r.status).toBe("mismatch");
    expect(r.reason).toMatch(/authors do not match/);
  });

  it("not_found when the DOI does not exist anywhere", async () => {
    stub(
      (u) => (u.includes("api.crossref.org/works/10.1000/ghost") && !u.includes("filter") ? new Response("", { status: 404 }) : undefined),
      (u) => (u.includes("api.openalex.org/works/doi:") ? new Response("", { status: 404 }) : undefined),
      (u) => (u.includes("doi.org/api/handles/") ? json({ responseCode: 100 }, 404) : undefined),
    );
    const r = await verifyReference(`${GOOD} https://doi.org/10.1000/ghost`, env);
    expect(r.status).toBe("not_found");
    expect(r.reason).toMatch(/does not exist/);
  });

  it("falls back to OpenAlex for DOIs Crossref does not hold (arXiv, Zenodo)", async () => {
    stub(
      (u) => (u.includes("api.crossref.org/works/10.48550/") && !u.includes("filter") ? new Response("", { status: 404 }) : undefined),
      (u) => (u.includes("api.openalex.org/works/doi:10.48550/") ? json({ doi: "https://doi.org/10.48550/arxiv.1706.03762", title: "Attention is All you Need", publication_year: 2017, authorships: [{ author: { display_name: "Ashish Vaswani" } }] }) : undefined),
    );
    const r = await verifyReference("Vaswani, A. et al. (2017). Attention is all you need. arXiv. https://doi.org/10.48550/arXiv.1706.03762", env);
    expect(r.status).toBe("verified");
  });

  it("unverifiable (not verified, not not_found) when the DOI exists but has no readable record", async () => {
    stub(
      (u) => (u.includes("api.crossref.org/works/10.5555/x") && !u.includes("filter") ? new Response("", { status: 404 }) : undefined),
      (u) => (u.includes("api.openalex.org/works/doi:") ? new Response("", { status: 404 }) : undefined),
      (u) => (u.includes("doi.org/api/handles/") ? json({ responseCode: 1 }) : undefined),
    );
    expect((await verifyReference(`${GOOD} 10.5555/x`, env)).status).toBe("unverifiable");
  });
});

describe("without a DOI", () => {
  it("verifies via Crossref bibliographic search", async () => {
    stub((u) => (u.includes("query.bibliographic") ? json({ message: { items: [cr({ DOI: "10.1000/decoy", title: ["Protein structure prediction with transformers"] }), cr()] } }) : undefined));
    const r = await verifyReference(GOOD, env);
    expect(r.status).toBe("verified");
    expect(r.match?.doi).toBe("10.1000/real.1");
  });

  it("not_found for an invented reference nothing resembles", async () => {
    stub((u) => (u.includes("query.bibliographic") ? json({ message: { items: [cr({ title: ["Soil carbon in tropical forests"], author: [{ family: "Silva" }] })] } }) : undefined));
    const r = await verifyReference("Kapoor, S., & Menon, V. (2022). Quantum reservoir scheduling for monsoon-aware banking. Journal of Applied Fictional Studies, 12(3), 55-71.", env);
    expect(r.status).toBe("not_found");
  });

  it("mismatch (never verified) when only the title is real", async () => {
    stub((u) => (u.includes("query.bibliographic") ? json({ message: { items: [cr()] } }) : undefined));
    const r = await verifyReference("Nakamura, T., Ito, K. (2015). Graph neural networks for protein function prediction. Nature Methods.", env);
    expect(r.status).toBe("mismatch");
    expect(r.match?.doi).toBe("10.1000/real.1"); // shown as the suggested real paper
  });
});

describe("what a reference that is not an article is called", () => {
  it("does not sound like an accusation when a book, a web page or a report is not found", async () => {
    stub();
    const book = await verifyReference("P. Laws, Workshop Physics Activity Guide, Wiley (1999).", env);
    expect(book.status).toBe("not_found");
    expect(book.reason).toMatch(/looks like a book/);
    const web = await verifyReference("Reuters, Cholera vaccination campaign starts in Yemen after year delay, 07 May 2018, https://www.reuters.com/article/us-health-yemen-cholera", env);
    expect(web.reason).toMatch(/web page/);
    const report = await verifyReference("Government of Haryana. 2020. Handbook on 20th Livestock Census. Chandigarh.", env);
    expect(report.reason).toMatch(/report or an official document/);
  });

  it("still says plainly that an article-looking reference was not found", async () => {
    stub();
    const r = await verifyReference("Kapoor, S., & Menon, V. (2022). Quantum reservoir scheduling for monsoon-aware banking. Journal of Applied Fictional Studies, 12(3), 55-71.", env);
    expect(r.status).toBe("not_found");
    expect(r.reason).toMatch(/^No (matching paper was found|paper matching this title)/);
  });

  it("mentions a reprint when the title and authors match but the year does not", async () => {
    stub((u) => (u.includes("query.bibliographic") ? json({ message: { items: [cr({ issued: { "date-parts": [[2018]] } })] } }) : undefined));
    const r = await verifyReference("Desai, A., & Verma, R. (1989). Graph neural networks for protein function prediction. Bioinformatics, 37(5), 1-12.", env);
    expect(r.status).toBe("mismatch");
    expect(r.reason).toMatch(/reprint or a later edition/);
  });
});

describe("markup in registry titles", () => {
  it("verifies a reference whose Crossref title carries <i> tags, without gluing the words together", async () => {
    stub((u) => (u.includes("query.bibliographic") ? json({ message: { items: [cr({ DOI: "10.1000/ital.1", title: ["<i>Anionic Mishran</i> Supplementation to Check Incidence of Milk Fever"], author: [{ given: "Rakesh", family: "Thakur" }], issued: { "date-parts": [[2017]] } })] } }) : undefined));
    const r = await verifyReference("Thakur, R., P.K. Dogra, V. Sankhyan, and P. Sood. 2017. Anionic Mishran Supplementation to Check Incidence of Milk Fever. Journal of Animal Research 7(3).", env);
    expect(r.status).toBe("verified");
    expect(r.match?.title).toBe("Anionic Mishran Supplementation to Check Incidence of Milk Fever");
  });

  it("keeps words apart when a tag sits between them with no space", async () => {
    stub((u) => (u.includes("/works/10.1000/glue.1") && !u.includes("filter") ? json({ message: cr({ DOI: "10.1000/glue.1", title: ["<i>In vitro</i>antibiofilm activity of<i>Murraya</i>oil"] }) }) : undefined));
    const r = await verifyReference("Desai A. In vitro antibiofilm activity of Murraya oil. Bioinformatics 2021. 10.1000/glue.1", env);
    expect(r.match?.title).toBe("In vitro antibiofilm activity of Murraya oil");
  });
});

describe("OpenAlex as a second source", () => {
  const ARXIV = "Kingma, D. P., & Ba, J. (2015). Adam: A method for stochastic optimization. In International Conference on Learning Representations.";
  const oaWork = (over: Record<string, unknown> = {}) => ({
    doi: "https://doi.org/10.48550/arxiv.1412.6980",
    title: "Adam: A Method for Stochastic Optimization",
    publication_year: 2014,
    authorships: [{ author: { display_name: "Diederik P. Kingma" } }, { author: { display_name: "Jimmy Ba" } }],
    primary_location: { source: { display_name: "arXiv" } },
    ...over,
  });
  const oaSearch = (results: unknown[]): Handler => (u) => (u.includes("api.openalex.org/works?") ? json({ results }) : undefined);

  it("verifies a preprint Crossref does not index, and says where it was found", async () => {
    const calls = stub(oaSearch([oaWork()]));
    const r = await verifyReference(ARXIV, env);
    expect(r.status).toBe("verified");
    expect(r.match?.doi).toBe("10.48550/arxiv.1412.6980");
    expect(r.reason).toMatch(/Found in OpenAlex/);
    expect(calls.some((u) => u.includes("title.search"))).toBe(true);
  });

  const LN = "Jimmy Lei Ba, Jamie Ryan Kiros, and Geoffrey E Hinton. Layer normalization. arXiv preprint arXiv:1607.06450, 2016.";
  const lnWork = (over: Record<string, unknown> = {}) => oaWork({ doi: "https://doi.org/10.48550/arxiv.1607.06450", title: "Layer Normalization", publication_year: 2016, authorships: [{ author: { display_name: "Jimmy Lei Ba" } }, { author: { display_name: "Geoffrey E. Hinton" } }], ...over });
  const oaByDoi = (w: unknown): Handler => (u) => (u.includes("/works/doi:10.48550/arxiv.1607.06450") ? json(w) : undefined);

  it("verifies a reference through its arXiv id without searching", async () => {
    const calls = stub(oaByDoi(lnWork()));
    const r = await verifyReference(LN, env);
    expect(r.status).toBe("verified");
    expect(r.reason).toMatch(/arXiv id/);
    expect(calls.some((u) => u.includes("query.bibliographic"))).toBe(false);
  });

  it("uses the year the preprint first appeared, not the latest version OpenAlex reports", async () => {
    stub(oaByDoi(lnWork({ publication_year: 2025 })));
    expect((await verifyReference(LN, env)).status).toBe("verified");
  });

  it("does not hold a different record behind the id against the reference: the search decides", async () => {
    stub(oaByDoi(lnWork({ title: "A Study of Soil Microbes", authorships: [{ author: { display_name: "Maria Silva" } }] })), oaSearch([lnWork()]));
    const r = await verifyReference(LN, env);
    expect(r.status).toBe("verified");
    expect(r.reason).toMatch(/Found in OpenAlex\./);
  });

  it("finds a short title that the title guess would have missed", async () => {
    const calls = stub(oaSearch([lnWork()]));
    const r = await verifyReference(LN.replace("arXiv preprint arXiv:1607.06450, ", ""), env);
    expect(r.status).toBe("verified");
    expect(calls.find((u) => u.includes("title.search"))).toMatch(/title\.search(%3A|:)Layer(\+|%20)normalization/);
  });

  it("is not asked when Crossref already verified the reference", async () => {
    const calls = stub((u) => (u.includes("query.bibliographic") ? json({ message: { items: [cr()] } }) : undefined), oaSearch([oaWork()]));
    expect((await verifyReference(GOOD, env)).status).toBe("verified");
    expect(calls.some((u) => u.includes("openalex"))).toBe(false);
  });

  it("lets a real OpenAlex record replace a Crossref near-miss", async () => {
    stub((u) => (u.includes("query.bibliographic") ? json({ message: { items: [cr({ title: ["Adam: a method for stochastic optimization (comment)"], author: [{ family: "Reviewer" }], issued: { "date-parts": [[2019]] } })] } }) : undefined), oaSearch([oaWork()]));
    const r = await verifyReference(ARXIV, env);
    expect(r.status).toBe("verified");
    expect(r.match?.authors[0]).toBe("Diederik P. Kingma");
  });

  it("still says not_found for an invented reference, naming both sources", async () => {
    stub(oaSearch([oaWork({ title: "Soil carbon in tropical forests", authorships: [{ author: { display_name: "Maria Silva" } }] })]));
    const r = await verifyReference("Kapoor, S., & Menon, V. (2022). Quantum reservoir scheduling for monsoon-aware banking. Journal of Applied Fictional Studies, 12(3), 55-71.", env);
    expect(r.status).toBe("not_found");
    expect(r.reason).toMatch(/Crossref or OpenAlex/);
  });

  it("a failing OpenAlex changes nothing: Crossref's answer stands, and the wording only names Crossref", async () => {
    stub((u) => (u.includes("api.openalex.org") ? new Response("", { status: 429 }) : undefined));
    const r = await verifyReference("Kapoor, S., & Menon, V. (2022). Quantum reservoir scheduling for monsoon-aware banking. Journal of Applied Fictional Studies, 12(3), 55-71.", env);
    expect(r.status).toBe("not_found");
    expect(r.reason).toMatch(/in Crossref\./);
    expect(r.reason).not.toMatch(/OpenAlex/);
  });

  it("does not turn an OpenAlex record with the right title but wrong authors into a verification", async () => {
    stub(oaSearch([oaWork({ authorships: [{ author: { display_name: "Maria Silva" } }], publication_year: 2003 })]));
    const r = await verifyReference(ARXIV, env);
    expect(r.status).toBe("mismatch");
  });
});

describe("failure handling never lies", () => {
  it("unverifiable when the databases are unreachable (not not_found)", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("network down"); });
    expect((await verifyReference(GOOD, env)).status).toBe("unverifiable");
    expect((await verifyReference(`${GOOD} 10.1000/real.1`, env)).status).toBe("unverifiable");
  });

  it("unverifiable on HTTP 500 from Crossref", async () => {
    stub((u) => (u.includes("query.bibliographic") ? new Response("", { status: 500 }) : undefined));
    expect((await verifyReference(GOOD, env)).status).toBe("unverifiable");
  });

  it("unverifiable, never not_found, when the shared Crossref lane is closed or too busy to place the calls (nothing was asked)", async () => {
    resetGates({ crossref: { minIntervalMs: 0 } });
    await withGate("crossref", 0, async (lane) => lane.closeUntil(Date.now() + 3_600_000));
    const calls = stub();
    expect((await verifyReference(GOOD, env)).status).toBe("unverifiable");
    expect((await verifyReference(`${GOOD} 10.1000/real.1`, env)).status).toBe("unverifiable");
    expect(calls.filter((u) => u.includes("api.crossref.org"))).toHaveLength(0);
  });

  it("unparsed for tiny or empty input, without any network call", async () => {
    const calls = stub();
    for (const s of ["", "   ", "Smith 2020", "x y"]) expect((await verifyReference(s, env)).status).toBe("unparsed");
    expect(calls).toHaveLength(0);
  });

  it("a failing retraction check leaves `retracted` unset instead of claiming false", async () => {
    stub((u) => (u.includes("filter=updates") ? new Response("", { status: 500 }) : undefined), (u) => (u.includes("query.bibliographic") ? json({ message: { items: [cr()] } }) : undefined));
    const r = await verifyReference(GOOD, env);
    expect(r.status).toBe("verified");
    expect(r.retracted).toBeUndefined();
  });
});

describe("references as papers print them", () => {
  const oaWork = (over: Record<string, unknown> = {}) => ({
    doi: "https://doi.org/10.48550/arxiv.1409.0473",
    title: "Neural Machine Translation by Jointly Learning to Align and Translate",
    publication_year: 2016, // OpenAlex merges versions; the year of the first one comes from the arXiv id
    authorships: [{ author: { display_name: "Dzmitry Bahdanau" } }, { author: { display_name: "Kyunghyun Cho" } }, { author: { display_name: "Yoshua Bengio" } }],
    primary_location: { source: { display_name: "arXiv" } },
    ...over,
  });
  const titleQuery = (u: string) => decodeURIComponent(u).replace(/\+/g, " ").match(/title\.search:([^&]*)/)?.[1] ?? "";
  const oaTitleSearch = (answer: (title: string) => unknown[]): Handler => (u) => (u.includes("api.openalex.org/works?") ? json({ results: answer(titleQuery(u)) }) : undefined);

  it("a title that follows its authors after a colon is searched without them (OpenAlex needs every word of a title search to be in the title)", async () => {
    const calls = stub(oaTitleSearch((q) => (/Bahdanau|Bengio/.test(q) ? [] : [oaWork()])));
    const r = await verifyReference("Bahdanau, D., Cho, K., Bengio, Y.: Neural machine translation by jointly learning to align and translate. In: ICLR (2015)", env);
    expect(r.status).toBe("verified");
    expect(r.match?.doi).toBe("10.48550/arxiv.1409.0473");
    expect(titleQuery(calls.find((u) => u.includes("title.search"))!)).toBe("Neural machine translation by jointly learning to align and translate");
  });

  it("an author list long enough that the title used to be lost altogether is searched too", async () => {
    const vaswani = oaWork({ doi: "https://doi.org/10.48550/arxiv.1706.03762", title: "Attention Is All You Need", authorships: [{ author: { display_name: "Ashish Vaswani" } }, { author: { display_name: "Noam Shazeer" } }] });
    const calls = stub(oaTitleSearch(() => [vaswani]));
    const r = await verifyReference("Vaswani, A., Shazeer, N., Parmar, N., Uszkoreit, J., Jones, L., Gomez, A.N., Kaiser, L., Polosukhin, I.: Attention is all you need. In: NeurIPS (2017)", env);
    expect(r.status).toBe("verified");
    expect(titleQuery(calls.find((u) => u.includes("title.search"))!)).toBe("Attention is all you need");
  });

  it("the words around a line break are left out of the search, so a real hyphen and a soft one both still find the paper", async () => {
    const luong = oaWork({ doi: "https://doi.org/10.48550/arxiv.1508.04025", title: "Effective Approaches to Attention-based Neural Machine Translation", publication_year: 2015, authorships: [{ author: { display_name: "Minh-Thang Luong" } }, { author: { display_name: "Hieu Pham" } }, { author: { display_name: "Christopher D. Manning" } }] });
    const calls = stub(oaTitleSearch((q) => (q === "Effective approaches to neural machine translation" ? [luong] : [])));
    const r = await verifyReference("Minh-Thang Luong, Hieu Pham, and Christopher D Manning. Effective approaches to attention- based neural machine translation. In EMNLP, 2015.", env);
    expect(r.status).toBe("verified");
    expect(calls.some((u) => u.includes("title.search"))).toBe(true);
  });

  it("an arXiv id confirms a title with a real hyphen that was broken at the end of a line", async () => {
    const luong = oaWork({ doi: "https://doi.org/10.48550/arxiv.1508.04025", title: "Effective Approaches to Attention-based Neural Machine Translation", publication_year: 2015, authorships: [{ author: { display_name: "Minh-Thang Luong" } }] });
    stub((u) => (u.includes("/works/doi:10.48550/arxiv.1508.04025") ? json(luong) : undefined));
    const r = await verifyReference("Minh-Thang Luong, Hieu Pham, and Christopher D Manning. Effective approaches to attention- based neural machine translation. arXiv preprint arXiv:1508.04025, 2015.", env);
    expect(r.status).toBe("verified");
    expect(r.reason).toMatch(/arXiv id/);
  });

  it("a shortened title is said to be one", async () => {
    const parikh = oaWork({ doi: "https://doi.org/10.18653/v1/d16-1244", title: "A Decomposable Attention Model for Natural Language Inference", publication_year: 2016, authorships: [{ author: { display_name: "Ankur P. Parikh" } }, { author: { display_name: "Oscar T\u00e4ckstr\u00f6m" } }] });
    stub(oaTitleSearch(() => [parikh]));
    const r = await verifyReference("Ankur Parikh, Oscar T\u00e4ckstr\u00f6m, Dipanjan Das, and Jakob Uszkoreit. A decomposable attention model. In Empirical Methods in Natural Language Processing, 2016.", env);
    expect(r.status).toBe("verified");
    expect(r.reason).toMatch(/shortened/);
  });

  it("a year two off is verified, and the answer says what the years are", async () => {
    const cascade = oaWork({ doi: "https://doi.org/10.1109/tpami.2019.2956516", title: "Cascade R-CNN: High Quality Object Detection and Instance Segmentation", publication_year: 2021, authorships: [{ author: { display_name: "Zhaowei Cai" } }, { author: { display_name: "Nuno Vasconcelos" } }] });
    stub(oaTitleSearch(() => [cascade]));
    const r = await verifyReference("Cai, Z., Vasconcelos, N.: Cascade R-CNN: High quality object detection and instance segmentation. PAMI (2019)", env);
    expect(r.status).toBe("verified");
    expect(r.reason).toMatch(/2019/);
    expect(r.reason).toMatch(/2021/);
  });
});

describe("a DOI that a PDF wrapped onto the next line", () => {
  const clearbuds = (over: Record<string, unknown> = {}) => ({
    DOI: "10.1145/3498361.3538933",
    title: ["ClearBuds: wireless binaural earbuds for learning-based speech enhancement"],
    author: [{ given: "Ishan", family: "Chatterjee" }, { given: "Maruchi", family: "Kim" }],
    issued: { "date-parts": [[2022, 6, 27]] },
    "container-title": ["Proceedings of the 20th Annual International Conference on Mobile Systems, Applications, and Services"],
    ...over,
  });
  const proceedings = { DOI: "10.1145/3498361", title: ["Proceedings of the 20th Annual International Conference on Mobile Systems, Applications, and Services"], issued: { "date-parts": [[2022]] } };
  const REF = "Ishan Chatterjee, Maruchi Kim, Vivek Jayaram, Shyamnath Gollakota, Ira Kemelmacher, Shwetak Patel, and Steven M. Seitz. 2022. ClearBuds: wireless binaural earbuds for learning-based speech enhancement (MobiSys \u201922). Association for Computing Machinery, New York, NY, USA, 384\u2013396. doi:10.1145/3498361.";
  const byDoi = (doi: string, body: unknown): Handler => (u) => (new RegExp(`/works/${doi.replace(/[./]/g, "\\$&")}(\\?|$)`).test(u) && !u.includes("filter") ? json({ message: body }) : undefined);

  it("is looked up whole: the paper it names, not the proceedings its first half names", async () => {
    stub(byDoi("10.1145/3498361.3538933", clearbuds()), byDoi("10.1145/3498361", proceedings));
    const r = await verifyReference(`${REF} 3538933`, env);
    expect(r.status).toBe("verified");
    expect(r.match?.doi).toBe("10.1145/3498361.3538933");
  });

  it("falls back to the DOI as printed when the joined one is nothing (a number after the sentence end), and never calls a real DOI nonexistent", async () => {
    stub(byDoi("10.1000/real.1", cr()));
    const r = await verifyReference("Desai, A., & Verma, R. (2021). Graph neural networks for protein function prediction. Bioinformatics, 37(5), 1-12. doi:10.1000/real.1. 2021 IEEE Conference on Things", env);
    expect(r.status).toBe("verified");
    expect(r.match?.doi).toBe("10.1000/real.1");
  });

  it("says the DOI does not exist only when none of the readings of it does", async () => {
    stub(
      (u) => (u.includes("api.crossref.org/works/10.1000/ghost") && !u.includes("filter") ? new Response("", { status: 404 }) : undefined),
      (u) => (u.includes("api.openalex.org/works/doi:") ? new Response("", { status: 404 }) : undefined),
      (u) => (u.includes("doi.org/api/handles/") ? json({ responseCode: 100 }, 404) : undefined),
    );
    const r = await verifyReference(`${GOOD} doi:10.1000/ghost. 2021 IEEE Conference`, env);
    expect(r.status).toBe("not_found");
    expect(r.reason).toMatch(/does not exist/);
  });
});

describe("a DOI that was cut short", () => {
  // a list read before the PDF reader kept the second line of a wrapped DOI, or one pasted from a PDF, has "doi:10.1145/3498361." for "10.1145/3498361.3538933"
  const proceedings = { DOI: "10.1145/3498361", title: ["Proceedings of the 20th Annual International Conference on Mobile Systems, Applications, and Services"], issued: { "date-parts": [[2022]] } };
  const paper = {
    DOI: "10.1145/3498361.3538933",
    title: ["ClearBuds: wireless binaural earbuds for learning-based speech enhancement"],
    author: [{ given: "Ishan", family: "Chatterjee" }, { given: "Maruchi", family: "Kim" }],
    issued: { "date-parts": [[2022, 6, 27]] },
  };
  const CUT = "Ishan Chatterjee, Maruchi Kim, Vivek Jayaram, Shyamnath Gollakota, Ira Kemelmacher, Shwetak Patel, and Steven M. Seitz. 2022. ClearBuds: wireless binaural earbuds for learning-based speech enhancement (MobiSys \u201922). Association for Computing Machinery, New York, NY, USA, 384\u2013396. doi:10.1145/3498361.";
  const byDoi = (u: string) => (/\/works\/10\.1145\/3498361(\?|$)/.test(u) && !u.includes("filter") ? json({ message: proceedings }) : undefined);
  const search = (u: string) => (u.includes("query.bibliographic") || u.includes("query.title") ? json({ message: { items: [paper] } }) : undefined);

  it("verifies the paper the title finds when the printed DOI is the start of its DOI, and says so", async () => {
    stub(byDoi, search);
    const r = await verifyReference(CUT, env);
    expect(r.status).toBe("verified");
    expect(r.match?.doi).toBe("10.1145/3498361.3538933");
    expect(r.reason).toMatch(/cut short/);
  });

  it("not when the printed DOI is another paper's: a real reference text with the wrong DOI is still a mismatch", async () => {
    stub((u) => (/\/works\/10\.1145\/9999999(\?|$)/.test(u) && !u.includes("filter") ? json({ message: { DOI: "10.1145/9999999", title: ["A survey of soil microbiomes"], author: [{ family: "Okafor" }], issued: { "date-parts": [[2022]] } } }) : undefined), search);
    const r = await verifyReference(CUT.replace("10.1145/3498361.", "10.1145/9999999"), env);
    expect(r.status).toBe("mismatch");
    expect(r.reason).toMatch(/different paper/);
  });

  it("when the title finds nothing, the DOI's own answer stands", async () => {
    stub(byDoi);
    const r = await verifyReference(CUT, env);
    expect(r.status).toBe("mismatch");
    expect(r.reason).toMatch(/different paper/);
  });
});

describe("a reference that gives no title (physics, astronomy and chemistry write them so)", () => {
  const abdo = {
    DOI: "10.1088/0004-637x/699/2/976",
    title: ["Fermi/Large Area Telescope Discovery of Gamma-Ray Emission from a Relativistic Jet in the Narrow-Line Quasar PMN J0948+0022"],
    author: [{ given: "A. A.", family: "Abdo" }, { given: "M.", family: "Ackermann" }, { given: "M.", family: "Ajello" }],
    issued: { "date-parts": [[2009, 7]] },
    "container-title": ["The Astrophysical Journal"],
    volume: "699",
    page: "976-984",
  };
  const REF = "Abdo, A. A., Ackermann, M., Ajello, M., et al. 2009a, ApJ, 699, 976";
  const locator = (items: unknown[]): Handler => (u) => (u.includes("api.crossref.org/works?") && u.includes("volume") ? json({ message: { items } }) : undefined);

  it("is verified by the first author, the year, the volume and the page, and says that is all it had", async () => {
    const calls = stub(locator([{ ...abdo, DOI: "10.1000/decoy", author: [{ family: "Smith" }], volume: "12", page: "5" }, abdo]));
    const r = await verifyReference(REF, env);
    expect(r.status).toBe("verified");
    expect(r.match?.doi).toBe("10.1088/0004-637x/699/2/976");
    expect(r.reason).toMatch(/no title/);
    expect(r.reason).toMatch(/volume and page/);
    const asked = decodeURIComponent(calls.find((u) => u.includes("volume"))!);
    expect(asked).toMatch(/query\.author=Abdo/);
    expect(asked).toMatch(/from-pub-date:2008,until-pub-date:2010/);
    // ranked by the numbers alone: with the whole reference in it the paper was not among the first fifteen of the many by authors called Abdo (checked on the live service)
    expect(asked).toMatch(/query\.bibliographic=699[ +]976(&|$)/);
  });

  it("also when the journal is named in full, which looks like a title (a journal the abbreviations list does not have)", async () => {
    stub(locator([{ DOI: "10.1002/asna.202113886", title: ["Active galactic nuclei in the era of surveys"], author: [{ given: "M.", family: "Berton" }, { given: "E.", family: "J\u00e4rvel\u00e4" }], issued: { "date-parts": [[2021, 12]] }, "container-title": ["Astronomische Nachrichten"], volume: "342", page: "1066-1070" }]));
    const r = await verifyReference("Berton, M. & J\u00e4rvel\u00e4, E. 2021, Astronomische Nachrichten, 342, 1066", env);
    expect(r.status).toBe("verified");
  });

  it("the same way for a reference in the style of the Physical Review", async () => {
    stub(locator([{ DOI: "10.1103/physrev.110.965", title: ["Past-Future Asymmetry of the Gravitational Field of a Point Particle"], author: [{ given: "David", family: "Finkelstein" }], issued: { "date-parts": [[1958, 5, 15]] }, "container-title": ["Physical Review"], volume: "110", page: "965-967" }]));
    const r = await verifyReference("D. Finkelstein, Phys. Rev. 110, 965 (1958).", env);
    expect(r.status).toBe("verified");
  });

  it("a different author, volume or page is not the paper: not found, and it says what could and could not be compared", async () => {
    stub(locator([abdo]));
    for (const wrong of [REF.replace("Abdo", "Smith"), REF.replace("699", "700"), REF.replace("976", "977")]) {
      const r = await verifyReference(wrong, env);
      expect(r.status).toBe("not_found");
      expect(r.reason).toMatch(/gives no title/);
    }
  });

  it("a reference that does give a title is not matched by where it was printed: an invented title on a real page is not verified", async () => {
    stub(locator([abdo]));
    const r = await verifyReference("Abdo, A. A., Ackermann, M., Ajello, M. (2009). A completely invented study of quasars that was never written. The Astrophysical Journal, 699, 976-984.", env);
    expect(r.status).not.toBe("verified");
  });

  it("when Crossref cannot be reached the answer is could-not-check, never not found", async () => {
    stub((u) => (u.includes("api.crossref.org/works?") ? new Response("", { status: 503 }) : undefined));
    expect((await verifyReference(REF, env)).status).toBe("unverifiable");
  });
});

describe("an arXiv id and no title", () => {
  const work = (over: Record<string, unknown> = {}) => ({
    doi: "https://doi.org/10.48550/arxiv.1801.07234",
    title: "Black hole masses of radio-loud narrow-line Seyfert 1 galaxies",
    publication_year: 2018,
    authorships: [{ author: { display_name: "Shiyu Chen" } }, { author: { display_name: "Marco Berton" } }, { author: { display_name: "Giovanni La Mura" } }],
    primary_location: { source: { display_name: "arXiv" } },
    ...over,
  });
  const REF = "Chen, S., Berton, M., La Mura, G., et al. 2018, ArXiv: 1801.07234";

  it("is verified by the id, the first author and the year, and says there was no title", async () => {
    stub((u) => (u.includes("/works/doi:10.48550/arxiv.1801.07234") ? json(work()) : undefined));
    const r = await verifyReference(REF, env);
    expect(r.status).toBe("verified");
    expect(r.reason).toMatch(/arXiv id/);
    expect(r.reason).toMatch(/no title/);
  });

  it("not when the id belongs to another author's paper", async () => {
    stub((u) => (u.includes("/works/doi:10.48550/arxiv.1801.07234") ? json(work({ authorships: [{ author: { display_name: "Maria Silva" } }] })) : undefined));
    expect((await verifyReference(REF, env)).status).not.toBe("verified");
  });
});

describe("a line break inside an author's name", () => {
  // found by running 1,354 real references before and after a change: reading the title from the text as printed ("Morgen- stern. 2011.") broke the sentences and returned the venue as the title
  it("does not change which sentence is the title, so OpenAlex is asked for the title", async () => {
    const work = { doi: null, title: "The Winograd Schema Challenge", publication_year: 2011, authorships: [{ author: { display_name: "Hector J. Levesque" } }, { author: { display_name: "Ernest Davis" } }, { author: { display_name: "Leora Morgenstern" } }], primary_location: null };
    const asked: string[] = [];
    stub((u) => {
      if (!u.includes("api.openalex.org/works?")) return undefined;
      const q = decodeURIComponent(u).replace(/\+/g, " ").match(/title\.search:([^&]*)/)?.[1] ?? "";
      asked.push(q);
      return json({ results: q === "The winograd schema challenge" ? [work] : [] });
    });
    const r = await verifyReference("Hector J Levesque, Ernest Davis, and Leora Morgen- stern. 2011. The winograd schema challenge. In Aaai spring symposium: Logical formalizations of commonsense reasoning, volume 46, page 47.", env);
    expect(asked).toEqual(["The winograd schema challenge"]);
    expect(r.status).toBe("verified");
  });
});
